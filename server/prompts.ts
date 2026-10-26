// Gemini prompts + JSON schemas.
// - Evaluation (writing/speaking) and the tutor: used by the app, only on explicit learner request.
// - Generation + AI review: used ONLY by the admin content pipeline (never during practice).

import fs from "node:fs";
import path from "node:path";
import { arr, callJSON, enumOf, int, nullable, obj, str, type Effort } from "./ai";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, TRAPS, WRITING_TASKS, type Skill } from "../shared/spec";
import { TOPICS, type LibraryItem } from "../shared/content";
import type { SpeakingPrompt, VocabSeed, WritingPrompt } from "../shared/types";

const LEARNER =
  "The learner is a Vietnamese adult living and working in British Columbia, Canada, with a background in " +
  "accounting, logistics and operations. Official CELPIP-General results (Apr 2026): Listening 6, Reading 5, " +
  "Writing 7, Speaking 6. Goal: Level 8+ in every skill.";

/** The authoring guide is the single source of truth for content format and quality rules. */
function guide(): string {
  try { return fs.readFileSync(path.resolve(process.env.CONTENT_DIR || "content", "CONTENT_GUIDE.md"), "utf8"); } catch { return ""; }
}

// ---------------- Generation (admin pipeline only) ----------------

const mcqSchema = (categories: string[]) => obj({
  number: int(),
  prompt: str(),
  options: arr(obj({ text: str(), trap: enumOf(Object.keys(TRAPS)), whyVi: str() })),
  answerIndex: int("0-based index of the correct option"),
  category: enumOf(categories),
  evidence: str("Exact verbatim quote from the passage/transcript"),
  explanationVi: str(),
  vocabulary: arr(str()),
});
const vocabSeeds = arr(obj({ term: str(), vi: str(), definition: str(), example: str() }));
const usefulExpr = arr(obj({ expression: str(), usageVi: str() }));

const GENERATOR_SYSTEM = () => [
  "You author ORIGINAL, high-quality CELPIP-General practice content for one learner's personal study library. Output must follow the content guide below exactly; it is validated automatically and then reviewed. Never claim content is official.",
  LEARNER,
  "=== CONTENT GUIDE ===",
  guide(),
].join("\n\n");

export interface GenerateArgs {
  skill: Skill;
  taskType: string;
  setType: string;
  difficulty: number;
  topic: string;
  focus: string | null;
  avoidTitles: string[];
  effort: Effort;
}

/** Returns the item body (without id/metadata, which the pipeline fills in). */
export async function generateItem(a: GenerateArgs): Promise<Partial<LibraryItem>> {
  const base = [
    `Create ONE ${a.skill} item. taskType ${a.taskType}, setType "${a.setType}", difficulty ${a.difficulty}, topic "${a.topic}".`,
    a.focus ? `This is a drill: at least 70% of questions must test the category "${a.focus}".` : "",
    a.avoidTitles.length ? `It must be clearly different from these existing items: ${a.avoidTitles.slice(-40).join("; ")}.` : "",
    "Return only the fields in the schema.",
  ].filter(Boolean).join("\n");

  if (a.skill === "reading") {
    return callJSON({
      kind: `generate:${a.taskType}`, system: GENERATOR_SYSTEM(), user: base, effort: a.effort,
      schema: obj({
        title: str(),
        sections: arr(obj({ label: str(), kind: enumOf(["text", "table"]), text: str(), table: nullable(obj({ caption: str(), headers: arr(str()), rows: arr(arr(str())) })) })),
        questions: arr(mcqSchema(Object.keys(CATEGORIES.reading).filter((c) => c !== "time_management"))),
        vocabulary: vocabSeeds,
      }),
    });
  }
  if (a.skill === "listening") {
    return callJSON({
      kind: `generate:${a.taskType}`, system: GENERATOR_SYSTEM(), user: base, effort: a.effort,
      schema: obj({
        title: str(),
        context: str(),
        chunks: arr(obj({
          segments: arr(obj({ speaker: str(), voice: enumOf(["female_a", "male_a", "female_b", "male_b", "narrator"]), text: str() })),
          questions: arr(mcqSchema(Object.keys(CATEGORIES.listening))),
        })),
        vocabulary: vocabSeeds,
      }),
    });
  }
  if (a.skill === "writing") {
    return callJSON<Partial<WritingPrompt>>({
      kind: `generate:${a.taskType}`, system: GENERATOR_SYSTEM(), user: base, effort: "low",
      schema: obj({
        title: str(), situation: str(), instructions: arr(str()), optionA: nullable(str()), optionB: nullable(str()),
        structure: arr(str()), modelResponse: str(), usefulExpressions: usefulExpr, commonMistakes: arr(str()),
      }),
    });
  }
  return callJSON<Partial<SpeakingPrompt>>({
    kind: `generate:${a.taskType}`, system: GENERATOR_SYSTEM(), user: base, effort: "medium",
    schema: obj({
      title: str(), prompt: str(), svg: nullable(str()), options: nullable(arr(obj({ title: str(), details: arr(str()) }))),
      structure: arr(str()), modelAnswer: str(), usefulExpressions: usefulExpr, commonMistakes: arr(str()),
    }),
  });
}

