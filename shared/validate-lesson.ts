// Structural validation for Learn Mode lessons. Pure (no fs), shared by the server loader,
// `npm run content:validate` and the tests. Passing means well-formed, complete and internally
// consistent — it does NOT prove teaching quality (that is what the independent review is for).

import type { ValidationIssue } from "./content";
import type { CurriculumMap, Exercise, Lesson, Stimulus } from "./curriculum";
import { autoGraded, normalizeAnswer } from "./curriculum";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SKILLS, SPEAKING_TASKS, WRITING_TASKS, type Skill } from "./spec";

const VOICES = ["female_a", "male_a", "female_b", "male_b", "narrator"];
const PREFIX: Record<Skill, string> = { reading: "rd", listening: "ls", speaking: "sp", writing: "wr" };
const TASK_IDS: Record<Skill, string[]> = {
  reading: READING_PARTS.map((p) => p.id),
  listening: LISTENING_PARTS.map((p) => p.id),
  speaking: SPEAKING_TASKS.map((t) => t.id),
  writing: WRITING_TASKS.map((t) => t.id),
};
const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/** What the validator needs to know about the rest of the library. */
export interface LessonContext {
  listeningChunks: Map<string, { segments: { text: string }[] }[]>; // library listening set id -> chunks
  speakingImages: Set<string>; // speaking prompt ids that have an SVG scene
}

export function stimulusText(s: Stimulus | undefined, ctx: LessonContext): string {
  if (!s) return "";
  const parts = [s.text ?? "", ...(s.audio ?? []).map((x) => x.text)];
  if (s.audioRef) parts.push(...(ctx.listeningChunks.get(s.audioRef.setId)?.[s.audioRef.chunk]?.segments ?? []).map((x) => x.text));
  return parts.join(" ");
}

const hasAudio = (s: Stimulus | undefined) => Boolean(s && (s.audio?.length || s.audioRef));

