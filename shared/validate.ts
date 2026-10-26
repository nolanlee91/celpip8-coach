// Structural validation for library content. Pure functions (no fs) so the server loader,
// the CLI (`npm run content:validate`) and the generation pipeline share one rule set.
// Passing validation means "well-formed and internally consistent" — it does NOT prove exam quality.

import type { LibraryItem, MockPackage, ValidationIssue, VocabEntry } from "./content";
import { TOPICS } from "./content";
import type { ListeningSet, McqQuestion, ReadingSet, SpeakingPrompt, WritingPrompt } from "./types";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, TRAPS, WRITING_TASKS } from "./spec";

const VOICES = ["female_a", "male_a", "female_b", "male_b", "narrator"];
const R3_OPTIONS = ["A", "B", "C", "D", "E — Not given in any paragraph"];

/** Blank layout of complete parts: which question numbers are blanks in the second text. */
const BLANKS: Record<string, number[]> = { R1: [7, 8, 9, 10, 11], R2: [1, 2, 3, 4, 5], R4: [6, 7, 8, 9, 10] };
const L1_CHUNKS = [3, 3, 2];

export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[\[\d+\]\]/g, " ")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function readingCorpus(set: ReadingSet): string {
  return set.sections.map((s) => (s.kind === "table" && s.table
    ? [s.table.caption, ...s.table.headers, ...s.table.rows.flat()].join(" \n ")
    : s.text)).join(" \n ");
}

export function listeningCorpus(segments: { text: string }[]): string {
  return segments.map((s) => s.text).join(" ");
}

type Push = (severity: ValidationIssue["severity"], message: string) => void;

function checkMeta(item: LibraryItem, push: Push, setTypes: string[]) {
  if (!item.id || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) push("error", "id must be lowercase kebab-case");
  if (!item.title?.trim()) push("error", "missing title");
  if (!Number.isInteger(item.difficulty) || item.difficulty < 5 || item.difficulty > 10) push("error", "difficulty must be an integer 5–10");
  if (!item.topic || !(TOPICS as readonly string[]).includes(item.topic)) push("error", `topic must be one of: ${TOPICS.join(", ")}`);
  if (!item.estimatedMinutes || item.estimatedMinutes <= 0) push("error", "missing estimatedMinutes");
  const st = (item as { setType?: string }).setType;
  if (!st || !setTypes.includes(st)) push("error", `setType must be one of: ${setTypes.join(", ")}`);
  if (!item.source) push("error", "missing source");
  if (!item.review || !["approved", "draft", "rejected"].includes(item.review.status)) push("error", "missing review.status");
}

function checkQuestions(qs: McqQuestion[], skill: "reading" | "listening", corpus: (q: McqQuestion) => string, taskType: string, push: Push) {
  const numbers = new Set<number>();
  const cats = Object.keys(CATEGORIES[skill]);
  qs.forEach((q, i) => {
    const tag = `Q${q.number ?? i + 1}`;
    if (q.number !== i + 1) push("error", `${tag}: questions must be numbered 1..n in order (found ${q.number} at position ${i + 1})`);
    if (numbers.has(q.number)) push("error", `${tag}: duplicate question number`);
    numbers.add(q.number);
    if (!q.prompt?.trim()) push("error", `${tag}: missing prompt`);
    const expected = taskType === "R3" ? 5 : 4;
    if (!Array.isArray(q.options) || q.options.length !== expected) push("error", `${tag}: must have exactly ${expected} options${taskType === "R3" ? " (Part 3 uses A–E)" : ""}`);
    if (taskType === "R3" && q.options?.some((o, k) => o.text !== R3_OPTIONS[k])) push("error", `${tag}: Part 3 options must be exactly ${R3_OPTIONS.join(" | ")}`);
    if (!Number.isInteger(q.answerIndex) || q.answerIndex < 0 || q.answerIndex >= (q.options?.length ?? 0)) push("error", `${tag}: answerIndex out of range`);
    const noneTraps = q.options?.filter((o) => o.trap === "none").length ?? 0;
    if (noneTraps !== 1 || q.options?.[q.answerIndex]?.trap !== "none") push("error", `${tag}: exactly one option (the correct one) must have trap "none"`);
    q.options?.forEach((o, k) => {
      if (!o.text?.trim()) push("error", `${tag}: option ${k} has no text`);
      if (!(o.trap in TRAPS)) push("error", `${tag}: option ${k} has unknown trap "${o.trap}"`);
      if (!o.whyVi?.trim()) push("error", `${tag}: option ${k} missing whyVi explanation`);
    });
    const texts = q.options?.map((o) => normalizeText(o.text)) ?? [];
    if (new Set(texts).size !== texts.length) push("error", `${tag}: duplicate option texts`);
    if (!cats.includes(q.category) || q.category === "time_management") push("error", `${tag}: invalid category "${q.category}"`);
    if (!q.explanationVi?.trim()) push("error", `${tag}: missing explanationVi`);
    if (!q.evidence || q.evidence.trim().length < 8) push("error", `${tag}: evidence quote missing or too short`);
    else if (!normalizeText(corpus(q)).includes(normalizeText(q.evidence))) push("error", `${tag}: evidence quote not found verbatim in the ${skill === "reading" ? "passage" : "transcript"}: "${q.evidence.slice(0, 70)}"`);
  });
}

