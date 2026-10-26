import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Db, Settings } from "../shared/types";

// On Railway, point DATA_DIR at a mounted volume (e.g. /data) so progress survives redeploys.
export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
// Storage layout (see AUDIT.md §Storage):
//   progress.json  — B. user learning progress (settings, attempts, mistakes, vocab notebook, plans, mocks)
//   ai.json        — C. AI evaluation results, pending submissions, usage log, evaluation cache
//   audio/         — learner speaking recordings;  audio-assets/ — D. pre-generated listening audio
//   library/       — A. admin-approved content (curated content ships in git under content/)
const PROGRESS_FILE = path.join(DATA_DIR, "progress.json");
const AI_FILE = path.join(DATA_DIR, "ai.json");
const LEGACY_DB_FILE = path.join(DATA_DIR, "db.json");
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
    allowBrowserVoice: false,
    aiCache: true,
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
    submissions: [],
    aiUsage: [],
    aiCache: {},
  };
}

const AI_KEYS = ["evaluations", "submissions", "aiUsage", "aiCache"] as const;

function merge(parsed: Partial<Db>): Db {
  const base = emptyDb();
  return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings ?? {}), difficulty: { ...base.settings.difficulty, ...(parsed.settings?.difficulty ?? {}) } } };
}

/**
 * One-time migration from the single db.json used before the content-library refactor.
 * The original file is kept as db.json.migrated-<timestamp> so nothing is lost.
 */
function migrateLegacy(): Db | null {
  if (!fs.existsSync(LEGACY_DB_FILE) || fs.existsSync(PROGRESS_FILE)) return null;
  const legacy = JSON.parse(fs.readFileSync(LEGACY_DB_FILE, "utf8")) as Partial<Db>;
  const db = merge(legacy);
  // Legacy mock exams were AI-generated on demand; keep them readable but mark them as such.
  db.mockExams = db.mockExams.map((m) => ({ ...m, packageId: m.packageId ?? null }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  fs.copyFileSync(LEGACY_DB_FILE, `${LEGACY_DB_FILE}.migrated-${stamp}`);
  writeSync(db);
  fs.rmSync(LEGACY_DB_FILE);
  console.log(`Migrated db.json → progress.json + ai.json (backup: db.json.migrated-${stamp})`);
  return db;
}

function split(db: Db) {
  const progress: Record<string, unknown> = { ...db };
  const ai: Record<string, unknown> = { version: 1 };
  for (const k of AI_KEYS) { ai[k] = db[k]; delete progress[k]; }
  return { progress, ai };
}

function writeSync(db: Db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { progress, ai } = split(db);
  for (const [file, data] of [[PROGRESS_FILE, progress], [AI_FILE, ai]] as const) {
    fs.writeFileSync(file + ".tmp", JSON.stringify(data, null, 1));
    fs.renameSync(file + ".tmp", file);
  }
}

let cache: Db | null = null;

export function load(): Db {
  if (cache) return cache;
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  const migrated = migrateLegacy();
  if (migrated) cache = migrated;
  else if (fs.existsSync(PROGRESS_FILE)) {
    const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8")) as Partial<Db>;
    const ai = fs.existsSync(AI_FILE) ? (JSON.parse(fs.readFileSync(AI_FILE, "utf8")) as Partial<Db>) : {};
    cache = merge({ ...progress, ...Object.fromEntries(AI_KEYS.map((k) => [k, ai[k]]).filter(([, v]) => v !== undefined)) });
  } else {
    cache = emptyDb();
    writeSync(cache);
  }
  return cache;
}

let writing = Promise.resolve();

// Atomic writes (tmp file + rename), serialized so concurrent requests can't interleave.
export function save(): Promise<void> {
  const { progress, ai } = split(cache!);
  const files: [string, string][] = [[PROGRESS_FILE, JSON.stringify(progress, null, 1)], [AI_FILE, JSON.stringify(ai, null, 1)]];
  writing = writing.then(async () => {
    for (const [file, text] of files) {
      await fs.promises.writeFile(file + ".tmp", text, "utf8");
      await fs.promises.rename(file + ".tmp", file);
    }
  });
  return writing;
}

export function replaceDb(next: Db): Promise<void> {
  cache = merge(next);
  return save();
}

export function resetDb(): Promise<void> {
  cache = emptyDb();
  return save();
}