export function validateLesson(l: Lesson, ctx: LessonContext, file = ""): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (severity: ValidationIssue["severity"], message: string) => issues.push({ severity, file, id: l?.id ?? "?", message });
  if (!l || typeof l !== "object") { push("error", "not a lesson object"); return issues; }

  if (!SKILLS.includes(l.skill)) { push("error", `skill must be one of ${SKILLS.join(", ")}`); return issues; }
  if (!new RegExp(`^${PREFIX[l.skill]}-\\d{2}$`).test(l.id ?? "")) push("error", `id must look like ${PREFIX[l.skill]}-01`);
  for (const k of ["title", "titleVi", "objectiveVi", "whyItMattersVi", "module"] as const) if (!l[k]?.trim?.()) push("error", `missing ${k}`);
  if (!["foundation", "core", "target8"].includes(l.level)) push("error", "level must be foundation | core | target8");
  if (!Number.isInteger(l.difficulty) || l.difficulty < 5 || l.difficulty > 10) push("error", "difficulty must be an integer 5–10");
  if (!(l.estimatedMinutes >= 10 && l.estimatedMinutes <= 45)) push("error", "estimatedMinutes must be 10–45");
  if (!Array.isArray(l.objectives) || l.objectives.length < 2 || l.objectives.length > 5) push("error", "objectives: 2–5 items");
  if (!Array.isArray(l.prerequisites)) push("error", "prerequisites must be an array");

  const cats = Object.keys(CATEGORIES[l.skill]);
  if (!l.competencies?.length) push("error", "competencies: at least one");
  for (const c of l.competencies ?? []) if (!cats.includes(c)) push("error", `unknown competency "${c}" (use: ${cats.join(", ")})`);
  for (const t of l.tasks ?? []) if (!TASK_IDS[l.skill].includes(t)) push("error", `unknown task "${t}"`);
  if (!l.tasks?.length) push("error", "tasks: at least one CELPIP task id");

  // Teaching material, not a title + quiz.
  if (!Array.isArray(l.concept) || l.concept.length < 3) push("error", "concept: at least 3 sections");
  const conceptWords = (l.concept ?? []).reduce((n, c) => n + wc(c.body ?? ""), 0);
  if (conceptWords < 250) push("error", `concept is too thin (${conceptWords} words, need ≥ 250)`);
  for (const c of l.concept ?? []) if (!c.heading?.trim() || !c.body?.trim()) push("error", "concept section without heading/body");

  // Stimuli.
  const stimuli = l.stimuli ?? {};
  const usedStimuli = new Set<string>();
  for (const [key, s] of Object.entries(stimuli)) {
    if (!/^[a-z0-9-]+$/.test(key)) push("error", `stimulus key "${key}" must be kebab-case`);
    if (!s.text && !s.audio?.length && !s.audioRef && !s.imageRef) push("error", `stimulus "${key}" is empty`);
    for (const seg of s.audio ?? []) {
      if (!seg.text?.trim() || !seg.speaker?.trim()) push("error", `stimulus "${key}": audio segment without speaker/text`);
      if (!VOICES.includes(seg.voice)) push("error", `stimulus "${key}": voice must be one of ${VOICES.join(", ")}`);
    }
    if (s.audioRef) {
      const chunks = ctx.listeningChunks.get(s.audioRef.setId);
      if (!chunks) push("error", `stimulus "${key}": audioRef set "${s.audioRef.setId}" is not an active library listening set`);
      else if (!chunks[s.audioRef.chunk]) push("error", `stimulus "${key}": audioRef chunk ${s.audioRef.chunk} does not exist`);
    }
    // Mock-exam items stay unseen until the mock exam.
    if (/-mock-/.test(s.audioRef?.setId ?? "") || /-mock-/.test(s.imageRef ?? "")) push("error", `stimulus "${key}": lessons must not reuse mock-exam items`);
    if (s.imageRef && !ctx.speakingImages.has(s.imageRef)) push("error", `stimulus "${key}": imageRef "${s.imageRef}" is not a speaking prompt with an SVG scene`);
  }
  const refStim = (where: string, id: string | undefined) => {
    if (!id) return;
    if (!stimuli[id]) push("error", `${where}: stimulusId "${id}" not found`);
    usedStimuli.add(id);
  };

  // Worked examples.
  if (!Array.isArray(l.examples) || l.examples.length < 2) push("error", "examples: at least 2 worked examples");
  for (const ex of l.examples ?? []) {
    const where = `example ${ex.id}`;
    refStim(where, ex.stimulusId);
    if (!ex.title?.trim() || !ex.takeawayVi?.trim()) push("error", `${where}: missing title/takeawayVi`);
    if (!Array.isArray(ex.steps) || ex.steps.length < 2) push("error", `${where}: needs ≥ 2 demonstration steps`);
    for (const c of ex.comparisons ?? []) {
      if (!["weak", "acceptable", "level8", "before", "after"].includes(c.label)) push("error", `${where}: bad comparison label "${c.label}"`);
      if (!c.text?.trim() || !c.commentVi?.trim()) push("error", `${where}: comparison without text/commentVi`);
    }
  }
  const labels = new Set((l.examples ?? []).flatMap((e) => (e.comparisons ?? []).map((c) => c.label)));
  if (l.skill === "speaking" && !(labels.has("weak") && labels.has("acceptable") && labels.has("level8")))
    push("error", "speaking lessons need a weak / acceptable / level8 comparison");
  if (l.skill === "writing" && !(labels.has("before") && labels.has("after")))
    push("error", "writing lessons need a before / after comparison");

  // Exercises.
  const misc = l.misconceptions ?? {};
  const usedMisc = new Set<string>();
  const ids = new Set<string>();
  const checkMisc = (where: string, key: string | null | undefined) => {
    if (!key) { push("error", `${where}: missing misconception`); return; }
    if (!misc[key]) push("error", `${where}: misconception "${key}" is not defined`);
    usedMisc.add(key);
  };
  const checkExercise = (ex: Exercise, section: "guided" | "independent") => {
    const where = `${section} ${ex.id}`;
    if (!ex.id || ids.has(ex.id)) push("error", `${where}: missing or duplicate exercise id`);
    ids.add(ex.id);
    if (!ex.prompt?.trim()) push("error", `${where}: missing prompt`);
    if (!ex.explanationVi?.trim()) push("error", `${where}: missing explanationVi`);
    if (!cats.includes(ex.competency)) push("error", `${where}: unknown competency "${ex.competency}"`);
    if (section === "guided" && !ex.hint?.trim()) push("error", `${where}: guided exercises need a hint`);
    if (section === "independent" && ex.hint) push("error", `${where}: independent exercises must not have a hint`);
    refStim(where, ex.stimulusId);
    const stim = ex.stimulusId ? stimuli[ex.stimulusId] : undefined;
    switch (ex.type) {
      case "choice": {
        if (!Array.isArray(ex.options) || ex.options.length < 3 || ex.options.length > 5) { push("error", `${where}: 3–5 options`); break; }
        if (!Number.isInteger(ex.answerIndex) || !ex.options[ex.answerIndex]) { push("error", `${where}: invalid answerIndex`); break; }
        const texts = ex.options.map((o) => normalizeAnswer(o.text ?? ""));
        if (new Set(texts).size !== texts.length) push("error", `${where}: duplicate options`);
        ex.options.forEach((o, i) => {
          if (!o.text?.trim() || !o.whyVi?.trim()) push("error", `${where}: option ${i + 1} without text/whyVi`);
          if (i === ex.answerIndex) { if (o.misconception !== null) push("error", `${where}: the correct option must have misconception null`); }
          else checkMisc(`${where} option ${i + 1}`, o.misconception);
        });
        if (ex.evidence && !normalizeAnswer(stimulusText(stim, ctx)).includes(normalizeAnswer(ex.evidence)))
          push("error", `${where}: evidence is not a verbatim quote of the stimulus`);
        if (section === "guided" && ex.hint && normalizeAnswer(ex.hint).includes(texts[ex.answerIndex]) && texts[ex.answerIndex].length > 12)
          push("warning", `${where}: hint gives the answer away`);
        break;
      }
      case "text": {
        if (!Array.isArray(ex.answers) || !ex.answers.length || ex.answers.some((a) => !a?.trim())) push("error", `${where}: needs accepted answers`);
        if (!["exact", "dictation"].includes(ex.mode)) push("error", `${where}: mode must be exact | dictation`);
        checkMisc(where, ex.misconception);
        if (ex.mode === "dictation") {
          if (!hasAudio(stim)) push("error", `${where}: dictation needs an audio stimulus`);
          else if (!normalizeAnswer(stimulusText(stim, ctx)).includes(normalizeAnswer(ex.answers[0] ?? "")))
            push("error", `${where}: dictation answer must be a verbatim part of the transcript`);
        }
        break;
      }
      case "order": {
        if (!Array.isArray(ex.items) || ex.items.length < 3 || ex.items.length > 7) push("error", `${where}: 3–7 items`);
        else if (new Set(ex.items).size !== ex.items.length) push("error", `${where}: duplicate items`);
        checkMisc(where, ex.misconception);
        break;
      }
      case "produce": {
        if (!["write", "speak"].includes(ex.medium)) push("error", `${where}: medium must be write | speak`);
        if (!Array.isArray(ex.checklist) || ex.checklist.length < 3 || ex.checklist.length > 6) push("error", `${where}: checklist 3–6 criteria`);
        if (!ex.modelAnswer?.trim() || wc(ex.modelAnswer) < 15) push("error", `${where}: needs a model answer (≥ 15 words)`);
        checkMisc(where, ex.misconception);
        break;
      }
      default:
        push("error", `${where}: unknown exercise type "${(ex as { type: string }).type}"`);
    }
  };
  const guided = l.guided ?? [];
  const independent = l.independent ?? [];
  if (guided.length < 3 || guided.length > 5) push("error", `guided practice: 3–5 exercises (found ${guided.length})`);
  if (independent.length < 5 || independent.length > 10) push("error", `independent practice: 5–10 exercises (found ${independent.length})`);
  guided.forEach((e) => checkExercise(e, "guided"));
  independent.forEach((e) => checkExercise(e, "independent"));

  const objective = l.skill === "reading" || l.skill === "listening";
  if (objective && [...guided, ...independent].some((e) => !autoGraded(e))) push("error", "reading/listening exercises must all be auto-graded (no produce)");
  if (!objective) {
    if (independent.filter(autoGraded).length < 3) push("error", "independent practice needs ≥ 3 auto-graded exercises");
    if (![...guided, ...independent].some((e) => e.type === "produce")) push("error", "speaking/writing lessons need at least one production exercise");
  }
  if (l.skill === "listening") {
    const all = [...guided, ...independent];
    const withAudio = all.filter((e) => hasAudio(e.stimulusId ? stimuli[e.stimulusId] : undefined)).length;
    if (all.length && withAudio / all.length < 0.7) push("error", `listening lessons: ≥ 70% of exercises need an audio stimulus (${withAudio}/${all.length})`);
  }

  // Misconceptions = the mistake-analysis vocabulary of the lesson.
  if (Object.keys(misc).length < 2) push("error", "misconceptions: define at least 2");
  for (const [k, m] of Object.entries(misc)) {
    if (!m.label?.trim() || !m.explanationVi?.trim() || !m.fixVi?.trim()) push("error", `misconception "${k}" needs label, explanationVi, fixVi`);
    if (!usedMisc.has(k)) push("warning", `misconception "${k}" is never used`);
  }
  for (const k of Object.keys(stimuli)) if (!usedStimuli.has(k)) push("warning", `stimulus "${k}" is never used`);

  const m = l.mastery;
  if (!m || !(m.review > 0 && m.review < m.advance && m.advance <= 1)) push("error", "mastery thresholds must satisfy 0 < review < advance ≤ 1");

  if (!Array.isArray(l.vocabulary) || l.vocabulary.length < 4) push("error", "vocabulary: at least 4 linked expressions");
  for (const v of l.vocabulary ?? []) if (!v.term?.trim() || !v.vi?.trim() || !v.example?.trim()) push("error", `vocabulary "${v.term}": needs term, vi, example`);
  if (!Array.isArray(l.grammar)) push("error", "grammar must be an array");
  else if (!objective && l.grammar.length < 1) push("error", "speaking/writing lessons need at least one grammar point");
  for (const g of l.grammar ?? []) if (!g.point?.trim() || !g.explanationVi?.trim() || !g.examples?.length) push("error", `grammar "${g.point}": needs point, explanationVi, examples`);
  if (!Array.isArray(l.practice) || !l.practice.length || l.practice.some((p) => !p.route?.startsWith("/"))) push("error", "practice: at least one link with a route starting with /");

  if (!l.source) push("error", "missing source");
  if (!l.review || !["approved", "draft", "rejected"].includes(l.review.status)) push("error", "missing review.status");
  return issues;
}

