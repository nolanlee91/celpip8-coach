// Layer A loader: reads the static content library from disk, validates it, and exposes only
// approved, error-free items to the learning engine. No AI calls happen here.

import fs from "node:fs";
import path from "node:path";
import type { LibraryItem, MockPackage, ValidationIssue, VocabEntry } from "../shared/content";
import { validateCollection, validateItem, validateMock, validateVocab } from "../shared/validate";
import type { McqQuestion } from "../shared/types";
import { DATA_DIR } from "./db";

/** Curated content shipped in git. */
export const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR || "content");
/** Content approved through the admin pipeline on this machine/server (persistent volume). */
export const LIBRARY_DIR = path.join(DATA_DIR, "library");

const SKILL_DIRS = ["reading", "listening", "writing", "speaking"] as const;

export interface Library {
  items: Map<string, LibraryItem>; // active (approved + valid) items only
  all: Map<string, { item: LibraryItem; file: string; active: boolean }>;
  vocab: VocabEntry[];
  mocks: { pkg: MockPackage; file: string; valid: boolean }[];
  issues: ValidationIssue[];
  loadedAt: string;
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full) : e.name.endsWith(".json") ? [full] : [];
  });
}

/** Question ids are derived, never authored: `${setId}-q${number}`. */
export function withQuestionIds(item: LibraryItem): LibraryItem {
  const fix = (qs: McqQuestion[]) => qs.map((q) => ({ ...q, id: `${item.id}-q${q.number}` }));
  if (item.kind === "reading") return { ...item, questions: fix(item.questions ?? []), focus: item.focus ?? [], createdAt: item.createdAt ?? "" };
  if (item.kind === "listening") return { ...item, chunks: (item.chunks ?? []).map((c) => ({ ...c, questions: fix(c.questions ?? []) })), focus: item.focus ?? [], createdAt: item.createdAt ?? "" };
  return { ...item, createdAt: item.createdAt ?? "" };
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, "")) as T;
}

export function scanLibrary(roots: string[] = [CONTENT_DIR, LIBRARY_DIR]): Library {
  const issues: ValidationIssue[] = [];
  const raw: { item: LibraryItem; file: string }[] = [];
  const vocab: { entry: VocabEntry; file: string }[] = [];
  const mockFiles: { pkg: MockPackage; file: string }[] = [];

  for (const root of roots) {
    for (const file of walk(root)) {
      const rel = path.relative(root, file).replace(/\\/g, "/");
      const top = rel.split("/")[0];
      const shown = path.relative(process.cwd(), file).replace(/\\/g, "/");
      let data: unknown;
      try { data = readJson(file); } catch (e) {
        issues.push({ severity: "error", id: "", file: shown, message: `invalid JSON: ${(e as Error).message}` });
        continue;
      }
      if ((SKILL_DIRS as readonly string[]).includes(top)) {
        const item = withQuestionIds(data as LibraryItem);
        if (item.kind !== top) issues.push({ severity: "error", id: item.id, file: shown, message: `kind "${item.kind}" does not match folder "${top}"` });
        raw.push({ item, file: shown });
      } else if (top === "vocabulary") {
        if (!Array.isArray(data)) { issues.push({ severity: "error", id: "", file: shown, message: "vocabulary file must be a JSON array" }); continue; }
        for (const entry of data as VocabEntry[]) vocab.push({ entry, file: shown });
      } else if (top === "mocks") {
        mockFiles.push({ pkg: data as MockPackage, file: shown });
      }
    }
  }

  const bad = new Set<string>();
  for (const { item, file } of raw) {
    const its = validateItem(item, file);
    issues.push(...its);
    if (its.some((i) => i.severity === "error")) bad.add(item.id);
  }
  const vocabIssues = new Map<string, VocabEntry[]>();
  for (const { entry, file } of vocab) {
    const list = vocabIssues.get(file) ?? [];
    list.push(entry);
    vocabIssues.set(file, list);
  }
  const badVocab = new Set<string>();
  for (const [file, list] of vocabIssues) {
    const its = validateVocab(list, file);
    issues.push(...its);
    for (const i of its) if (i.severity === "error") badVocab.add(i.id);
  }
  const coll = validateCollection(raw, vocab);
  issues.push(...coll);
  for (const i of coll) if (i.severity === "error") { bad.add(i.id); badVocab.add(i.id); }

  const all = new Map<string, { item: LibraryItem; file: string; active: boolean }>();
  const items = new Map<string, LibraryItem>();
  for (const { item, file } of raw) {
    const active = !bad.has(item.id) && item.review?.status === "approved";
    if (!all.has(item.id)) all.set(item.id, { item, file, active });
    if (active && !items.has(item.id)) items.set(item.id, item);
  }

  const byId = new Map([...all.values()].map((x) => [x.item.id, x.item]));
  const activeIds = new Set(items.keys());
  const mocks = mockFiles.map(({ pkg, file }) => {
    const its = validateMock(pkg, file, byId, activeIds);
    issues.push(...its);
    return { pkg, file, valid: !its.some((i) => i.severity === "error") };
  });

  return {
    items,
    all,
    vocab: vocab.map((v) => v.entry).filter((e) => !badVocab.has(e.id)),
    mocks,
    issues,
    loadedAt: new Date().toISOString(),
  };
}

let current: Library | null = null;

export function library(): Library {
  current ??= scanLibrary();
  return current;
}

export function reloadLibrary(): Library {
  current = scanLibrary();
  return current;
}

/** Writes an approved item into a library root using the canonical layout. */
export function writeLibraryItem(item: LibraryItem, root: string = LIBRARY_DIR): string {
  const dir = path.join(root, item.kind, item.taskType);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${item.id}.json`);
  // Question ids are derived on load, so strip them to keep files canonical.
  const strip = (qs: McqQuestion[]) => qs.map(({ id: _id, ...q }) => q);
  const out = item.kind === "reading" ? { ...item, questions: strip(item.questions) }
    : item.kind === "listening" ? { ...item, chunks: item.chunks.map((c) => ({ ...c, questions: strip(c.questions) })) }
      : item;
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
  return file;
}
