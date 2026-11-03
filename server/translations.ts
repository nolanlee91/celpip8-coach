// Vietnamese translations of the English study texts (reading passages, listening transcripts,
// writing/speaking prompts, lesson stimuli). Pre-made and committed in content/translations/vi.json,
// keyed by a hash of the exact English text, so editing a text simply leaves it untranslated until
// `npm run translations -- --export` / `--import` is run again. Questions and options stay English.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONTENT_DIR, library } from "./library";
import { curriculum } from "./lessons";
import { speechText, tableSpeech } from "../shared/read-aloud";
import type { ListeningSet, ReadingSet, SpeakingPrompt, WritingPrompt } from "../shared/types";

export const TRANSLATIONS_FILE = path.join(CONTENT_DIR, "translations", "vi.json");

export const translationKey = (text: string) => crypto.createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);

let cache: Record<string, string> | null = null;
export function translations(): Record<string, string> {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(TRANSLATIONS_FILE, "utf8")); } catch { cache = {}; }
  return cache!;
}
export const reloadTranslations = () => { cache = null; };

export const translate = (text: string): string | null => (text.trim() ? translations()[translationKey(text)] ?? null : null);

/** Every English text the UI offers a translation for, exactly as the components pass it. */
export function translatableTexts(): string[] {
  const out = new Set<string>();
  const add = (t: string | null | undefined) => { if (t?.trim()) out.add(t.trim()); };
  for (const item of library().items.values()) {
    if (item.kind === "reading") for (const s of (item as ReadingSet).sections) add(s.kind === "table" && s.table ? tableSpeech(s.table) : s.text);
    if (item.kind === "listening") for (const c of (item as ListeningSet).chunks) for (const seg of c.segments) add(seg.text);
    if (item.kind === "writing") {
      const w = item as WritingPrompt;
      [w.situation, w.optionA, w.optionB, ...w.instructions].forEach(add);
    }
    if (item.kind === "speaking") {
      const s = item as SpeakingPrompt;
      add(s.prompt);
      for (const o of s.options ?? []) [o.title, ...o.details].forEach(add);
    }
  }
  for (const l of curriculum().lessons.values())
    for (const st of Object.values(l.stimuli ?? {})) { add(st.text); for (const seg of st.audio ?? []) add(seg.text); }
  return [...out];
}

/**
 * Every text the "Nghe bài đọc" button can send, normalised as the client sends it: library reading
 * passages (also used by mocks and review) and lesson stimuli that have text but no audio of their own.
 */
export function readAloudTexts(): string[] {
  const out = new Set<string>();
  const add = (raw: string) => { const t = speechText(raw); if (t) out.add(t); };
  for (const item of library().items.values())
    if (item.kind === "reading") for (const s of (item as ReadingSet).sections) add(s.kind === "table" && s.table ? tableSpeech(s.table) : s.text);
  for (const l of curriculum().lessons.values())
    for (const st of Object.values(l.stimuli ?? {})) if (st.text && !st.audio?.length && !st.audioRef) add(st.text);
  return [...out];
}
