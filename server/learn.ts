// Learn Mode engine (Layer B, no AI): lesson progress, local grading, mastery check, spaced review,
// lesson mistakes → mistake notebook. Pure functions over the Db so they can be unit-tested.

import type { Db, MistakeRecord } from "../shared/types";
import {
  autoGraded, gradeExercise, outcomeFor, LESSON_STEPS,
  type Exercise, type GradeResult, type Lesson, type LessonProgress, type LessonResponse, type LessonRun, type LessonStatus, type LessonStep,
} from "../shared/curriculum";
import { isDue, logStudy, mistakePriority, newSrs, repeatCountFor, reviewSrs } from "./analytics";
import { today, uid } from "./db";

const now = () => new Date().toISOString();
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Status shown on the curriculum map. A mastered lesson whose review is due shows as "needs review". */
export function lessonStatus(db: Db, id: string): LessonStatus {
  const p = db.lessons[id];
  if (!p) return "not_started";
  if (p.status === "mastered" && p.srs && isDue(p.srs)) return "needs_review";
  return p.status;
}

/** A lesson counts as completed (unlocks dependants) once its mastery check reached at least "review". */
export const isCompleted = (p: LessonProgress | undefined) => Boolean(p?.runs.some((r) => r.outcome !== "repeat"));

/** Unfinished pass that can be resumed. */
export const inProgressPass = (p: LessonProgress | undefined) =>
  Boolean(p && p.step !== "result" && (p.runs.length === 0 || p.step !== "objective" || Object.keys(p.answers).length > 0));

export function prerequisitesMet(db: Db, lesson: Lesson): boolean {
  return lesson.prerequisites.every((id) => isCompleted(db.lessons[id]));
}

export function findExercise(lesson: Lesson, id: string): { ex: Exercise; section: "guided" | "independent" } | null {
  const g = lesson.guided.find((e) => e.id === id);
  if (g) return { ex: g, section: "guided" };
  const i = lesson.independent.find((e) => e.id === id);
  return i ? { ex: i, section: "independent" } : null;
}

/** Starts or resumes a lesson. restart = begin a fresh pass (history, mastery and review schedule are kept). */
export function startLesson(db: Db, lesson: Lesson, opts: { restart?: boolean } = {}): LessonProgress {
  const existing = db.lessons[lesson.id];
  if (existing && !opts.restart && existing.step !== "result") return existing;
  if (existing) {
    existing.step = "objective";
    existing.answers = {};
    existing.passTimeSec = 0;
    existing.updatedAt = now();
    return existing;
  }
  const p: LessonProgress = {
    lessonId: lesson.id, skill: lesson.skill, status: "in_progress", step: "objective", answers: {},
    startedAt: now(), updatedAt: now(), completedAt: null, runs: [], mastery: null, srs: null, reviews: [], timeSec: 0, passTimeSec: 0,
  };
  db.lessons[lesson.id] = p;
  return p;
}

/** Client-reported active seconds since the last call (capped so an idle tab does not inflate time). */
function addTime(p: LessonProgress, sec: number) {
  const s = Math.max(0, Math.min(Number(sec) || 0, 900));
  p.timeSec += s;
  p.passTimeSec = (p.passTimeSec ?? 0) + s;
}

export function setStep(db: Db, lesson: Lesson, step: LessonStep, timeSec = 0): LessonProgress {
  if (!LESSON_STEPS.includes(step) || step === "result") throw new Error("invalid step");
  const p = db.lessons[lesson.id] ?? startLesson(db, lesson);
  p.step = step;
  addTime(p, timeSec);
  p.updatedAt = now();
  return p;
}

/** Grades one guided/independent answer and stores it in the current pass. */
export function answerExercise(db: Db, lesson: Lesson, exerciseId: string, response: LessonResponse, timeSec = 0): GradeResult & { section: "guided" | "independent" } {
  const found = findExercise(lesson, exerciseId);
  if (!found) throw new Error(`exercise ${exerciseId} not found`);
  const p = db.lessons[lesson.id] ?? startLesson(db, lesson);
  const grade = gradeExercise(found.ex, response);
  p.answers[exerciseId] = { section: found.section, response, correct: grade.correct, score: grade.score, misconception: grade.misconception, at: now() };
  addTime(p, timeSec);
  p.updatedAt = now();
  if (p.step === "objective" || p.step === "concept" || p.step === "examples") p.step = found.section;
  return { ...grade, section: found.section };
}

