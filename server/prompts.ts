import { arr, callJSON, enumOf, int, nullable, obj, str, type Effort } from "./ai";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, TRAPS, WRITING_TASKS } from "../shared/spec";
import type {
  ListeningChunk, McqQuestion, ReadingSection, SpeakingPrompt, VocabSeed, WritingPrompt,
} from "../shared/types";

const LEARNER =
  "The learner is a Vietnamese adult living and working in British Columbia, Canada, with a background in " +
  "accounting, logistics and operations. Official CELPIP-General results (Apr 2026): Listening 6, Reading 5, " +
  "Writing 7, Speaking 6. Goal: Level 8+ in every skill.";

const LEVELS =
  "Difficulty calibration (CELPIP level of the material):\n" +
  "5–6: everyday topics, common vocabulary, answers mostly stated explicitly, light paraphrase.\n" +
  "7–8: moderately complex texts, some abstract ideas, most answers paraphrased, several inference and attitude questions, plausible distractors.\n" +
  "9–10: dense, nuanced texts, idiomatic and precise vocabulary, implied attitudes, subtle distinctions between options.";

const QUALITY =
  "Rules for every multiple-choice question:\n" +
  "- Exactly 4 options (except Reading Part 3, which always uses the five options A, B, C, D, E).\n" +
  "- Exactly one correct option. Vary the correct position.\n" +
  "- Each wrong option is a realistic CELPIP-style distractor tagged with a trap type: " +
  Object.keys(TRAPS).filter((t) => t !== "none").join(", ") + ". The correct option's trap is \"none\".\n" +
  "- whyVi: one or two sentences in Vietnamese explaining why that option is right or wrong.\n" +
  "- evidence: an EXACT, verbatim quote (copy-paste) from the passage/transcript that supports the answer.\n" +
  "- explanationVi: a clear Vietnamese explanation of how to get the answer, naming any paraphrase (e.g. 'bài nói X, đáp án diễn đạt lại thành Y').\n" +
  "- Use Canadian spelling and Canadian (preferably BC) settings, names, places, prices in CAD.\n" +
  "- This is unofficial practice content: never claim it is an official CELPIP item.";

const mcqSchema = (categories: string[]) =>
  obj({
    number: int(),
    prompt: str(),
    options: arr(obj({ text: str(), trap: enumOf(Object.keys(TRAPS)), whyVi: str() })),
    answerIndex: int("0-based index of the correct option"),
    category: enumOf(categories, "The comprehension skill this question tests"),
    evidence: str("Verbatim quote supporting the answer"),
    explanationVi: str(),
  });

const vocabSchema = arr(
  obj({ term: str(), vi: str("Vietnamese meaning"), definition: str("Simple English definition"), example: str("Example sentence from or like the text") }),
  "6–10 useful words/phrases from this material that matter for comprehension (not rare words)",
);

type RawMcq = Omit<McqQuestion, "id">;

// ---------------- Reading ----------------

const READING_FORMATS: Record<string, string> = {
  R1: "Part 1 Reading Correspondence. sections[0]: a personal or semi-formal letter/email (250–350 words). sections[1]: a reply to that letter (120–180 words) containing blanks written as [[7]], [[8]] ... [[11]]. Questions 1–6 ask about the first letter; questions 7–11 each fill the matching blank in the reply (options are words/phrases that fit grammatically; only one fits the meaning of both texts). Total 11 questions.",
  R2: "Part 2 Reading to Apply a Diagram. sections[0]: kind \"table\" — a realistic diagram such as a schedule, price list, comparison chart or program menu with 4–7 rows (caption, headers, rows). sections[1]: an email (150–200 words) with blanks [[1]] ... [[5]] that must be completed by applying information from the diagram to the writer's needs. Questions 1–5 fill the blanks; questions 6–8 ask about the email and its relationship to the diagram. Total 8 questions.",
  R3: "Part 3 Reading for Information. Four sections labelled \"Paragraph A\" … \"Paragraph D\" (each 90–130 words) forming one informational article. Nine statements: for each, decide which paragraph contains the information. Options for EVERY question are exactly: \"A\", \"B\", \"C\", \"D\", \"E — Not given in any paragraph\". Use E for 1–2 statements. Statements must paraphrase the text, not copy it. Total 9 questions.",
  R4: "Part 4 Reading for Viewpoints. sections[0]: an article (400–500 words) presenting two or more viewpoints on a community or workplace issue. sections[1]: a reader's comment (120–170 words) responding to the article, with blanks [[6]] ... [[10]]. Questions 1–5 ask about the article (main idea, viewpoints, attitude, inference); questions 6–10 fill the blanks so the comment is consistent with the article. Total 10 questions.",
};

