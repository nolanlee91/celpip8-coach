// Layer B: exercise selection from the prebuilt library — replaces on-demand AI generation.
// Picks the weakest task type at the learner's current difficulty, preferring unused or
// least-recently-used items, and never calls an AI API.

import type { LibraryItem, MockPackage } from "../shared/content";
import type { Db, ListeningSet, McqQuestion, Mode } from "../shared/types";
import { CATEGORIES, SKILL_LABEL, taskName, type Skill } from "../shared/spec";
import { library } from "./library";
import { audioStatus } from "./audio";
import { PART_IDS, weakestTask } from "./analytics";
import { addDays, today } from "./db";

export interface SelectOpts {
  skill: Skill;
  mode: Mode; // learn | drill | weekly (exam uses mock packages)
  taskType?: string;
  focus?: string; // weakness category for drills
  difficulty?: number;
  topic?: string;
  status?: "new" | "done" | "any";
}

export interface CandidateRow {
  id: string;
  taskType: string;
  setType: string;
  title: string;
  topic: string;
  difficulty: number;
  estimatedMinutes: number;
  questions: number;
  focusShare: number; // share of questions testing opts.focus (0–1)
  attempts: number;
  lastAttemptAt: string | null;
  lastScore: string | null;
  audio: "ready" | "pending" | "browser-voice" | null;
}

const RECENT_DAYS = 7;

const questionsOf = (item: LibraryItem): McqQuestion[] =>
  item.kind === "reading" ? item.questions : item.kind === "listening" ? item.chunks.flatMap((c) => c.questions) : [];

function setTypesFor(skill: Skill, mode: Mode): string[] {
  if (skill === "writing" || skill === "speaking") return ["practice"];
  return mode === "drill" ? ["drill", "full"] : ["full"];
}

/** Lists library items for a skill with the learner's history; used by the browser UI and the selector. */
export function candidates(db: Db, opts: SelectOpts): CandidateRow[] {
  const lib = library();
  const types = setTypesFor(opts.skill, opts.mode);
  const rows: CandidateRow[] = [];
  for (const item of lib.items.values()) {
    if (item.kind !== opts.skill) continue;
    const setType = (item as { setType?: string }).setType ?? "";
    if (!types.includes(setType)) continue;
    if (opts.taskType && item.taskType !== opts.taskType) continue;
    if (opts.topic && item.topic !== opts.topic) continue;
    if (opts.difficulty && item.difficulty !== opts.difficulty) continue;

    const atts = db.attempts.filter((a) => a.contentId === item.id);
    const last = atts[atts.length - 1];
    if (opts.status === "new" && atts.length) continue;
    if (opts.status === "done" && !atts.length) continue;

    let audio: CandidateRow["audio"] = null;
    if (item.kind === "listening") {
      audio = audioStatus(item as ListeningSet).ready ? "ready" : db.settings.allowBrowserVoice ? "browser-voice" : "pending";
    }
    const qs = questionsOf(item);
    rows.push({
      id: item.id, taskType: item.taskType, setType, title: item.title, topic: item.topic ?? "", difficulty: item.difficulty,
      estimatedMinutes: item.estimatedMinutes ?? 0, questions: qs.length,
      focusShare: opts.focus && qs.length ? qs.filter((q) => q.category === opts.focus).length / qs.length : 0,
      attempts: atts.length, lastAttemptAt: last?.finishedAt ?? null,
      lastScore: last ? (last.total ? `${last.correct}/${last.total}` : last.estimatedBand ? `~${last.estimatedBand[0]}–${last.estimatedBand[1]}` : "đã nộp") : null,
      audio,
    });
  }
  return rows.sort((a, b) => a.taskType.localeCompare(b.taskType) || a.difficulty - b.difficulty || a.id.localeCompare(b.id));
}

export type Selection =
  | { ok: true; item: LibraryItem; reason: string; repeated: boolean; browserVoice: boolean }
  | { ok: false; message: string };

