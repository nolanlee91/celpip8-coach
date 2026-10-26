// Learn Mode content loader: reads content/lessons (curriculum map + one JSON file per lesson),
// validates it against the rest of the library, and exposes only approved, error-free lessons.

import fs from "node:fs";
import path from "node:path";
import type { ValidationIssue } from "../shared/content";
import type { CurriculumMap, Lesson } from "../shared/curriculum";
import { validateCurriculum, validateLesson, type LessonContext } from "../shared/validate-lesson";
import type { ListeningSet } from "../shared/types";
import { CONTENT_DIR, library, readJson } from "./library";

export const LESSONS_DIR = path.join(CONTENT_DIR, "lessons");

export interface Curriculum {
  map: CurriculumMap;
  lessons: Map<string, Lesson>; // active (approved + valid) lessons only
  all: Map<string, { lesson: Lesson; file: string; active: boolean }>;
  issues: ValidationIssue[];
  /** Ordered lesson ids per skill (curriculum order, active or not). */
  order: Record<string, string[]>;
}

export function lessonContext(): LessonContext {
  const lib = library();
  const listeningChunks = new Map<string, { segments: { text: string }[] }[]>();
  const speakingImages = new Set<string>();
  for (const item of lib.items.values()) {
    if (item.kind === "listening") listeningChunks.set(item.id, (item as ListeningSet).chunks);
    if (item.kind === "speaking" && item.svg) speakingImages.add(item.id);
  }
  return { listeningChunks, speakingImages };
}

export function scanCurriculum(dir = LESSONS_DIR): Curriculum {
  const issues: ValidationIssue[] = [];
  const mapFile = path.join(dir, "curriculum.json");
  let map: CurriculumMap = { version: 1, modules: [] };
  const shown = (f: string) => path.relative(process.cwd(), f).replace(/\\/g, "/");
  try { map = readJson<CurriculumMap>(mapFile); } catch (e) {
    issues.push({ severity: "error", id: "", file: shown(mapFile), message: `curriculum.json: ${(e as Error).message}` });
  }
  const ctx = lessonContext();
  const all = new Map<string, { lesson: Lesson; file: string; active: boolean }>();
  for (const skill of ["reading", "listening", "speaking", "writing"]) {
    const sub = path.join(dir, skill);
    if (!fs.existsSync(sub)) continue;
    for (const name of fs.readdirSync(sub).filter((f) => f.endsWith(".json")).sort()) {
      const file = path.join(sub, name);
      let lesson: Lesson;
      try { lesson = readJson<Lesson>(file); } catch (e) {
        issues.push({ severity: "error", id: name, file: shown(file), message: `invalid JSON: ${(e as Error).message}` });
        continue;
      }
      const its = validateLesson(lesson, ctx, shown(file));
      if (lesson.skill !== skill) its.push({ severity: "error", id: lesson.id, file: shown(file), message: `skill "${lesson.skill}" does not match folder "${skill}"` });
      if (`${lesson.id}.json` !== name) its.push({ severity: "error", id: lesson.id, file: shown(file), message: "file name must be <id>.json" });
      if (all.has(lesson.id)) its.push({ severity: "error", id: lesson.id, file: shown(file), message: "duplicate lesson id" });
      issues.push(...its);
      const ok = !its.some((i) => i.severity === "error");
      if (!all.has(lesson.id)) all.set(lesson.id, { lesson, file: shown(file), active: ok && lesson.review?.status === "approved" });
    }
  }
  const cur = validateCurriculum(map, [...all.values()].map((x) => x.lesson));
  issues.push(...cur);
  for (const i of cur) if (i.severity === "error" && all.has(i.id)) all.get(i.id)!.active = false;

  const lessons = new Map<string, Lesson>();
  const order: Record<string, string[]> = { reading: [], listening: [], speaking: [], writing: [] };
  for (const mod of [...map.modules].sort((a, b) => a.order - b.order)) {
    for (const id of mod.lessons) {
      order[mod.skill]?.push(id);
      const x = all.get(id);
      if (x?.active) lessons.set(id, x.lesson);
    }
  }
  return { map, lessons, all, issues, order };
}

let current: Curriculum | null = null;
export function curriculum(): Curriculum {
  current ??= scanCurriculum();
  return current;
}
export function reloadCurriculum(): Curriculum {
  current = scanCurriculum();
  return current;
}
