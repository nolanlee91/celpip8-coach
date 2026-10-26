// Admin content-generation pipeline (never part of the study flow).
// generate (batch, resumable) → automatic validation → independent AI review → human approve/reject → import.
// Drafts live in $DATA_DIR/content-drafts/<jobId>/ so interrupted jobs resume without regenerating finished items.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryItem, ValidationIssue, VocabEntry } from "../shared/content";
import { TOPICS } from "../shared/content";
import { validateCollection, validateItem, validateVocab } from "../shared/validate";
import { LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, WRITING_TASKS, type Skill } from "../shared/spec";
import { DATA_DIR } from "./db";
import { AiError, MODEL, onUsage, type Effort } from "./ai";
import { generateItem, generateVocab, reviewItem, type AiReview } from "./prompts";
import { CONTENT_DIR, LIBRARY_DIR, library, reloadLibrary, withQuestionIds, writeLibraryItem } from "./library";

export const DRAFTS_DIR = path.join(DATA_DIR, "content-drafts");

export type JobSkill = Skill | "vocabulary";

export interface DraftRecord {
  id: string;
  index: number;
  status: "pending" | "generated" | "failed";
  error: string | null;
  topic: string;
  difficulty: number;
  issues: ValidationIssue[];
  aiReview: AiReview | null;
  decision: "pending" | "approved" | "rejected";
  imported: boolean;
}

export interface Job {
  id: string;
  createdAt: string;
  skill: JobSkill;
  taskType: string; // "" for vocabulary
  setType: string;
  count: number;
  focus: string | null;
  topic: string | null; // null → rotate through under-represented topics
  difficulty: number | null; // null → learner's current difficulty for the task
  aiReview: boolean;
  effort: Effort;
  model: string;
  drafts: DraftRecord[];
  usage: { calls: number; failedCalls: number; promptTokens: number; outputTokens: number; thoughtsTokens: number; totalTokens: number };
  running: boolean;
  lastError: string | null;
}

const jobDir = (id: string) => path.join(DRAFTS_DIR, id);
const jobFile = (id: string) => path.join(jobDir(id), "job.json");
const itemFile = (jobId: string, itemId: string) => path.join(jobDir(jobId), "items", `${itemId}.json`);

function saveJob(job: Job) {
  fs.mkdirSync(path.join(jobDir(job.id), "items"), { recursive: true });
  fs.writeFileSync(jobFile(job.id) + ".tmp", JSON.stringify(job, null, 1));
  fs.renameSync(jobFile(job.id) + ".tmp", jobFile(job.id));
}