export function selectNext(db: Db, opts: SelectOpts): Selection {
  const all = candidates(db, { ...opts, taskType: undefined }).filter((r) => r.audio !== "pending");
  const label = SKILL_LABEL[opts.skill];
  if (!all.length) {
    const pendingAudio = opts.skill === "listening" && candidates(db, opts).some((r) => r.audio === "pending");
    return {
      ok: false,
      message: pendingAudio
        ? "Các bài Listening trong thư viện đang chờ tạo audio. Hãy chạy tạo audio ở trang Quản trị (cần Gemini key một lần), hoặc bật “giọng đọc trình duyệt” trong Cài đặt."
        : `Thư viện chưa có bài ${label} phù hợp với bộ lọc này. Thêm nội dung qua trang Quản trị hoặc thư mục content/.`,
    };
  }

  // 1–2. Skill → task type: explicit, else the weakest task type that has content.
  const available = [...new Set(all.map((r) => r.taskType))];
  let taskType = opts.taskType;
  let why: string[] = [];
  if (taskType && !available.includes(taskType)) {
    return { ok: false, message: `Chưa có bài ${taskName(taskType)} phù hợp${opts.mode === "drill" ? " cho drill này" : ""} trong thư viện.` };
  }
  if (!taskType && opts.mode === "drill" && opts.focus) {
    // For drills, the task type is whichever has the most questions on the focus category.
    const best = all.filter((r) => r.focusShare > 0).sort((a, b) => b.focusShare - a.focusShare)[0];
    taskType = best?.taskType;
  }
  if (!taskType) {
    const exclude = PART_IDS[opts.skill].filter((id) => !available.includes(id));
    taskType = weakestTask(db, opts.skill, exclude);
    why.push(`dạng bài cần ưu tiên: ${taskName(taskType)}`);
  }

  // 3. Target difficulty for that task type.
  const target = opts.difficulty ?? db.settings.difficulty[taskType] ?? 7;
  const pool = all.filter((r) => r.taskType === taskType && (opts.mode !== "drill" || !opts.focus || r.focusShare > 0));
  if (!pool.length) return { ok: false, message: `Chưa có bài ${taskName(taskType)} phù hợp trong thư viện.` };

  // 4–5. Prefer never-used, then not-recent least-recently-used; then closest difficulty; drills prefer real drills with high focus share.
  const recentCut = addDays(today(), -RECENT_DAYS);
  const rank = (r: CandidateRow) => [
    r.attempts === 0 ? 0 : (r.lastAttemptAt ?? "").slice(0, 10) >= recentCut ? 2 : 1,
    Math.abs(r.difficulty - target),
    opts.mode === "drill" ? (r.setType === "drill" ? 0 : 1) : 0,
    -r.focusShare,
    r.lastAttemptAt ?? "",
  ];
  const cmp = (a: CandidateRow, b: CandidateRow) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] < rb[i] ? -1 : 1;
    return a.id.localeCompare(b.id);
  };
  const pick = [...pool].sort(cmp)[0];
  const item = library().items.get(pick.id)!;
  const repeated = pick.attempts > 0;
  why = [
    ...why,
    `độ khó ${pick.difficulty} (mục tiêu ${target})`,
    opts.focus ? `drill: ${CATEGORIES[opts.skill][opts.focus] ?? opts.focus} (${Math.round(pick.focusShare * 100)}% câu)` : "",
    repeated ? `làm lại — đã hết bài mới phù hợp (lần trước ${pick.lastScore})` : "bài mới chưa làm",
  ].filter(Boolean);
  return { ok: true, item, reason: why.join(" · "), repeated, browserVoice: pick.audio === "browser-voice" };
}

// ---------------- Mock packages ----------------

export interface PackageStatus {
  pkg: MockPackage;
  valid: boolean;
  available: boolean;
  problems: string[];
  timesTaken: number;
  browserVoice: boolean;
}

export function mockPackages(db: Db): PackageStatus[] {
  const lib = library();
  return lib.mocks.map(({ pkg, valid }) => {
    const problems: string[] = [];
    if (!valid) problems.push("Gói đề chưa qua kiểm tra (xem trang Quản trị).");
    let pendingAudio = 0;
    for (const id of pkg.listening ?? []) {
      const it = lib.items.get(id);
      if (it?.kind === "listening" && !audioStatus(it).ready) pendingAudio++;
    }
    if (pendingAudio) problems.push(`${pendingAudio}/6 phần Listening chưa có audio.`);
    const browserVoice = pendingAudio > 0 && db.settings.allowBrowserVoice;
    return {
      pkg, valid,
      available: valid && (pendingAudio === 0 || browserVoice),
      problems,
      timesTaken: db.mockExams.filter((m) => m.packageId === pkg.id).length,
      browserVoice,
    };
  });
}