const READING_SYSTEM = [
  "You write high-quality, realistic CELPIP-General style Reading practice sets for one learner.",
  LEARNER, LEVELS, QUALITY,
  "Sections with kind \"text\" have table = null; sections with kind \"table\" have text = \"\".",
  "Blanks appear in section text only as [[n]] where n is the question number.",
].join("\n\n");

export async function generateReading(args: {
  taskType: string; difficulty: number; focus: string[]; avoidTitles: string[]; drill: boolean; effort: Effort;
}) {
  const part = READING_PARTS.find((p) => p.id === args.taskType)!;
  const cats = Object.keys(CATEGORIES.reading).filter((c) => c !== "time_management");
  const focusLine = args.focus.length
    ? `Targeted weaknesses: ${args.focus.join(", ")}. ${args.drill ? "At least 70%" : "About 40%"} of questions must test these categories, with especially tempting distractors of the kinds this learner falls for.`
    : "No weakness data yet: cover a balanced mix of categories (diagnostic).";
  const drillLine = args.drill
    ? "DRILL MODE: keep the same part format but make it shorter — about 60% of normal text length and only 6 questions (renumber 1–6, and only include blanks for questions that exist)."
    : "";
  return callJSON<{ title: string; sections: ReadingSection[]; questions: RawMcq[]; vocabulary: VocabSeed[] }>({
    system: READING_SYSTEM,
    user: [
      `Create one set. Format: ${READING_FORMATS[part.id]}`,
      `Target difficulty: level ${args.difficulty}.`,
      focusLine,
      drillLine,
      args.avoidTitles.length ? `Avoid these recent topics: ${args.avoidTitles.slice(-12).join("; ")}.` : "",
    ].filter(Boolean).join("\n"),
    schema: obj({
      title: str(),
      sections: arr(obj({
        label: str(),
        kind: enumOf(["text", "table"]),
        text: str(),
        table: nullable(obj({ caption: str(), headers: arr(str()), rows: arr(arr(str())) })),
      })),
      questions: arr(mcqSchema(cats)),
      vocabulary: vocabSchema,
    }),
    effort: args.effort,
  });
}

// ---------------- Listening ----------------

const LISTENING_FORMATS: Record<string, string> = {
  L1: "Part 1 Listening to Problem Solving: a conversation between a man and a woman solving a practical problem, in 3 chunks (each 150–220 words of dialogue). Chunk 1 → 3 questions, chunk 2 → 3 questions, chunk 3 → 2 questions. Total 8.",
  L2: "Part 2 Listening to a Daily Life Conversation: one chunk, a 250–350 word conversation between two people about an everyday situation (e.g. a store, neighbour, workplace). 5 questions.",
  L3: "Part 3 Listening for Information: one chunk, a 350–450 word conversation in which one speaker gives detailed information to another (e.g. a program, procedure, service). 6 questions.",
  L4: "Part 4 Listening to a News Item: one chunk, a 220–300 word local news report read by a single narrator (voice \"narrator\"). 5 questions.",
  L5: "Part 5 Listening to a Discussion: one chunk, a 450–550 word discussion among three people (e.g. a workplace or committee meeting) with different opinions. 8 questions, including who-said-what and attitude questions.",
  L6: "Part 6 Listening to Viewpoints: one chunk, a 400–500 word talk or radio segment in which a speaker presents a viewpoint on an issue and discusses opposing views. 6 questions, including the speaker's attitude and reasoning.",
};