export interface AiReview {
  verdict: "pass" | "fail";
  issues: string[];
  ambiguousQuestions: number[];
  wrongKeys: number[];
}

/** Independent second-pass review of a generated item (separate call, reviewer persona). */
export function reviewItem(item: LibraryItem): Promise<AiReview> {
  return callJSON<AiReview>({
    kind: `review:${item.taskType}`,
    system: [
      "You are a strict, independent CELPIP item reviewer. You did not write this item. Your job is to find problems, not to praise.",
      "Check: (1) every answer key is correct and supported by the text; (2) no question has two defensible answers; (3) distractors are clearly wrong by the text yet plausible; (4) the item matches its CELPIP task format and stated difficulty; (5) English is natural and Canadian; (6) Vietnamese explanations are accurate; (7) content is original, not generic.",
      "verdict \"pass\" only if there are no answer-key errors, no ambiguity, and no serious format problems.",
      "=== CONTENT GUIDE ===", guide(),
    ].join("\n\n"),
    user: `Review this item:\n${JSON.stringify(item)}`,
    schema: obj({ verdict: enumOf(["pass", "fail"]), issues: arr(str()), ambiguousQuestions: arr(int()), wrongKeys: arr(int()) }),
    effort: "high",
  });
}

export function generateVocab(topic: string, count: number, existing: string[]) {
  return callJSON<{ entries: { term: string; definition: string; vi: string; example: string; collocations: string[]; synonyms: string[]; difficulty: number; tasks: string[] }[] }>({
    kind: "generate:vocabulary",
    system: [GENERATOR_SYSTEM(), "You are now writing vocabulary entries (guide section 6)."].join("\n\n"),
    user: `Create ${count} entries for topic "${topic}". Do not repeat any of these terms: ${existing.slice(-300).join(", ")}.`,
    schema: obj({ entries: arr(obj({ term: str(), definition: str(), vi: str(), example: str(), collocations: arr(str()), synonyms: arr(str()), difficulty: int(), tasks: arr(str()) })) }),
    effort: "low",
  });
}

export const GENERATABLE = {
  reading: READING_PARTS.map((p) => p.id),
  listening: LISTENING_PARTS.map((p) => p.id),
  writing: WRITING_TASKS.map((t) => t.id),
  speaking: SPEAKING_TASKS.map((t) => t.id),
};
export const ALL_TOPICS = TOPICS;

// ---------------- Evaluation (writing + speaking, on learner request) ----------------

