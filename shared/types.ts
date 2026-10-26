import type { Skill } from "./spec";
import type { ContentSource, ObjectiveSetType, PromptSetType, ReviewInfo } from "./content";
import type { LessonProgress } from "./curriculum";

export type Mode = "learn" | "drill" | "exam" | "weekly";

export interface Srs {
  ease: number; // SM-2 ease factor
  interval: number; // days
  reps: number;
  due: string; // ISO date (yyyy-mm-dd)
  lapses: number;
}

// ---------- Generated content ----------

export interface McqOption {
  text: string;
  trap: string; // key of TRAPS ("none" for the correct option)
  whyVi: string; // Vietnamese explanation of why this option is right/wrong
}

export interface McqQuestion {
  id: string;
  number: number;
  prompt: string;
  options: McqOption[];
  answerIndex: number;
  category: string; // key of CATEGORIES[skill] — what the question tests
  evidence: string; // exact quote from passage/transcript supporting the answer
  explanationVi: string;
  vocabulary?: string[]; // terms (from the set's vocabulary) relevant to this question
}

/** Library metadata shared by every prebuilt item. Optional so legacy AI-generated items still load. */
export interface LibraryMeta {
  topic?: string;
  estimatedMinutes?: number;
  source?: ContentSource;
  review?: ReviewInfo;
}

export interface ReadingSection {
  label: string;
  kind: "text" | "table";
  text: string; // for blanks, uses markers like [[3]] for question number 3
  table: { caption: string; headers: string[]; rows: string[][] } | null;
}

export interface VocabSeed {
  term: string;
  vi: string;
  definition: string;
  example: string;
}

export interface ReadingSet extends LibraryMeta {
  id: string;
  kind: "reading";
  taskType: string; // R1..R4
  difficulty: number;
  title: string;
  sections: ReadingSection[];
  questions: McqQuestion[];
  vocabulary: VocabSeed[];
  createdAt: string;
  focus: string[];
  setType?: ObjectiveSetType;
}

export interface ListeningSegment {
  speaker: string;
  voice: "female_a" | "male_a" | "female_b" | "male_b" | "narrator";
  text: string;
}

export interface ListeningChunk {
  segments: ListeningSegment[];
  questions: McqQuestion[];
}

export interface ListeningSet extends LibraryMeta {
  id: string;
  kind: "listening";
  taskType: string; // L1..L6
  difficulty: number;
  title: string;
  context: string; // short scene-setting line shown before audio
  chunks: ListeningChunk[];
  vocabulary: VocabSeed[];
  createdAt: string;
  focus: string[];
  setType?: ObjectiveSetType;
}

export interface WritingPrompt extends LibraryMeta {
  id: string;
  kind: "writing";
  taskType: string; // W1 | W2
  difficulty: number;
  title: string;
  situation: string;
  instructions: string[]; // bullet points to address
  optionA: string | null; // survey options (W2)
  optionB: string | null;
  createdAt: string;
  setType?: PromptSetType;
  structure?: string[]; // suggested response outline
  modelResponse?: string; // Level 8+ style sample
  usefulExpressions?: { expression: string; usageVi: string }[];
  commonMistakes?: string[]; // Vietnamese
}

export interface SpeakingPrompt extends LibraryMeta {
  id: string;
  kind: "speaking";
  taskType: string; // S1..S8
  difficulty: number;
  title: string;
  prompt: string;
  svg: string | null; // illustrated scene for S3, S4, S8
  options: { title: string; details: string[] }[] | null; // S5
  createdAt: string;
  setType?: PromptSetType;
  structure?: string[];
  modelAnswer?: string; // Level 8+ style sample
  usefulExpressions?: { expression: string; usageVi: string }[];
  commonMistakes?: string[];
}

export type ContentItem = ReadingSet | ListeningSet | WritingPrompt | SpeakingPrompt;

// ---------- Learner activity ----------

export interface AttemptItem {
  questionId: string;
  number: number;
  category: string;
  correct: boolean;
  chosenIndex: number | null; // null = unanswered
  chosenTrap: string | null;
}

export interface Attempt {
  id: string;
  skill: Skill;
  taskType: string;
  mode: Mode;
  contentId: string;
  difficulty: number;
  startedAt: string;
  finishedAt: string;
  durationSec: number;
  correct: number;
  total: number;
  items: AttemptItem[];
  // Productive skills (AI estimate, never official)
  estimatedBand: [number, number] | null;
  evaluationId: string | null;
  mockExamId: string | null;
}

export interface MistakeRecord {
  id: string;
  skill: Skill;
  taskType: string;
  questionId: string;
  contentId: string;
  category: string;
  trap: string | null;
  difficulty: number;
  question: string;
  learnerResponse: string;
  correctAnswer: string;
  explanation: string;
  vocabulary: string[];
  priority: number; // 1 (low) – 5 (high)
  repeatCount: number;
  srs: Srs;
  createdAt: string;
  lastSeenAt: string;
  resolved: boolean;
}

export interface VocabItem {
  id: string;
  term: string;
  vi: string;
  definition: string;
  example: string;
  collocations: string[];
  synonyms: string[];
  celpipUsage: string;
  source: string; // e.g. "reading:R3", "writing-correction"
  enriched: boolean;
  srs: Srs;
  reviews: number;
  correctReviews: number;
  createdAt: string;
}

export interface Correction {
  original: string;
  corrected: string;
  explanationVi: string;
}