const LISTENING_SYSTEM = [
  "You write realistic CELPIP-General style Listening practice scripts for one learner. The scripts will be read aloud by text-to-speech, so write natural spoken Canadian English: contractions, fillers used sparingly (\"well\", \"you know\"), self-corrections, turn-taking — but no stage directions, sound effects or speaker names inside the text.",
  LEARNER, LEVELS, QUALITY,
  "Assign each speaker a consistent voice: female_a, male_a, female_b, male_b, or narrator. Split long turns into several segments of 1–3 sentences so they can be replayed sentence by sentence.",
  "Questions must only be answerable from the audio. Never put the answer in the question wording.",
].join("\n\n");

export async function generateListening(args: {
  taskType: string; difficulty: number; focus: string[]; avoidTitles: string[]; drill: boolean; effort: Effort;
}) {
  const part = LISTENING_PARTS.find((p) => p.id === args.taskType)!;
  const focusLine = args.focus.length
    ? `Targeted weaknesses: ${args.focus.join(", ")}. ${args.drill ? "At least 70%" : "About 40%"} of questions must test these categories.`
    : "No weakness data yet: cover a balanced mix of categories (diagnostic).";
  return callJSON<{ title: string; context: string; chunks: (Omit<ListeningChunk, "questions"> & { questions: RawMcq[] })[]; vocabulary: VocabSeed[] }>({
    system: LISTENING_SYSTEM,
    user: [
      `Create one set. Format: ${LISTENING_FORMATS[part.id]}`,
      args.drill ? "DRILL MODE: one chunk only, about 60% of normal length, 4–5 questions." : "",
      `Target difficulty: level ${args.difficulty}.`,
      focusLine,
      "context: one short sentence shown before the audio (e.g. \"You will hear a conversation between a tenant and a building manager.\").",
      args.avoidTitles.length ? `Avoid these recent topics: ${args.avoidTitles.slice(-12).join("; ")}.` : "",
    ].filter(Boolean).join("\n"),
    schema: obj({
      title: str(),
      context: str(),
      chunks: arr(obj({
        segments: arr(obj({ speaker: str(), voice: enumOf(["female_a", "male_a", "female_b", "male_b", "narrator"]), text: str() })),
        questions: arr(mcqSchema(Object.keys(CATEGORIES.listening))),
      })),
      vocabulary: vocabSchema,
    }),
    effort: args.effort,
  });
}

// ---------------- Writing prompts ----------------

export async function generateWritingPrompt(args: { taskType: string; difficulty: number; avoidTitles: string[] }) {
  const t = WRITING_TASKS.find((x) => x.id === args.taskType)!;
  const format = t.id === "W1"
    ? "Task 1 Writing an Email: a realistic situation (workplace, neighbour, landlord, company, community) and exactly 3 bullet-point instructions the email must address. Specify whether it is formal or informal through the situation. optionA and optionB are null."
    : "Task 2 Responding to Survey Questions: a short situation in which an organization asks for opinions, then the survey question with two options, Option A and Option B. instructions: \"Choose the option you prefer. Explain the reasons for your choice.\" plus any constraint. Fill optionA and optionB.";
  return callJSON<Pick<WritingPrompt, "title" | "situation" | "instructions" | "optionA" | "optionB">>({
    system: ["You write realistic CELPIP-General style Writing prompts (unofficial practice).", LEARNER, LEVELS].join("\n\n"),
    user: `${format}\nWord range: ${t.minWords}–${t.maxWords} words. Difficulty level ${args.difficulty} (higher = more complex situation requiring nuance and tone control).${args.avoidTitles.length ? ` Avoid these recent topics: ${args.avoidTitles.slice(-10).join("; ")}.` : ""}`,
    schema: obj({ title: str(), situation: str(), instructions: arr(str()), optionA: nullable(str()), optionB: nullable(str()) }),
    effort: "low",
  });
}

// ---------------- Speaking prompts ----------------

