import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Db, Settings } from "../shared/types";

// On Railway, point DATA_DIR at a mounted volume (e.g. /data) so progress survives redeploys.
const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
export const AUDIO_DIR = path.join(DATA_DIR, "audio");

export function today(): string {
  return localDate(new Date());
}

export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00");
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export function uid(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function defaultSettings(): Settings {
  return {
    learnerName: "Thang",
    officialScores: { listening: 6, reading: 5, writing: 7, speaking: 6 },
    officialTestDate: "2026-04-01",
    targetLevel: 8,
    planWeeks: 12,
    dailyMinutes: 90,
    weights: { reading: 35, listening: 30, speaking: 25, writing: 10 },
    autoAdjust: true,
    startDate: today(),
    // Start practice one level above the official score, capped at the 5–10 range.
    difficulty: {
      R1: 6, R2: 6, R3: 6, R4: 6,
      L1: 7, L2: 7, L3: 7, L4: 7, L5: 7, L6: 7,
      W1: 8, W2: 8,
      S1: 7, S2: 7, S3: 7, S4: 7, S5: 7, S6: 7, S7: 7, S8: 7,
    },
    preferredVoice: null,
    effort: "medium",
  };
}

function emptyDb(): Db {
  return {
    version: 1,
    settings: defaultSettings(),
    content: {},
    attempts: [],
    mistakes: [],
    vocab: [],
    evaluations: {},
    studyLog: [],
    mockExams: [],
    weekly: [],
    planCompletions: {},
  };
}

let cache: Db | null = null;

export function load(): Db {
  if (cache) return cache;
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Db;
    const base = emptyDb();
    cache = { ...base, ...parsed, settings: { ...base.settings, ...parsed.settings } };
  } else {
    cache = emptyDb();
    save();
  }
  return cache;
}

let writing = Promise.resolve();

// Atomic write (tmp file + rename), serialized so concurrent requests can't interleave.
export function save(): Promise<void> {
  const snapshot = JSON.stringify(cache, null, 1);
  writing = writing.then(async () => {
    const tmp = DB_FILE + ".tmp";
    await fs.promises.writeFile(tmp, snapshot, "utf8");
    await fs.promises.rename(tmp, DB_FILE);
  });
  return writing;
}

export function replaceDb(next: Db): Promise<void> {
  cache = { ...emptyDb(), ...next };
  return save();
}

export function resetDb(): Promise<void> {
  cache = emptyDb();
  return save();
}