const EVAL_SYSTEM = [
  "You are an experienced CELPIP-General writing and speaking coach. You give an UNOFFICIAL estimated level range, never an official score, and never claim your estimate equals an official result.",
  LEARNER,
  "Assess using the publicly described CELPIP performance dimensions. Writing: Content/Coherence, Vocabulary, Readability, Task Fulfillment. Speaking: Content/Coherence, Vocabulary, Listenability, Task Fulfillment. Use a level range of at most 1.5 levels (e.g. 7–8). Be calibrated and honest: do not inflate.",
  "Explanations (fields ending in Vi) are in clear, concise Vietnamese. Corrections, improved versions and expressions are in English.",
  "corrections: the most important sentence-level fixes (up to 10), quoting the learner's original sentence exactly.",
  "improvedVersion: a natural Level 8–9 style rewrite that keeps the learner's ideas and stays within the task's length/time.",
  "weaknesses: the top three, each tagged with a category.",
  "followUpExercise: one short, specific exercise (in English, with a Vietnamese hint) targeting the biggest weakness.",
  "vocabulary: up to 6 words/phrases worth adding to the learner's notebook (from your corrections and improved version).",
].join("\n\n");

const evalSchema = (categories: string[], dims: string[]) =>
  obj({
    bandLow: int(), bandHigh: int(),
    dimensions: arr(obj({ name: enumOf(dims), band: int(), commentVi: str() })),
    strengths: arr(str()),
    weaknesses: arr(obj({ category: enumOf(categories), descriptionVi: str() })),
    corrections: arr(obj({ original: str(), corrected: str(), explanationVi: str() })),
    improvedVersion: str(),
    improvementNotesVi: str(),
    reusableExpressions: arr(obj({ expression: str(), usageVi: str() })),
    followUpExercise: str(),
    vocabulary: arr(obj({ term: str(), vi: str(), definition: str(), example: str() })),
  });

export interface RawEvaluation {
  bandLow: number; bandHigh: number;
  dimensions: { name: string; band: number; commentVi: string }[];
  strengths: string[];
  weaknesses: { category: string; descriptionVi: string }[];
  corrections: { original: string; corrected: string; explanationVi: string }[];
  improvedVersion: string;
  improvementNotesVi: string;
  reusableExpressions: { expression: string; usageVi: string }[];
  followUpExercise: string;
  vocabulary: VocabSeed[];
}

export function evaluateWriting(args: { prompt: WritingPrompt; response: string; chosenOption: string | null; wordCount: number; minutesUsed: number; profile: string }) {
  const t = WRITING_TASKS.find((x) => x.id === args.prompt.taskType)!;
  return callJSON<RawEvaluation>({
    kind: "evaluate-writing",
    system: EVAL_SYSTEM,
    user: [
      `Skill: WRITING — Task ${t.task}: ${t.name} (${t.minWords}–${t.maxWords} words, ${t.minutes} minutes).`,
      `Situation: ${args.prompt.situation}`,
      `Instructions:\n- ${args.prompt.instructions.join("\n- ")}`,
      args.prompt.optionA ? `Option A: ${args.prompt.optionA}\nOption B: ${args.prompt.optionB}\nLearner chose: ${args.chosenOption ?? "not stated"}` : "",
      `The learner wrote ${args.wordCount} words in ${args.minutesUsed} minutes.`,
      `Learner profile:\n${args.profile}`,
      "Focus feedback on what separates this response from a consistent Level 8; the learner already scored 7 officially, so avoid generic advice.",
      `<response>\n${args.response}\n</response>`,
    ].filter(Boolean).join("\n\n"),
    schema: evalSchema(Object.keys(CATEGORIES.writing), ["Content/Coherence", "Vocabulary", "Readability", "Task Fulfillment"]),
    effort: "medium",
  });
}