export interface Evaluation {
  id: string;
  skill: "writing" | "speaking";
  taskType: string;
  contentId: string;
  response: string; // essay or transcript
  meta: { wordCount: number; durationSec: number; audioFile: string | null; transcriptSource: "speech-to-text" | "typed" | null };
  bandLow: number;
  bandHigh: number;
  dimensions: { name: string; band: number; commentVi: string }[];
  strengths: string[];
  weaknesses: { category: string; descriptionVi: string }[];
  corrections: Correction[];
  improvedVersion: string;
  improvementNotesVi: string;
  reusableExpressions: { expression: string; usageVi: string }[];
  followUpExercise: string;
  audioCaveat: string | null;
  createdAt: string;
}

export interface StudyLogEntry {
  date: string; // yyyy-mm-dd
  minutes: number;
  skill: Skill | "vocab" | "review";
}

export interface MockExam {
  id: string;
  packageId: string | null; // prebuilt package; null for legacy AI-generated mocks
  createdAt: string;
  status: "preparing" | "ready" | "in_progress" | "grading" | "done" | "failed";
  progress: { done: number; total: number; error: string | null };
  listening: string[]; // content ids, L1..L6
  reading: string[]; // R1..R4
  writing: string[]; // W1, W2
  speaking: string[]; // S1..S8
  attemptIds: string[];
  // Writing/speaking responses collected during the exam; evaluated only after it ends.
  submissions: {
    skill: "writing" | "speaking";
    contentId: string;
    response: string;
    durationSec: number;
    transcriptSource: "speech-to-text" | "typed" | null;
    audioFile: string | null;
    chosenOption: string | null;
  }[];
  results: Partial<Record<Skill, { correct?: number; total?: number; estimate: number | null; pending?: number }>> | null;
  finishedAt: string | null;
}

export interface Settings {
  learnerName: string;
  officialScores: Record<Skill, number>;
  officialTestDate: string;
  targetLevel: number;
  planWeeks: number;
  dailyMinutes: 30 | 60 | 90 | 120;
  weights: Record<Skill, number>; // percentages summing to 100
  autoAdjust: boolean;
  startDate: string;
  difficulty: Record<string, number>; // per taskType, 5–10
  preferredVoice: string | null;
  effort: "low" | "medium" | "high";
  allowBrowserVoice: boolean; // explicit opt-in: use browser TTS for listening sets whose audio is pending
  aiCache: boolean; // reuse an earlier AI evaluation for an identical response
}

export interface WeeklyAssessment {
  id: string;
  week: number;
  date: string;
  estimates: Record<Skill, number | null>;
  weightsBefore: Record<Skill, number>;
  weightsAfter: Record<Skill, number>;
  note: string;
}

/** A writing/speaking response saved without AI; evaluated only when the learner asks. */
export interface Submission {
  id: string;
  skill: "writing" | "speaking";
  contentId: string;
  attemptId: string;
  response: string;
  durationSec: number;
  transcriptSource: "speech-to-text" | "typed" | null;
  audioFile: string | null;
  chosenOption: string | null;
  createdAt: string;
  status: "pending" | "evaluated" | "failed";
  evaluationId: string | null;
  lastError: string | null;
  mockExamId: string | null;
}

export interface AiUsageEntry {
  at: string;
  kind: string; // "evaluate-writing", "tutor", "tts", "generate:reading", ...
  model: string;
  ok: boolean;
  promptTokens: number;
  outputTokens: number;
  thoughtsTokens: number;
  totalTokens: number;
  error: string | null;
  cached: boolean;
}

export interface Db {
  version: 1;
  settings: Settings;
  content: Record<string, ContentItem>;
  attempts: Attempt[];
  mistakes: MistakeRecord[];
  vocab: VocabItem[];
  evaluations: Record<string, Evaluation>;
  studyLog: StudyLogEntry[];
  mockExams: MockExam[];
  weekly: WeeklyAssessment[];
  planCompletions: Record<string, string[]>; // date -> completed block ids
  lessons: Record<string, LessonProgress>; // Learn Mode progress, keyed by lesson id
  // Stored in ai.json (Layer C), separate from progress.json:
  submissions: Submission[];
  aiUsage: AiUsageEntry[];
  aiCache: Record<string, string>; // sha256(contentId + response) -> evaluation id
}

// ---------- Derived (server-computed) ----------

export interface CategoryStat {
  skill: Skill;
  category: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface SkillSummary {
  skill: Skill;
  official: number;
  target: number;
  estimate: number | null; // practice estimate, never official
  estimateBasis: string;
  accuracy: number | null; // objective skills
  attempts: number;
  recentTrend: number | null; // delta in accuracy last 5 vs prior 5
}

export interface PlanBlock {
  id: string;
  skill: Skill | "review";
  kind?: "learn" | "guided" | "lesson-review" | "vocab" | "mistakes" | "practice" | "exam" | "weekly";
  reason?: string; // why the coach picked this block (Vietnamese)
  lessonId?: string;
  title: string;
  detail: string;
  minutes: number;
  route: string; // client route to start the block
}

export interface DailyPlan {
  date: string;
  week: number;
  phase: { number: number; name: string; goal: string };
  minutes: number;
  blocks: PlanBlock[];
  completed: string[];
}

export interface Dashboard {
  learning?: unknown; // Learn Mode summary (server/learn-routes.ts learningSummary)
  settings: Settings;
  skills: SkillSummary[];
  categoryStats: CategoryStat[];
  topWeakness: CategoryStat | null;
  recommendation: string;
  plan: DailyPlan;
  streak: number;
  minutesToday: number;
  minutesWeek: number;
  minutesTotal: number;
  dueMistakes: number;
  dueVocab: number;
  recentMistakes: MistakeRecord[];
  readiness: { percent: number; ready: boolean; message: string };
  weeklyGoals: { label: string; done: number; target: number }[];
  accuracyTrend: { week: string; listening: number | null; reading: number | null }[];
}