/** Whole-curriculum checks: module membership, prerequisites, duplicates across lessons. */
export function validateCurriculum(map: CurriculumMap, lessons: Lesson[], file = "content/lessons/curriculum.json"): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (id: string, message: string, severity: ValidationIssue["severity"] = "error") => issues.push({ severity, file, id, message });
  const byId = new Map(lessons.map((l) => [l.id, l]));
  const position = new Map<string, { module: string; skill: Skill; index: number }>();
  for (const mod of [...map.modules].sort((a, b) => a.skill.localeCompare(b.skill) || a.order - b.order)) {
    for (const id of mod.lessons) {
      if (position.has(id)) push(id, `listed in more than one module`);
      const index = [...position.values()].filter((p) => p.skill === mod.skill).length;
      position.set(id, { module: mod.id, skill: mod.skill, index });
    }
  }
  for (const l of lessons) {
    const pos = position.get(l.id);
    if (!pos) { push(l.id, "lesson file is not listed in curriculum.json", "warning"); continue; }
    if (pos.module !== l.module) push(l.id, `module "${l.module}" does not match curriculum.json ("${pos.module}")`);
    if (pos.skill !== l.skill) push(l.id, `skill does not match its module`);
    for (const p of l.prerequisites ?? []) {
      const pp = position.get(p);
      if (!pp) push(l.id, `prerequisite "${p}" is not in the curriculum`);
      else if (pp.skill === l.skill && pp.index >= pos.index) push(l.id, `prerequisite "${p}" must come earlier in the curriculum`);
    }
  }
  for (const id of position.keys()) if (!byId.has(id)) push(id, "listed in curriculum.json but no valid lesson file yet", "warning");

  // Duplicate exercises across lessons (copy-paste guard).
  const seen = new Map<string, string>();
  for (const l of lessons) for (const ex of [...(l.guided ?? []), ...(l.independent ?? [])]) {
    const st = ex.stimulusId ? l.stimuli?.[ex.stimulusId] : undefined;
    const stimKey = st ? `${st.text ?? ""} ${(st.audio ?? []).map((s) => s.text).join(" ")} ${st.audioRef ? `${st.audioRef.setId}#${st.audioRef.chunk}` : ""} ${st.imageRef ?? ""}` : "";
    const key = normalizeAnswer(`${ex.prompt} ${stimKey} ${ex.type === "choice" ? ex.options.map((o) => o.text).join("|") : ""}`);
    const other = seen.get(key);
    if (other && other !== `${l.id}:${ex.id}`) push(l.id, `exercise ${ex.id} duplicates ${other}`);
    else seen.set(key, `${l.id}:${ex.id}`);
  }
  return issues;
}