function validateReading(set: ReadingSet, push: Push) {
  checkMeta(set, push, ["full", "drill", "mock"]);
  const part = READING_PARTS.find((p) => p.id === set.taskType);
  if (!part) return push("error", `unknown reading taskType "${set.taskType}"`);
  const full = set.setType === "full" || set.setType === "mock";
  const n = set.questions?.length ?? 0;
  if (full && n !== part.questions) push("error", `complete ${part.id} set must have ${part.questions} questions (has ${n})`);
  if (!full && (n < 4 || n > 7)) push("error", `drill must have 4–7 questions (has ${n})`);
  if (!Array.isArray(set.sections) || !set.sections.length) return push("error", "missing sections");

  // Part-specific layout
  const kinds = set.sections.map((s) => s.kind).join(",");
  if (set.taskType === "R1" || set.taskType === "R4") {
    if (kinds !== "text,text") push("error", `${set.taskType} needs 2 text sections (main text + response with blanks)`);
  } else if (set.taskType === "R2") {
    if (kinds !== "table,text") push("error", "R2 needs a table section followed by a text section with blanks");
    const t = set.sections[0]?.table;
    if (!t || !t.headers?.length || !t.rows?.length || t.rows.some((r) => r.length !== t.headers.length)) push("error", "R2 table must have headers and rows of equal width");
  } else if (set.taskType === "R3") {
    const labels = set.sections.map((s) => s.label);
    if (kinds !== "text,text,text,text" || labels.join("|") !== "Paragraph A|Paragraph B|Paragraph C|Paragraph D") push("error", 'R3 needs 4 text sections labelled "Paragraph A" … "Paragraph D"');
  }
  set.sections.forEach((s, i) => {
    if (s.kind === "text" && (!s.text?.trim() || s.table !== null)) push("error", `section ${i}: text section needs text and table = null`);
    if (s.kind === "table" && (s.text !== "" || !s.table)) push("error", `section ${i}: table section needs table and text = ""`);
  });

  // Blanks: every [[n]] must map to a question, and complete parts must have the official blank layout.
  const blanks = set.sections.flatMap((s) => [...(s.text ?? "").matchAll(/\[\[(\d+)\]\]/g)].map((m) => Number(m[1])));
  if (new Set(blanks).size !== blanks.length) push("error", "a blank [[n]] appears more than once");
  for (const b of blanks) if (!set.questions.some((q) => q.number === b)) push("error", `blank [[${b}]] has no matching question`);
  if (full && BLANKS[set.taskType]) {
    const want = BLANKS[set.taskType].join(",");
    if ([...blanks].sort((a, b) => a - b).join(",") !== want) push("error", `${set.taskType} blanks must be exactly [[${BLANKS[set.taskType].join("]], [[")}]]`);
  }
  if (!full && set.taskType !== "R3" && blanks.length === 0) push("warning", "drill has no blanks — fine, but less like the real part");

  const corpus = readingCorpus(set);
  checkQuestions(set.questions, "reading", () => corpus, set.taskType, push);
  checkVocabSeeds(set.vocabulary, push);
  const len = words(set.sections.filter((s) => s.kind === "text").map((s) => s.text).join(" "));
  // R2's only prose is a 150–200-word email (the diagram carries the rest), so it has a lower floor.
  const minWords = set.taskType === "R2" ? 140 : 250;
  if (full && len < minWords) push("warning", `passage text is short for a complete part (${len} words)`);
}