export function evaluateSpeaking(args: {
  prompt: SpeakingPrompt; transcript: string; durationSec: number; transcriptSource: string; profile: string; chosenOption: string | null;
}) {
  const t = SPEAKING_TASKS.find((x) => x.id === args.prompt.taskType)!;
  const words = args.transcript.trim().split(/\s+/).filter(Boolean).length;
  const wpm = args.durationSec > 0 ? Math.round((words / args.durationSec) * 60) : 0;
  return callJSON<RawEvaluation>({
    kind: "evaluate-speaking",
    system: EVAL_SYSTEM,
    user: [
      `Skill: SPEAKING — Task ${t.task}: ${t.name} (${t.speakSec} seconds to speak).`,
      `Prompt: ${args.prompt.prompt}`,
      args.prompt.options ? `Options:\n${args.prompt.options.map((o) => `- ${o.title}: ${o.details.join("; ")}`).join("\n")}\nLearner chose: ${args.chosenOption ?? "unknown"}` : "",
      args.prompt.svg ? "(The learner was looking at an illustrated scene; judge description quality from the transcript.)" : "",
      `Spoken for ${args.durationSec}s of ${t.speakSec}s; ${words} words (~${wpm} wpm). Transcript source: ${args.transcriptSource}.`,
      "IMPORTANT: You only have a transcript. Do NOT evaluate pronunciation, intonation, or audio fluency, and do not imply you heard the audio. For Listenability, comment only on what the transcript shows (sentence structure, grammar, repetition, fillers captured, organisation). Speech-to-text may have mis-recognised some words — do not penalise obvious recognition errors.",
      `Learner profile:\n${args.profile}`,
      `<transcript>\n${args.transcript}\n</transcript>`,
    ].filter(Boolean).join("\n\n"),
    schema: evalSchema(Object.keys(CATEGORIES.speaking), ["Content/Coherence", "Vocabulary", "Listenability", "Task Fulfillment"]),
    effort: "medium",
  });
}

// ---------------- Vocabulary lookup (explicit, fallback when a term is not in the library) ----------------

export function enrichVocab(items: { term: string; context: string }[]) {
  return callJSON<{ items: { term: string; vi: string; definition: string; example: string; collocations: string[]; synonyms: string[]; celpipUsage: string }[] }>({
    kind: "vocab-lookup",
    system: ["You build vocabulary notebook entries for a Vietnamese CELPIP learner. Prioritise meanings useful for comprehension and real CELPIP performance.", LEARNER].join("\n\n"),
    user: `Create one entry per term, in the same order. vi = Vietnamese meaning as used in the context. definition = simple English definition. example = natural Canadian-context sentence. collocations = 2–4 common collocations. synonyms = 2–4 (include common paraphrases CELPIP answers use). celpipUsage = one Vietnamese sentence on where/how this appears in CELPIP.\n\n${items.map((i, n) => `${n + 1}. ${i.term} — context: ${i.context || "(none)"}`).join("\n")}`,
    schema: obj({ items: arr(obj({ term: str(), vi: str(), definition: str(), example: str(), collocations: arr(str()), synonyms: arr(str()), celpipUsage: str() })) }),
    effort: "low",
  });
}

// ---------------- Tutor ----------------

export const TUTOR_SYSTEM = [
  "You are the learner's personal CELPIP-General tutor inside the \"CELPIP 8 Coach\" app.",
  LEARNER,
  "Answer in the language the learner uses (Vietnamese or English); default to Vietnamese for explanations, and keep English examples in English.",
  "Be concise first: give the direct answer in 2–5 sentences, then offer \"Muốn giải thích sâu hơn không?\" when a deeper explanation would help.",
  "Use the <context> block (current exercise, the learner's answer, the correct answer, explanations, and weakness profile) to ground your answer. If asked for more practice questions, write them in CELPIP style with an answer key at the end, and say they are quick unreviewed practice, not part of the validated library.",
  "All estimates you mention are unofficial; never present them as official CELPIP scores. If speaking feedback came from a transcript only, say that pronunciation was not assessed.",
  "Format with short Markdown (bold, bullet lists). No tables unless asked.",
].join("\n\n");