export async function generateSpeakingPrompt(args: { taskType: string; difficulty: number; avoidTitles: string[] }) {
  const t = SPEAKING_TASKS.find((x) => x.id === args.taskType)!;
  const visual = t.visual === "scene"
    ? `svg: a self-contained SVG illustration (viewBox="0 0 800 500", flat colours, no <text> except at most a few short signs, no scripts, no external references, no <foreignObject>) of a busy, concrete scene with at least 6 people/objects doing different things${t.id === "S4" ? ", with clues about what might happen next" : ""}${t.id === "S8" ? ". For Task 8 draw ONE unusual, oddly-designed object in the centre (e.g. a strange chair or tool) that the learner must describe in detail" : ""}. options: null.`
    : t.visual === "options"
      ? "options: exactly two options (e.g. two apartments, two vacation packages), each with a title and 3–4 specific details (price, location, features). The prompt asks the learner to choose one and persuade a family member who prefers the other. svg: null."
      : "svg: null, options: null.";
  return callJSON<Pick<SpeakingPrompt, "title" | "prompt" | "svg" | "options">>({
    system: ["You write realistic CELPIP-General style Speaking prompts (unofficial practice).", LEARNER, LEVELS].join("\n\n"),
    user: `Task ${t.task}: ${t.name}. Preparation ${t.prepSec}s, speaking ${t.speakSec}s. Write the prompt exactly as the test would show it (second person, clear task).\n${visual}\nDifficulty level ${args.difficulty}.${args.avoidTitles.length ? ` Avoid these recent topics: ${args.avoidTitles.slice(-10).join("; ")}.` : ""}`,
    schema: obj({
      title: str(),
      prompt: str(),
      svg: nullable(str()),
      options: nullable(arr(obj({ title: str(), details: arr(str()) }))),
    }),
    effort: t.visual === "scene" ? "medium" : "low",
    maxTokens: 24000,
  });
}

// ---------------- Evaluation (writing + speaking) ----------------

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
    vocabulary: vocabSchema,
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

export function evaluateWriting(args: { prompt: WritingPrompt; response: string; wordCount: number; minutesUsed: number; profile: string }) {
  const t = WRITING_TASKS.find((x) => x.id === args.prompt.taskType)!;
  return callJSON<RawEvaluation>({
    system: EVAL_SYSTEM,
    user: [
      `Skill: WRITING — Task ${t.task}: ${t.name} (${t.minWords}–${t.maxWords} words, ${t.minutes} minutes).`,
      `Situation: ${args.prompt.situation}`,
      `Instructions:\n- ${args.prompt.instructions.join("\n- ")}`,
      args.prompt.optionA ? `Option A: ${args.prompt.optionA}\nOption B: ${args.prompt.optionB}` : "",
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

// ---------------- Vocabulary enrichment ----------------

export function enrichVocab(items: { term: string; context: string }[]) {
  return callJSON<{ items: { term: string; vi: string; definition: string; example: string; collocations: string[]; synonyms: string[]; celpipUsage: string }[] }>({
    system: ["You build vocabulary notebook entries for a Vietnamese CELPIP learner. Prioritise meanings useful for comprehension and real CELPIP performance.", LEARNER].join("\n\n"),
    user: `Create one entry per term, in the same order. vi = Vietnamese meaning as used in the context. definition = simple English definition. example = natural Canadian-context sentence. collocations = 2–4 common collocations. synonyms = 2–4 (include common paraphrases CELPIP answers use). celpipUsage = one Vietnamese sentence on where/how this appears in CELPIP (e.g. reading paraphrase, speaking Task 1 advice).\n\n${items.map((i, n) => `${n + 1}. ${i.term} — context: ${i.context || "(none)"}`).join("\n")}`,
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
  "Use the <context> block (current exercise, the learner's answer, the correct answer, explanations, and weakness profile) to ground your answer. If asked for more practice questions, write them in CELPIP style with an answer key at the end.",
  "All estimates you mention are unofficial; never present them as official CELPIP scores. If speaking feedback came from a transcript only, say that pronunciation was not assessed.",
  "Format with short Markdown (bold, bullet lists). No tables unless asked.",
].join("\n\n");