function validateListening(set: ListeningSet, push: Push) {
  checkMeta(set, push, ["full", "drill", "mock"]);
  const part = LISTENING_PARTS.find((p) => p.id === set.taskType);
  if (!part) return push("error", `unknown listening taskType "${set.taskType}"`);
  if (!set.context?.trim()) push("error", "missing context line");
  const full = set.setType === "full" || set.setType === "mock";
  const chunks = set.chunks ?? [];
  const counts = chunks.map((c) => c.questions?.length ?? 0);
  if (full) {
    if (set.taskType === "L1" && counts.join(",") !== L1_CHUNKS.join(",")) push("error", `L1 must have 3 chunks with 3/3/2 questions (has ${counts.join("/")})`);
    if (set.taskType !== "L1" && (chunks.length !== 1 || counts[0] !== part.questions)) push("error", `${part.id} must have 1 chunk with ${part.questions} questions`);
  } else if (chunks.length !== 1 || counts[0] < 3 || counts[0] > 6) push("error", "drill must have 1 chunk with 3–6 questions");

  const all = chunks.flatMap((c) => c.questions ?? []);
  const speakers = new Set<string>();
  chunks.forEach((c, ci) => {
    if (!c.segments?.length) push("error", `chunk ${ci}: no segments`);
    c.segments?.forEach((sg, si) => {
      if (!sg.speaker?.trim() || !sg.text?.trim()) push("error", `chunk ${ci} segment ${si}: missing speaker/text`);
      if (!VOICES.includes(sg.voice)) push("error", `chunk ${ci} segment ${si}: unknown voice "${sg.voice}"`);
      if (/\[|\(|\*/.test(sg.text)) push("warning", `chunk ${ci} segment ${si}: text contains brackets/asterisks (stage directions are read aloud by TTS)`);
      speakers.add(sg.speaker);
    });
    // The same speaker must always use the same voice.
    const voiceOf = new Map<string, string>();
    for (const sg of c.segments ?? []) {
      if (voiceOf.has(sg.speaker) && voiceOf.get(sg.speaker) !== sg.voice) push("error", `speaker "${sg.speaker}" uses more than one voice`);
      voiceOf.set(sg.speaker, sg.voice);
    }
  });
  if (set.taskType === "L4" && [...speakers].length !== 1) push("error", "L4 news item must have a single narrator");
  if (set.taskType === "L5" && speakers.size < 3) push("error", "L5 discussion needs at least 3 speakers");
  if (["L1", "L2", "L3"].includes(set.taskType) && speakers.size < 2) push("error", `${set.taskType} needs at least 2 speakers`);

  // Renumber check across chunks, evidence must be in the chunk the question follows.
  checkQuestions(all, "listening", (q) => listeningCorpus(chunks.find((c) => c.questions.includes(q))?.segments ?? []), set.taskType, push);
  checkVocabSeeds(set.vocabulary, push);
}

function checkVocabSeeds(v: { term: string; vi: string; definition: string; example: string }[] | undefined, push: Push) {
  if (!Array.isArray(v) || v.length < 4) push("error", "needs at least 4 vocabulary items");
  v?.forEach((x, i) => {
    if (!x.term?.trim() || !x.vi?.trim() || !x.definition?.trim() || !x.example?.trim()) push("error", `vocabulary ${i}: term, vi, definition and example are required`);
  });
}

function validateWriting(p: WritingPrompt, push: Push) {
  checkMeta(p, push, ["practice", "mock"]);
  const t = WRITING_TASKS.find((x) => x.id === p.taskType);
  if (!t) return push("error", `unknown writing taskType "${p.taskType}"`);
  if (!p.situation?.trim()) push("error", "missing situation");
  if (!Array.isArray(p.instructions) || !p.instructions.length) push("error", "missing instructions");
  if (t.id === "W1" && p.instructions?.length !== 3) push("error", "W1 must have exactly 3 bullet-point instructions");
  if (t.id === "W2" && (!p.optionA?.trim() || !p.optionB?.trim())) push("error", "W2 needs optionA and optionB");
  if (t.id === "W1" && (p.optionA !== null || p.optionB !== null)) push("error", "W1 optionA/optionB must be null");
  if (!p.structure || p.structure.length < 3) push("error", "structure needs at least 3 steps");
  const w = words(p.modelResponse ?? "");
  if (w < 140 || w > 215) push("error", `modelResponse should be ~150–200 words (has ${w})`);
  if (!p.usefulExpressions || p.usefulExpressions.length < 4) push("error", "needs at least 4 usefulExpressions");
  if (!p.commonMistakes || p.commonMistakes.length < 2) push("error", "needs at least 2 commonMistakes");
}

export function svgProblems(svg: string): string[] {
  const out: string[] = [];
  if (!/^\s*<svg[\s>]/i.test(svg)) out.push("must start with <svg");
  if (!/viewBox=/i.test(svg)) out.push("needs a viewBox");
  if (/<script|<foreignObject|\son\w+\s*=|javascript:/i.test(svg)) out.push("contains scripts or event handlers");
  if (/(href|xlink:href)\s*=\s*["'](?!#)/i.test(svg)) out.push("contains external references");
  if (svg.length > 60000) out.push("too large (> 60 KB)");
  return out;
}

function validateSpeaking(p: SpeakingPrompt, push: Push) {
  checkMeta(p, push, ["practice", "mock"]);
  const t = SPEAKING_TASKS.find((x) => x.id === p.taskType);
  if (!t) return push("error", `unknown speaking taskType "${p.taskType}"`);
  if (!p.prompt?.trim()) push("error", "missing prompt");
  if (t.visual === "scene") {
    if (!p.svg) push("error", `${t.id} requires an SVG scene`);
    else for (const m of svgProblems(p.svg)) push("error", `svg ${m}`);
  } else if (p.svg !== null) push("error", `${t.id} must have svg = null`);
  if (t.visual === "options") {
    if (!p.options || p.options.length !== 2 || p.options.some((o) => !o.title?.trim() || o.details.length < 3)) push("error", "S5 needs exactly 2 options, each with a title and ≥ 3 details");
  } else if (p.options !== null) push("error", `${t.id} must have options = null`);
  if (!p.structure || p.structure.length < 3) push("error", "structure needs at least 3 steps");
  const w = words(p.modelAnswer ?? "");
  const [lo, hi] = t.speakSec >= 90 ? [150, 270] : [100, 190];
  if (w < lo || w > hi) push("error", `modelAnswer should fit ${t.speakSec}s of speech (${lo}–${hi} words, has ${w})`);
  if (!p.usefulExpressions || p.usefulExpressions.length < 3) push("error", "needs at least 3 usefulExpressions");
}

export function validateItem(item: LibraryItem, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push: Push = (severity, message) => issues.push({ severity, id: item?.id ?? "", file, message });
  if (!item || typeof item !== "object") { push("error", "not a JSON object"); return issues; }
  switch (item.kind) {
    case "reading": validateReading(item, push); break;
    case "listening": validateListening(item, push); break;
    case "writing": validateWriting(item, push); break;
    case "speaking": validateSpeaking(item, push); break;
    default: push("error", `unknown kind "${(item as { kind?: string }).kind}"`);
  }
  return issues;
}

export function validateVocab(entries: VocabEntry[], file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const allTasks = [...READING_PARTS, ...LISTENING_PARTS, ...WRITING_TASKS, ...SPEAKING_TASKS].map((t) => t.id);
  entries.forEach((e, i) => {
    const push = (severity: ValidationIssue["severity"], message: string) => issues.push({ severity, id: e?.id ?? `#${i}`, file, message });
    if (!e.id || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) push("error", "id must be kebab-case");
    for (const k of ["term", "definition", "vi", "example"] as const) if (!e[k]?.trim()) push("error", `missing ${k}`);
    if (!Array.isArray(e.collocations) || e.collocations.length < 2) push("error", "needs ≥ 2 collocations");
    if (!Array.isArray(e.synonyms) || e.synonyms.length < 1) push("error", "needs ≥ 1 synonym");
    if (!(TOPICS as readonly string[]).includes(e.topic)) push("error", `invalid topic "${e.topic}"`);
    if (!Number.isInteger(e.difficulty) || e.difficulty < 5 || e.difficulty > 10) push("error", "difficulty must be 5–10");
    if (!Array.isArray(e.tasks) || !e.tasks.length || e.tasks.some((t) => !allTasks.includes(t))) push("error", "tasks must list valid task ids");
    if (e.term && e.example) {
      // Every content word of the term must appear in the example (allowing inflection: compare 4-letter stems as whole-word prefixes).
      const ex = ` ${normalizeText(e.example).replace(/[^a-z0-9' ]/g, " ")} `;
      const missing = normalizeText(e.term).replace(/[^a-z0-9' ]/g, " ").split(/\s+/)
        .filter((w) => w.length >= 3 && !["the", "and", "for", "one's", "someone", "something", "sb", "sth"].includes(w))
        .filter((w) => !ex.includes(` ${w.slice(0, Math.min(4, w.length))}`));
      if (missing.length) push("warning", `example sentence does not seem to contain the term (missing: ${missing.join(", ")})`);
    }
  });
  return issues;
}

/** Cross-item checks: unique ids, duplicate questions, near-duplicate passages, unique vocabulary. */
export function validateCollection(items: { item: LibraryItem; file: string }[], vocab: { entry: VocabEntry; file: string }[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seenIds = new Map<string, string>();
  for (const { item, file } of items) {
    if (seenIds.has(item.id)) issues.push({ severity: "error", id: item.id, file, message: `duplicate id (also in ${seenIds.get(item.id)})` });
    seenIds.set(item.id, file);
  }

  const promptSeen = new Map<string, string>();
  for (const { item, file } of items) {
    const qs = item.kind === "reading" ? item.questions : item.kind === "listening" ? item.chunks.flatMap((c) => c.questions) : [];
    for (const q of qs ?? []) {
      // R3 statements and blank-fill prompts are short; compare prompt + correct answer to avoid false positives.
      const key = normalizeText(`${q.prompt} :: ${q.options?.[q.answerIndex]?.text ?? ""}`);
      if (key.length < 25) continue;
      if (promptSeen.has(key) && promptSeen.get(key) !== item.id) issues.push({ severity: "error", id: item.id, file, message: `duplicate question "${q.prompt.slice(0, 60)}" (also in ${promptSeen.get(key)})` });
      promptSeen.set(key, item.id);
    }
  }

  const shingles = items.map(({ item, file }) => {
    const text = item.kind === "reading" ? readingCorpus(item)
      : item.kind === "listening" ? item.chunks.map((c) => listeningCorpus(c.segments)).join(" ")
        // Prompts share standard task wording ("Describe the scene…"), so compare their distinctive parts.
        : item.kind === "writing" ? `${item.situation} ${item.modelResponse ?? ""}`
          : `${item.prompt} ${item.modelAnswer ?? ""} ${(item.options ?? []).map((o) => `${o.title} ${o.details.join(" ")}`).join(" ")}`;
    const w = normalizeText(text).replace(/[^a-z0-9' ]/g, " ").split(/\s+/).filter(Boolean);
    const set = new Set<string>();
    for (let i = 0; i + 5 <= w.length; i++) set.add(w.slice(i, i + 5).join(" "));
    return { id: item.id, file, kind: item.kind, set };
  });
  for (let i = 0; i < shingles.length; i++) {
    for (let j = i + 1; j < shingles.length; j++) {
      const a = shingles[i], b = shingles[j];
      if (a.kind !== b.kind || a.set.size < 10 || b.set.size < 10) continue;
      let inter = 0;
      for (const s of a.set) if (b.set.has(s)) inter++;
      const jac = inter / (a.set.size + b.set.size - inter);
      if (jac > 0.25) issues.push({ severity: "error", id: b.id, file: b.file, message: `passage/script is a near-duplicate of ${a.id} (overlap ${(jac * 100).toFixed(0)}%)` });
    }
  }

  const terms = new Map<string, string>();
  const vids = new Set<string>();
  for (const { entry, file } of vocab) {
    const t = normalizeText(entry.term ?? "");
    if (terms.has(t)) issues.push({ severity: "error", id: entry.id, file, message: `duplicate vocabulary term "${entry.term}" (also ${terms.get(t)})` });
    terms.set(t, entry.id);
    if (vids.has(entry.id)) issues.push({ severity: "error", id: entry.id, file, message: "duplicate vocabulary id" });
    vids.add(entry.id);
  }
  return issues;
}

export function validateMock(pkg: MockPackage, file: string, byId: Map<string, LibraryItem>, validIds: Set<string>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (severity: ValidationIssue["severity"], message: string) => issues.push({ severity, id: pkg.id, file, message });
  const want: [keyof MockPackage, string[]][] = [
    ["listening", LISTENING_PARTS.map((p) => p.id)],
    ["reading", READING_PARTS.map((p) => p.id)],
    ["writing", WRITING_TASKS.map((t) => t.id)],
    ["speaking", SPEAKING_TASKS.map((t) => t.id)],
  ];
  for (const [key, tasks] of want) {
    const ids = pkg[key] as string[];
    if (!Array.isArray(ids) || ids.length !== tasks.length) { push("error", `${key} must list ${tasks.length} items in order ${tasks.join(", ")}`); continue; }
    ids.forEach((id, i) => {
      const it = byId.get(id);
      if (!it) return push("error", `${key}[${i}] "${id}" not found in library`);
      if (!validIds.has(id)) push("error", `${key}[${i}] "${id}" failed validation or is not approved`);
      if (it.taskType !== tasks[i]) push("error", `${key}[${i}] "${id}" is ${it.taskType}, expected ${tasks[i]}`);
      if ((it as { setType?: string }).setType !== "mock") push("warning", `${key}[${i}] "${id}" is not reserved as a mock component (setType "${(it as { setType?: string }).setType}")`);
    });
  }
  return issues;
}