export function listJobs(): Job[] {
  if (!fs.existsSync(DRAFTS_DIR)) return [];
  return fs.readdirSync(DRAFTS_DIR)
    .filter((d) => fs.existsSync(jobFile(d)))
    .map((d) => JSON.parse(fs.readFileSync(jobFile(d), "utf8")) as Job)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getJob(id: string): Job {
  if (!fs.existsSync(jobFile(id))) throw new AiError("Không tìm thấy job.", 404);
  return JSON.parse(fs.readFileSync(jobFile(id), "utf8")) as Job;
}

export function readDraft(jobId: string, itemId: string): unknown {
  const f = itemFile(jobId, itemId);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
}

const TASKS: Record<Skill, string[]> = {
  reading: READING_PARTS.map((p) => p.id), listening: LISTENING_PARTS.map((p) => p.id),
  writing: WRITING_TASKS.map((t) => t.id), speaking: SPEAKING_TASKS.map((t) => t.id),
};

export function createJob(opts: {
  skill: JobSkill; taskType?: string; setType?: string; count: number; focus?: string | null; topic?: string | null;
  difficulty?: number | null; aiReview?: boolean; effort?: Effort;
}): Job {
  const count = Math.max(1, Math.min(opts.count, 25)); // small batches only
  if (opts.skill !== "vocabulary") {
    if (!opts.taskType || !TASKS[opts.skill].includes(opts.taskType)) throw new AiError(`taskType không hợp lệ cho ${opts.skill}.`, 400);
  }
  const objective = opts.skill === "reading" || opts.skill === "listening";
  const setType = opts.skill === "vocabulary" ? "vocabulary" : opts.setType ?? (objective ? "full" : "practice");
  if (objective && !["full", "drill", "mock"].includes(setType)) throw new AiError("setType phải là full | drill | mock.", 400);
  if (!objective && opts.skill !== "vocabulary" && !["practice", "mock"].includes(setType)) throw new AiError("setType phải là practice | mock.", 400);
  if (opts.topic && !(TOPICS as readonly string[]).includes(opts.topic)) throw new AiError("topic không hợp lệ.", 400);

  const id = `job-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
  const short = id.slice(-6);
  const prefix = opts.skill === "vocabulary" ? `v-${opts.topic ?? "mixed"}` : `${opts.taskType!.toLowerCase()}-${setType}`;
  const job: Job = {
    id, createdAt: new Date().toISOString(), skill: opts.skill, taskType: opts.taskType ?? "", setType, count,
    focus: opts.focus ?? null, topic: opts.topic ?? null, difficulty: opts.difficulty ?? null,
    aiReview: opts.aiReview ?? true, effort: opts.effort ?? "medium", model: MODEL,
    drafts: Array.from({ length: opts.skill === "vocabulary" ? 1 : count }, (_, i) => ({
      id: opts.skill === "vocabulary" ? `${prefix}-${short}` : `${prefix}-g${short}-${String(i + 1).padStart(2, "0")}`,
      index: i, status: "pending", error: null, topic: "", difficulty: 0, issues: [], aiReview: null, decision: "pending", imported: false,
    })),
    usage: { calls: 0, failedCalls: 0, promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 },
    running: false, lastError: null,
  };
  saveJob(job);
  return job;
}

/** Topics least represented for this task type come first, so the library stays varied. */
function rotateTopics(taskType: string): string[] {
  const counts = new Map<string, number>(TOPICS.map((t) => [t, 0]));
  for (const it of library().items.values()) if (it.taskType === taskType && it.topic) counts.set(it.topic, (counts.get(it.topic) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

function existingTitles(skill: JobSkill): string[] {
  return [...library().all.values()].filter((x) => x.item.kind === skill).map((x) => x.item.title);
}

const running = new Set<string>();

/** Runs (or resumes) a job: only drafts still "pending" or "failed" are generated. */
export async function runJob(jobId: string, opts: { log?: (s: string) => void; difficultyFor?: (taskType: string) => number } = {}): Promise<Job> {
  if (running.has(jobId)) throw new AiError("Job đang chạy.", 409);
  const log = opts.log ?? (() => {});
  const job = getJob(jobId);
  running.add(jobId);
  job.running = true;
  job.lastError = null;
  saveJob(job);
  const off = onUsage((u) => {
    job.usage.calls += 1;
    if (!u.ok) job.usage.failedCalls += 1;
    job.usage.promptTokens += u.promptTokens;
    job.usage.outputTokens += u.outputTokens;
    job.usage.thoughtsTokens += u.thoughtsTokens;
    job.usage.totalTokens += u.totalTokens;
  });
  try {
    if (job.skill === "vocabulary") {
      const d = job.drafts[0];
      if (d.status !== "generated") {
        const topic = job.topic ?? "workplace";
        const existing = library().vocab.map((v) => v.term);
        const { entries } = await generateVocab(topic, job.count, existing);
        const list: VocabEntry[] = entries.map((e, i) => ({ ...e, id: `${d.id}-${String(i + 1).padStart(3, "0")}`, topic: topic as VocabEntry["topic"] }));
        fs.writeFileSync(itemFile(job.id, d.id), JSON.stringify(list, null, 2));
        d.issues = [...validateVocab(list, d.id), ...validateCollection([], [...library().vocab.map((entry) => ({ entry, file: "library" })), ...list.map((entry) => ({ entry, file: d.id }))]).filter((i) => i.file === d.id)];
        d.status = "generated";
        d.topic = topic;
        log(`  ✓ ${list.length} vocabulary entries (${d.issues.filter((i) => i.severity === "error").length} errors)`);
      }
      saveJob(job);
      return job;
    }

    const topics = rotateTopics(job.taskType);
    const skill = job.skill as Skill;
    for (const d of job.drafts) {
      if (d.status === "generated") continue;
      d.topic = job.topic ?? topics[d.index % topics.length];
      d.difficulty = job.difficulty ?? opts.difficultyFor?.(job.taskType) ?? 7;
      log(`  … ${d.id} (${d.topic}, difficulty ${d.difficulty})`);
      try {
        const body = await generateItem({
          skill, taskType: job.taskType, setType: job.setType, difficulty: d.difficulty, topic: d.topic, focus: job.focus,
          avoidTitles: existingTitles(skill), effort: job.effort,
        });
        const part = [...READING_PARTS, ...LISTENING_PARTS].find((p) => p.id === job.taskType);
        const minutes = skill === "writing" ? (job.taskType === "W1" ? 27 : 26) : skill === "speaking" ? 3 : job.setType === "drill" ? 7 : part?.minutes ?? 10;
        const item = withQuestionIds({
          ...body, id: d.id, kind: skill, taskType: job.taskType, setType: job.setType, difficulty: d.difficulty, topic: d.topic,
          estimatedMinutes: minutes, source: "ai-generated", review: { status: "draft", reviewedBy: "", notes: "" },
          createdAt: new Date().toISOString(), focus: [],
        } as LibraryItem);
        fs.writeFileSync(itemFile(job.id, d.id), JSON.stringify(item, null, 2));
        // Automatic validation, including duplicate detection against the active library.
        const others = [...library().all.values()].map((x) => ({ item: x.item, file: x.file }));
        d.issues = [...validateItem(item, d.id), ...validateCollection([...others, { item, file: d.id }], []).filter((i) => i.file === d.id)];
        d.status = "generated";
        d.error = null;
        const errors = d.issues.filter((i) => i.severity === "error").length;
        log(`    generated — ${errors} validation error(s)`);
        // Independent AI review only for structurally valid items (saves quota).
        if (job.aiReview && errors === 0) {
          try {
            d.aiReview = await reviewItem(item);
            log(`    AI review: ${d.aiReview.verdict}${d.aiReview.issues.length ? ` (${d.aiReview.issues.length} issue(s))` : ""}`);
          } catch (e) {
            d.aiReview = null;
            log(`    AI review failed: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        d.status = "failed";
        d.error = e instanceof Error ? e.message : String(e);
        log(`    ✗ ${d.error}`);
        if (e instanceof AiError && [401, 429, 503].includes(e.status)) {
          job.lastError = d.error;
          break; // stop the batch; resume later
        }
      }
      saveJob(job);
    }
    return job;
  } finally {
    off();
    job.running = false;
    running.delete(jobId);
    saveJob(job);
  }
}