/**
 * Mastery score of a pass: mean of independent exercises. Auto-graded items carry 75% of the weight
 * when the lesson also has self-assessed production exercises (which carry 25%), so a learner cannot
 * reach "mastered" on self-assessment alone. Unanswered exercises count as 0.
 */
export function masteryScore(lesson: Lesson, answers: LessonProgress["answers"]): number {
  const score = (e: Exercise) => (answers[e.id]?.section === "independent" ? answers[e.id].score : 0);
  const auto = lesson.independent.filter(autoGraded).map(score);
  const produce = lesson.independent.filter((e) => !autoGraded(e)).map(score);
  if (!produce.length) return round2(mean(auto));
  if (!auto.length) return round2(mean(produce));
  return round2(0.75 * mean(auto) + 0.25 * mean(produce));
}

/** SM-2 quality from a mastery score. */
export const qualityFor = (score: number) => (score >= 0.9 ? 5 : score >= 0.8 ? 4 : score >= 0.6 ? 3 : score >= 0.4 ? 2 : 1);

export interface LessonResult {
  run: LessonRun;
  progress: LessonProgress;
  analysis: { key: string; count: number; label: string; explanationVi: string; fixVi: string; competency: string | null }[];
  nextReview: string | null;
  mistakesAdded: number;
}

/** Ends the current pass: mastery check, mistake analysis, spaced-review scheduling, mistake notebook. */
export function completeLesson(db: Db, lesson: Lesson): LessonResult {
  const p = db.lessons[lesson.id] ?? startLesson(db, lesson);
  const answers = p.answers;
  const guided = lesson.guided.filter((e) => answers[e.id]?.section === "guided").map((e) => answers[e.id].score);
  const score = masteryScore(lesson, answers);
  const outcome = outcomeFor(score, lesson.mastery);

  const misconceptions: Record<string, number> = {};
  const competencyOf: Record<string, string> = {};
  for (const e of [...lesson.guided, ...lesson.independent]) {
    const a = answers[e.id];
    if (a?.misconception) {
      misconceptions[a.misconception] = (misconceptions[a.misconception] ?? 0) + 1;
      competencyOf[a.misconception] ??= e.competency;
    }
  }
  const wrong = lesson.independent.filter((e) => !answers[e.id]?.correct).map((e) => e.id);
  const passSec = Math.round(p.passTimeSec ?? 0);
  const run: LessonRun = {
    at: now(), guidedScore: guided.length ? round2(mean(guided)) : null, score, outcome, misconceptions, wrong, timeSec: Math.max(0, passSec),
  };
  p.runs.push(run);
  p.step = "result";
  p.completedAt = run.at;
  p.updatedAt = run.at;
  p.mastery = score;
  p.status = outcome === "advance" ? "mastered" : "needs_review";
  p.srs = reviewSrs(p.srs ?? newSrs(), qualityFor(score));

  const mistakesAdded = recordLessonMistakes(db, lesson, wrong.map((id) => lesson.independent.find((e) => e.id === id)!), answers);
  logStudy(db, lesson.skill, Math.max(60, run.timeSec));

  const analysis = Object.entries(misconceptions)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count, ...(lesson.misconceptions[key] ?? { label: key, explanationVi: "", fixVi: "" }), competency: competencyOf[key] ?? null }));
  return { run, progress: p, analysis, nextReview: p.srs.due, mistakesAdded };
}

