// Learn Mode curriculum schema (Layer A content). Lessons are authored as JSON under
// content/lessons/<skill>/<id>.json and ordered by content/lessons/curriculum.json.
// They are never generated while the learner studies; grading below is pure and local.

import type { Skill } from "./spec";
import type { ListeningSegment, Srs } from "./types";
import type { ContentSource, ReviewInfo } from "./content";

export type LessonLevel = "foundation" | "core" | "target8";

export interface CurriculumModule {
  id: string;
  skill: Skill;
  order: number;
  title: string;
  titleVi: string;
  goalVi: string;
  lessons: string[]; // lesson ids, in teaching order
}

/** content/lessons/curriculum.json */
export interface CurriculumMap {
  version: 1;
  modules: CurriculumModule[];
}

/** Shared material referenced by examples and exercises (a passage, an audio clip, a scene image). */
export interface Stimulus {
  title?: string;
  text?: string; // passage / email / prompt shown on screen (Markdown-lite)
  audio?: ListeningSegment[]; // pre-generated lesson clip (npm run audio:generate)
  audioRef?: { setId: string; chunk: number }; // reuse a chunk of an existing library listening set
  imageRef?: string; // id of a speaking prompt whose SVG scene is shown
  showTranscript?: "after" | "always" | "never"; // default "after" (after the learner answers)
}

export interface Comparison {
  label: "weak" | "acceptable" | "level8" | "before" | "after";
  text: string;
  commentVi: string; // why this version is weaker/stronger
}

export interface WorkedExample {
  id: string;
  title: string;
  stimulusId?: string;
  question?: string;
  steps: string[]; // step-by-step demonstration of the technique
  answer?: string;
  comparisons?: Comparison[];
  takeawayVi: string;
}

interface ExerciseBase {
  id: string;
  stimulusId?: string;
  prompt: string;
  hint?: string; // required in guided practice, forbidden in independent practice
  explanationVi: string; // shown after answering
  competency: string; // key of CATEGORIES[skill]
}

export interface ChoiceExercise extends ExerciseBase {
  type: "choice";
  options: { text: string; misconception: string | null; whyVi: string }[]; // null = correct option
  answerIndex: number;
  evidence?: string; // verbatim quote from the stimulus text/transcript
}

/** Short typed answer (gap fill, correction, dictation). */
export interface TextExercise extends ExerciseBase {
  type: "text";
  answers: string[]; // accepted answers (compared after normalization)
  mode: "exact" | "dictation"; // dictation = word-level match, ≥ 90% counts as correct
  misconception: string; // reported when the answer is wrong
}

/** Put items in the right order (e.g. parts of an email, steps of an answer). */
export interface OrderExercise extends ExerciseBase {
  type: "order";
  items: string[]; // in the correct order; shown shuffled
  misconception: string;
}

/** Open production (write or say). Self-assessed against a checklist + model; AI feedback is optional. */
export interface ProduceExercise extends ExerciseBase {
  type: "produce";
  medium: "write" | "speak";
  prepSec?: number;
  responseSec?: number;
  minWords?: number;
  checklist: string[]; // concrete, observable criteria
  modelAnswer: string;
  misconception: string; // reported when fewer than half of the checklist is met
}

export type Exercise = ChoiceExercise | TextExercise | OrderExercise | ProduceExercise;

export interface Misconception {
  label: string; // short Vietnamese label
  explanationVi: string; // the underlying skill gap
  fixVi: string; // what to do differently
}

export interface Lesson {
  id: string;
  skill: Skill;
  module: string;
  level: LessonLevel;
  difficulty: number; // 5–10, approximate CELPIP level the lesson targets
  title: string;
  titleVi: string;
  estimatedMinutes: number;
  prerequisites: string[];
  competencies: string[]; // keys of CATEGORIES[skill]
  tasks: string[]; // CELPIP task ids the lesson applies to (R1, L3, S5, W2…)
  objectives: string[]; // "You will be able to …" (English)
  objectiveVi: string;
  whyItMattersVi: string; // how this skill moves the learner toward Level 8
  concept: { heading: string; body: string }[];
  stimuli: Record<string, Stimulus>;
  examples: WorkedExample[];
  guided: Exercise[];
  independent: Exercise[];
  misconceptions: Record<string, Misconception>;
  mastery: { advance: number; review: number }; // independent-score thresholds (0–1)
  vocabulary: { term: string; vi: string; example: string }[]; // expressions taught in the lesson
  grammar: { point: string; explanationVi: string; examples: string[] }[];
  practice: { label: string; route: string }[]; // applied practice in Practice Mode after the lesson
  source: ContentSource;
  review: ReviewInfo;
}

// ---------- Learner progress (progress.json) ----------