export function decide(jobId: string, itemId: string, decision: "approved" | "rejected" | "pending", notes = ""): Job {
  const job = getJob(jobId);
  const d = job.drafts.find((x) => x.id === itemId);
  if (!d || d.status !== "generated") throw new AiError("Bản nháp chưa được tạo.", 400);
  if (decision === "approved" && d.issues.some((i) => i.severity === "error")) throw new AiError("Không thể duyệt: bản nháp còn lỗi kiểm tra tự động.", 400);
  d.decision = decision;
  if (notes) d.issues.push({ severity: "warning", id: itemId, file: itemId, message: `review note: ${notes}` });
  saveJob(job);
  return job;
}

/**
 * Imports approved drafts into the active library. On the server the target is $DATA_DIR/library;
 * from the CLI it can be content/ so the items can be committed to git.
 */
export function importApproved(opts: { jobId?: string; target?: "library" | "content"; reviewer?: string } = {}): { imported: string[]; skipped: string[] } {
  const root = opts.target === "content" ? CONTENT_DIR : LIBRARY_DIR;
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const job of opts.jobId ? [getJob(opts.jobId)] : listJobs()) {
    for (const d of job.drafts) {
      if (d.decision !== "approved" || d.imported) continue;
      const data = readDraft(job.id, d.id);
      if (!data) { skipped.push(d.id); continue; }
      const reviewedBy = opts.reviewer ?? "human (admin approval)" + (d.aiReview ? ` + AI review: ${d.aiReview.verdict}` : "");
      if (job.skill === "vocabulary") {
        const dir = path.join(root, "vocabulary");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${d.id}.json`), JSON.stringify(data, null, 2) + "\n");
      } else {
        const item = { ...(data as LibraryItem), review: { status: "approved" as const, reviewedBy, notes: d.aiReview?.issues.join(" | ") ?? "" } };
        if (validateItem(item, d.id).some((i) => i.severity === "error")) { skipped.push(d.id); continue; }
        writeLibraryItem(item, root);
      }
      d.imported = true;
      imported.push(d.id);
    }
    saveJob(job);
  }
  reloadLibrary();
  return { imported, skipped };
}

export const defaultTaskList = TASKS;