/** Wrong auto-graded independent answers become mistake cards (re-answerable in the mistake review). */
function recordLessonMistakes(db: Db, lesson: Lesson, wrong: Exercise[], answers: LessonProgress["answers"]): number {
  let added = 0;
  for (const ex of wrong) {
    if (!autoGraded(ex)) continue;
    const questionId = `${lesson.id}:${ex.id}`;
    const existing = db.mistakes.find((m) => m.questionId === questionId && !m.resolved);
    if (existing) {
      existing.repeatCount += 1;
      existing.lastSeenAt = now();
      existing.srs = { ...existing.srs, due: today() };
      continue;
    }
    const a = answers[ex.id];
    const rc = repeatCountFor(db, lesson.skill, ex.competency);
    const m: MistakeRecord = {
      id: uid("m"), skill: lesson.skill, taskType: lesson.tasks[0] ?? "", questionId, contentId: lesson.id, category: ex.competency,
      trap: null, difficulty: lesson.difficulty, question: `[${lesson.title}] ${ex.prompt}`,
      learnerResponse: describeResponse(ex, a?.response), correctAnswer: correctAnswerText(ex),
      explanation: [ex.explanationVi, a?.misconception && lesson.misconceptions[a.misconception] ? `Lỗi tư duy: ${lesson.misconceptions[a.misconception].label} — ${lesson.misconceptions[a.misconception].fixVi}` : ""].filter(Boolean).join("\n"),
      vocabulary: [], priority: mistakePriority(db, lesson.skill, rc), repeatCount: rc, srs: newSrs(), createdAt: now(), lastSeenAt: now(), resolved: false,
    };
    db.mistakes.push(m);
    added++;
  }
  return added;
}

export function correctAnswerText(ex: Exercise): string {
  switch (ex.type) {
    case "choice": return ex.options[ex.answerIndex].text;
    case "text": return ex.answers[0];
    case "order": return ex.items.join(" → ");
    case "produce": return ex.modelAnswer;
  }
}

export function describeResponse(ex: Exercise, r: LessonResponse | undefined): string {
  if (r === undefined || r === null) return "(bỏ trống)";
  if (ex.type === "choice") return typeof r === "number" ? ex.options[r]?.text ?? "(bỏ trống)" : "(bỏ trống)";
  if (Array.isArray(r)) return r.join(" → ");
  if (typeof r === "object") return r.text;
  return String(r);
}

// ---------- Spaced review ----------

/** Review quiz: auto-graded independent exercises, previously wrong ones first, rotated across reviews. */
export function reviewExercises(lesson: Lesson, p: LessonProgress | undefined, n = 5): Exercise[] {
  const pool = lesson.independent.filter(autoGraded);
  const lastWrong = new Set(p?.runs.at(-1)?.wrong ?? []);
  const offset = (p?.reviews.length ?? 0) * 2;
  const rotated = pool.map((e, i) => ({ e, k: (i - offset + pool.length * 10) % pool.length }));
  return rotated.sort((a, b) => Number(lastWrong.has(b.e.id)) - Number(lastWrong.has(a.e.id)) || a.k - b.k).slice(0, n).map((x) => x.e);
}

export function submitReview(db: Db, lesson: Lesson, responses: Record<string, LessonResponse>, timeSec = 0) {
  const p = db.lessons[lesson.id];
  if (!p || !p.runs.length) throw new Error("lesson has not been completed yet");
  const items = Object.entries(responses).map(([id, r]) => {
    const ex = lesson.independent.find((e) => e.id === id);
    if (!ex) throw new Error(`exercise ${id} not found`);
    return { ex, response: r, grade: gradeExercise(ex, r) };
  });
  if (!items.length) throw new Error("no answers");
  const score = round2(mean(items.map((x) => x.grade.score)));
  p.reviews.push({ at: now(), score });
  p.srs = reviewSrs(p.srs ?? newSrs(), qualityFor(score));
  p.status = score >= lesson.mastery.advance ? "mastered" : "needs_review";
  p.mastery = round2(p.mastery === null ? score : 0.5 * p.mastery + 0.5 * score);
  p.timeSec += Math.max(0, Math.min(Number(timeSec) || 0, 900));
  p.updatedAt = now();
  const wrong = items.filter((x) => !x.grade.correct);
  const answers = Object.fromEntries(items.map((x) => [x.ex.id, { section: "review" as const, response: x.response, correct: x.grade.correct, score: x.grade.score, misconception: x.grade.misconception, at: now() }]));
  recordLessonMistakes(db, lesson, wrong.map((x) => x.ex), answers);
  logStudy(db, "review", Math.max(60, timeSec));
  return { score, status: p.status, nextReview: p.srs.due, results: items.map((x) => ({ id: x.ex.id, ...x.grade })) };
}

export function dueLessonReviews(db: Db): LessonProgress[] {
  return Object.values(db.lessons)
    .filter((p) => p.srs && p.runs.length && isDue(p.srs))
    .sort((a, b) => a.srs!.due.localeCompare(b.srs!.due));
}