export type LessonStep = "objective" | "concept" | "examples" | "guided" | "independent" | "result";
export const LESSON_STEPS: LessonStep[] = ["objective", "concept", "examples", "guided", "independent", "result"];

export type LessonStatus = "not_started" | "in_progress" | "needs_review" | "mastered";
export type LessonOutcome = "advance" | "review" | "repeat";

export type LessonResponse = number | string | string[] | { text: string; checked: number[] };

export interface LessonAnswer {
  section: "guided" | "independent" | "review";
  response: LessonResponse;
  correct: boolean;
  score: number; // 0–1
  misconception: string | null;
  at: string;
}

export interface LessonRun {
  at: string;
  guidedScore: number | null;
  score: number; // independent score 0–1 (the mastery check)
  outcome: LessonOutcome;
  misconceptions: Record<string, number>;
  wrong: string[]; // independent exercise ids answered incorrectly
  timeSec: number;
}

export interface LessonProgress {
  lessonId: string;
  skill: Skill;
  status: Exclude<LessonStatus, "not_started">;
  step: LessonStep;
  answers: Record<string, LessonAnswer>; // current pass, keyed by exercise id
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  runs: LessonRun[];
  mastery: number | null; // best recent mastery score 0–1
  srs: Srs | null; // spaced review schedule once the lesson is completed
  reviews: { at: string; score: number }[];
  timeSec: number; // total, all passes and reviews
  passTimeSec: number; // current pass
}

// ---------- Grading (pure; shared by server, client and tests) ----------

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/[.,!?;:"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tokens = (s: string) => normalizeAnswer(s).split(" ").filter(Boolean);

/** Longest common subsequence of word tokens: fraction of expected words heard in order. */
export function dictationAccuracy(expected: string, actual: string): { accuracy: number; missing: string[] } {
  const a = tokens(expected);
  const b = tokens(actual);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  }
  const matched = new Set<number>();
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    if (a[i - 1] === b[j - 1]) { matched.add(i - 1); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  // Words typed beyond the length of the sentence are penalised (a misheard word is already a miss).
  const extra = Math.max(0, b.length - a.length);
  const accuracy = a.length ? Math.max(0, (dp[a.length][b.length] - extra * 0.5) / a.length) : 0;
  return { accuracy, missing: a.filter((_, i) => !matched.has(i)) };
}

export interface GradeResult {
  correct: boolean;
  score: number;
  misconception: string | null;
  detail?: string; // e.g. missing dictation words
}

export function gradeExercise(ex: Exercise, response: LessonResponse): GradeResult {
  switch (ex.type) {
    case "choice": {
      const i = typeof response === "number" ? response : -1;
      const correct = i === ex.answerIndex;
      return { correct, score: correct ? 1 : 0, misconception: correct ? null : ex.options[i]?.misconception ?? null };
    }
    case "text": {
      const text = typeof response === "string" ? response : "";
      if (ex.mode === "dictation") {
        const best = ex.answers.map((a) => dictationAccuracy(a, text)).sort((x, y) => y.accuracy - x.accuracy)[0];
        const correct = best.accuracy >= 0.9;
        return { correct, score: Math.round(best.accuracy * 100) / 100, misconception: correct ? null : ex.misconception, detail: best.missing.length ? `Thiếu/sai: ${best.missing.join(", ")}` : undefined };
      }
      const correct = ex.answers.some((a) => normalizeAnswer(a) === normalizeAnswer(text));
      return { correct, score: correct ? 1 : 0, misconception: correct ? null : ex.misconception };
    }
    case "order": {
      const list = Array.isArray(response) ? response : [];
      const inPlace = ex.items.filter((it, i) => list[i] === it).length;
      const correct = inPlace === ex.items.length;
      return { correct, score: Math.round((inPlace / ex.items.length) * 100) / 100, misconception: correct ? null : ex.misconception };
    }
    case "produce": {
      const r = typeof response === "object" && response !== null && !Array.isArray(response) ? response : { text: "", checked: [] };
      const checked = new Set(r.checked.filter((i) => i >= 0 && i < ex.checklist.length));
      const enough = r.text.trim().split(/\s+/).filter(Boolean).length >= Math.min(ex.minWords ?? 5, 5);
      const score = enough ? checked.size / ex.checklist.length : 0;
      const correct = score >= 0.75;
      return { correct, score: Math.round(score * 100) / 100, misconception: score < 0.5 ? ex.misconception : null };
    }
  }
}

/** Default thresholds: ≥ 80% advance, 60–79% review soon, < 60% repeat the lesson. */
export function outcomeFor(score: number, mastery: Lesson["mastery"]): LessonOutcome {
  if (score >= mastery.advance) return "advance";
  if (score >= mastery.review) return "review";
  return "repeat";
}

export const autoGraded = (ex: Exercise) => ex.type !== "produce";
