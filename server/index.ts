import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUDIO_DIR, load, replaceDb, resetDb, save, today, uid } from "./db";
import { AiError, aiConfigured, MODEL, streamChat } from "./ai";
import {
  enrichVocab, evaluateSpeaking, evaluateWriting, generateListening, generateReading,
  generateSpeakingPrompt, generateWritingPrompt, TUTOR_SYSTEM, type RawEvaluation,
} from "./prompts";
import {
  adaptDifficulty, adjustedWeights, analytics, buildPlan, categoryStats, dashboard, dueMistakes,
  isDue, logStudy, mistakePriority, newSrs, repeatCountFor, reviewSrs, skillSummaries, weakestCategory,
  weaknessProfileText,
} from "./analytics";
import {
  CATEGORIES, LISTENING_PARTS, READING_PARTS, SKILLS, SPEAKING_TASKS, TRAPS, WRITING_TASKS, type Skill,
} from "../shared/spec";
import type {
  Attempt, AttemptItem, ContentItem, Db, Evaluation, ListeningSet, McqQuestion, MistakeRecord, MockExam, Mode,
  ReadingSet, SpeakingPrompt, VocabItem, VocabSeed, WritingPrompt,
} from "../shared/types";

const app = express();
app.set("trust proxy", true);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// When deployed publicly, APP_PASSWORD protects the whole app (and the Gemini key) with HTTP Basic auth.
// The browser remembers the credentials and sends them with every same-origin request.
const APP_PASSWORD = process.env.APP_PASSWORD;
app.use((req, res, next) => {
  if (!APP_PASSWORD) return next();
  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");
  const password = scheme === "Basic" && encoded ? Buffer.from(encoded, "base64").toString().split(":").slice(1).join(":") : "";
  const ok = password.length === APP_PASSWORD.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(APP_PASSWORD));
  if (ok) return next();
  res.setHeader("WWW-Authenticate", 'Basic realm="CELPIP 8 Coach", charset="UTF-8"');
  res.status(401).send("Authentication required");
});

app.use(express.json({ limit: "10mb" }));

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

const now = () => new Date().toISOString();

// ---------------- helpers ----------------

function questionsOf(c: ReadingSet | ListeningSet): McqQuestion[] {
  return c.kind === "reading" ? c.questions : c.chunks.flatMap((ch) => ch.questions);
}

function recentTitles(db: Db, kind: ContentItem["kind"]): string[] {
  return Object.values(db.content).filter((c) => c.kind === kind).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((c) => c.title);
}

function normalizeQuestions(raw: Omit<McqQuestion, "id">[], setId: string, taskType: string): McqQuestion[] {
  return raw.map((q, i) => {
    let options = q.options;
    if (taskType === "R3") {
      // Part 3 always uses fixed A–E options; keep the model's trap/why notes where present.
      const labels = ["A", "B", "C", "D", "E — Not given in any paragraph"];
      options = labels.map((text, k) => ({ text, trap: q.options[k]?.trap ?? (k === q.answerIndex ? "none" : "wrong_detail"), whyVi: q.options[k]?.whyVi ?? "" }));
    }
    const answerIndex = Math.min(Math.max(0, q.answerIndex), options.length - 1);
    options = options.map((o, k) => ({ ...o, trap: k === answerIndex ? "none" : o.trap === "none" ? "partially_true" : o.trap }));
    return { ...q, number: q.number || i + 1, options, answerIndex, id: `${setId}-q${q.number || i + 1}` };
  });
}

function upsertVocab(db: Db, seed: VocabSeed, source: string): VocabItem | null {
  const term = seed.term.trim();
  if (!term) return null;
  const existing = db.vocab.find((v) => v.term.toLowerCase() === term.toLowerCase());
  if (existing) return null;
  const item: VocabItem = {
    id: uid("v"), term, vi: seed.vi, definition: seed.definition, example: seed.example,
    collocations: [], synonyms: [], celpipUsage: "", source, enriched: false,
    srs: newSrs(), reviews: 0, correctReviews: 0, createdAt: now(),
  };
  db.vocab.push(item);
  return item;
}

function modeOf(v: unknown): Mode {
  return v === "drill" || v === "exam" || v === "weekly" ? v : "learn";
}

/** For exam mode the answer key is stripped so the client cannot reveal feedback early. */
function publicContent(c: ContentItem, mode: Mode) {
  if (mode !== "exam") return c;
  const strip = (q: McqQuestion) => ({ ...q, answerIndex: -1, evidence: "", explanationVi: "", category: "", options: q.options.map((o) => ({ text: o.text, trap: "", whyVi: "" })) });
  if (c.kind === "reading") return { ...c, questions: c.questions.map(strip) };
  if (c.kind === "listening") return { ...c, chunks: c.chunks.map((ch) => ({ ...ch, questions: ch.questions.map(strip) })) };
  return c;
}

// ---------------- content generation ----------------

async function createReading(db: Db, taskType: string | undefined, mode: Mode, focusIn?: string): Promise<ReadingSet> {
  const drill = mode === "drill";
  const focus = focusIn ? [focusIn] : drill ? [weakestCategory(db, "reading") ?? "inference"] : [weakestCategory(db, "reading")].filter((x): x is string => !!x);
  // Drills default to Part 4 (viewpoints) for inference/attitude work, otherwise Part 1.
  const task = taskType ?? (drill ? (["inference", "main_idea"].includes(focus[0]) ? "R4" : "R1") : "R1");
  const difficulty = mode === "exam" ? 8 : db.settings.difficulty[task] ?? 7;
  const raw = await generateReading({ taskType: task, difficulty, focus: mode === "exam" ? [] : focus, avoidTitles: recentTitles(db, "reading"), drill, effort: db.settings.effort });
  const id = uid("rd");
  const set: ReadingSet = {
    id, kind: "reading", taskType: task, difficulty, title: raw.title, sections: raw.sections,
    questions: normalizeQuestions(raw.questions, id, task), vocabulary: raw.vocabulary, createdAt: now(), focus,
  };
  db.content[id] = set;
  return set;
}

async function createListening(db: Db, taskType: string | undefined, mode: Mode, focusIn?: string): Promise<ListeningSet> {
  const drill = mode === "drill";
  const focus = focusIn ? [focusIn] : drill ? [weakestCategory(db, "listening") ?? "paraphrase"] : [weakestCategory(db, "listening")].filter((x): x is string => !!x);
  const task = taskType ?? (drill ? (focus[0] === "speaker_attitude" ? "L6" : focus[0] === "long_conversation" ? "L5" : "L2") : "L1");
  const difficulty = mode === "exam" ? 8 : db.settings.difficulty[task] ?? 7;
  const raw = await generateListening({ taskType: task, difficulty, focus: mode === "exam" ? [] : focus, avoidTitles: recentTitles(db, "listening"), drill, effort: db.settings.effort });
  const id = uid("ls");
  let n = 0;
  const chunks = raw.chunks.map((ch) => ({
    segments: ch.segments,
    questions: normalizeQuestions(ch.questions.map((q) => ({ ...q, number: ++n })), id, task),
  }));
  const set: ListeningSet = { id, kind: "listening", taskType: task, difficulty, title: raw.title, context: raw.context, chunks, vocabulary: raw.vocabulary, createdAt: now(), focus };
  db.content[id] = set;
  return set;
}

async function createWriting(db: Db, taskType: string): Promise<WritingPrompt> {
  const difficulty = db.settings.difficulty[taskType] ?? 8;
  const raw = await generateWritingPrompt({ taskType, difficulty, avoidTitles: recentTitles(db, "writing") });
  const p: WritingPrompt = { id: uid("wr"), kind: "writing", taskType, difficulty, ...raw, createdAt: now() };
  db.content[p.id] = p;
  return p;
}

function sanitizeSvg(svg: string | null): string | null {
  if (!svg || !svg.includes("<svg")) return null;
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/(href|xlink:href)\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "");
}

async function createSpeaking(db: Db, taskType: string): Promise<SpeakingPrompt> {
  const difficulty = db.settings.difficulty[taskType] ?? 7;
  const raw = await generateSpeakingPrompt({ taskType, difficulty, avoidTitles: recentTitles(db, "speaking") });
  const p: SpeakingPrompt = { id: uid("sp"), kind: "speaking", taskType, difficulty, ...raw, svg: sanitizeSvg(raw.svg), createdAt: now() };
  db.content[p.id] = p;
  return p;
}

// ---------------- attempt processing ----------------

function processObjective(db: Db, body: {
  contentId: string; mode: Mode; answers: Record<string, number | null>; durationSec: number; timedOut?: boolean; mockExamId?: string | null;
}) {
  const c = db.content[body.contentId];
  if (!c || (c.kind !== "reading" && c.kind !== "listening")) throw new AiError("Không tìm thấy bài.", 404);
  const skill: Skill = c.kind;
  const qs = questionsOf(c);
  const items: AttemptItem[] = qs.map((q) => {
    const chosen = body.answers[q.id] ?? null;
    const correct = chosen === q.answerIndex;
    let category = q.category;
    if (chosen === null) category = skill === "reading" && body.timedOut ? "time_management" : skill === "listening" ? "missed_info" : q.category;
    return { questionId: q.id, number: q.number, category, correct, chosenIndex: chosen, chosenTrap: chosen === null ? null : q.options[chosen]?.trap ?? null };
  });
  const attempt: Attempt = {
    id: uid("at"), skill, taskType: c.taskType, mode: body.mode, contentId: c.id, difficulty: c.difficulty,
    startedAt: new Date(Date.now() - body.durationSec * 1000).toISOString(), finishedAt: now(),
    durationSec: Math.round(body.durationSec), correct: items.filter((i) => i.correct).length, total: items.length,
    items, estimatedBand: null, evaluationId: null, mockExamId: body.mockExamId ?? null,
  };
  db.attempts.push(attempt);

  const created: MistakeRecord[] = [];
  const wrongText: string[] = [];
  for (const it of items) {
    if (it.correct) continue;
    const q = qs.find((x) => x.id === it.questionId)!;
    wrongText.push(`${q.prompt} ${q.evidence}`.toLowerCase());
    const repeatCount = repeatCountFor(db, skill, it.category);
    const chosen = it.chosenIndex === null ? null : q.options[it.chosenIndex];
    const m: MistakeRecord = {
      id: uid("m"), skill, taskType: c.taskType, questionId: q.id, contentId: c.id, category: it.category,
      trap: it.chosenTrap, difficulty: c.difficulty,
      question: `Q${q.number}. ${q.prompt}`,
      learnerResponse: chosen ? chosen.text : "(bỏ trống)",
      correctAnswer: q.options[q.answerIndex].text,
      explanation: [q.explanationVi, chosen?.whyVi ? `Vì sao đáp án bạn chọn sai: ${chosen.whyVi}` : ""].filter(Boolean).join("\n"),
      vocabulary: c.vocabulary.filter((v) => `${q.prompt} ${q.evidence}`.toLowerCase().includes(v.term.toLowerCase())).map((v) => v.term),
      priority: mistakePriority(db, skill, repeatCount), repeatCount, srs: newSrs(),
      createdAt: now(), lastSeenAt: now(), resolved: false,
    };
    db.mistakes.push(m);
    created.push(m);
  }

  // Vocabulary: words tied to wrong answers first, plus a few key words from the set.
  const added: VocabItem[] = [];
  const related = c.vocabulary.filter((v) => wrongText.some((t) => t.includes(v.term.toLowerCase())));
  const others = c.vocabulary.filter((v) => !related.includes(v)).slice(0, created.length ? 3 : 2);
  for (const seed of [...related, ...others]) {
    const v = upsertVocab(db, seed, `${skill}:${c.taskType}`);
    if (v) added.push(v);
  }

  logStudy(db, skill, attempt.durationSec);
  adaptDifficulty(db, attempt);
  return { attempt, created, added };
}

function weaknessReport(attempt: Attempt) {
  const byCat = new Map<string, { correct: number; total: number }>();
  for (const it of attempt.items) {
    const r = byCat.get(it.category) ?? { correct: 0, total: 0 };
    r.total += 1;
    if (it.correct) r.correct += 1;
    byCat.set(it.category, r);
  }
  const cats = CATEGORIES[attempt.skill];
  const rows = [...byCat.entries()].map(([category, r]) => ({ category, label: cats[category] ?? category, ...r }));
  const traps = new Map<string, number>();
  for (const it of attempt.items) if (!it.correct && it.chosenTrap) traps.set(it.chosenTrap, (traps.get(it.chosenTrap) ?? 0) + 1);
  const worst = rows.filter((r) => r.correct < r.total).sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
  return {
    rows,
    traps: [...traps.entries()].map(([trap, count]) => ({ trap, label: TRAPS[trap] ?? trap, count })).sort((a, b) => b.count - a.count),
    followUpFocus: worst?.category ?? null,
    summary: worst
      ? `Lỗi chính lần này: ${worst.label} (${worst.correct}/${worst.total}). Làm bài drill tiếp theo để sửa đúng lỗi này.`
      : "Không sai câu nào — hệ thống sẽ tăng độ khó cho lần sau.",
  };
}

function storeEvaluation(db: Db, args: {
  skill: "writing" | "speaking"; content: WritingPrompt | SpeakingPrompt; response: string; raw: RawEvaluation;
  durationSec: number; transcriptSource: "speech-to-text" | "typed" | null; audioFile: string | null; mode: Mode; mockExamId: string | null;
}) {
  const { raw, content } = args;
  const lo = Math.max(1, Math.min(12, raw.bandLow));
  const hi = Math.max(lo, Math.min(12, raw.bandHigh));
  const ev: Evaluation = {
    id: uid("ev"), skill: args.skill, taskType: content.taskType, contentId: content.id, response: args.response,
    meta: {
      wordCount: args.response.trim().split(/\s+/).filter(Boolean).length, durationSec: Math.round(args.durationSec),
      audioFile: args.audioFile, transcriptSource: args.transcriptSource,
    },
    bandLow: lo, bandHigh: hi, dimensions: raw.dimensions, strengths: raw.strengths, weaknesses: raw.weaknesses.slice(0, 3),
    corrections: raw.corrections, improvedVersion: raw.improvedVersion, improvementNotesVi: raw.improvementNotesVi,
    reusableExpressions: raw.reusableExpressions, followUpExercise: raw.followUpExercise,
    audioCaveat: args.skill === "speaking"
      ? "Nhận xét dựa trên bản chép lời (speech-to-text). Phát âm, ngữ điệu và độ trôi chảy trong âm thanh KHÔNG được AI đánh giá — hãy tự nghe lại bản ghi âm."
      : null,
    createdAt: now(),
  };
  db.evaluations[ev.id] = ev;
  const attempt: Attempt = {
    id: uid("at"), skill: args.skill, taskType: content.taskType, mode: args.mode, contentId: content.id, difficulty: content.difficulty,
    startedAt: new Date(Date.now() - args.durationSec * 1000).toISOString(), finishedAt: now(), durationSec: Math.round(args.durationSec),
    correct: 0, total: 0, items: [], estimatedBand: [lo, hi], evaluationId: ev.id, mockExamId: args.mockExamId,
  };
  db.attempts.push(attempt);
  for (const w of ev.weaknesses) {
    const repeatCount = repeatCountFor(db, args.skill, w.category);
    const fix = ev.corrections[0];
    db.mistakes.push({
      id: uid("m"), skill: args.skill, taskType: content.taskType, questionId: ev.id, contentId: content.id, category: w.category, trap: null,
      difficulty: content.difficulty, question: content.title, learnerResponse: fix ? fix.original : args.response.slice(0, 200),
      correctAnswer: fix ? fix.corrected : ev.improvedVersion.slice(0, 300), explanation: w.descriptionVi,
      vocabulary: raw.vocabulary.map((v) => v.term).slice(0, 4), priority: mistakePriority(db, args.skill, repeatCount),
      repeatCount, srs: newSrs(), createdAt: now(), lastSeenAt: now(), resolved: false,
    });
  }
  for (const seed of raw.vocabulary) upsertVocab(db, seed, `${args.skill}-feedback`);
  logStudy(db, args.skill, args.durationSec);
  adaptDifficulty(db, attempt);
  return { evaluation: ev, attempt };
}

// ---------------- routes: core ----------------

app.get("/api/status", (_req, res) => res.json({ aiConfigured: aiConfigured(), model: MODEL, today: today() }));

app.get("/api/dashboard", h((req, res) => {
  const minutes = Number(req.query.minutes) || undefined;
  res.json(dashboard(load(), minutes));
}));

app.get("/api/plan", h((req, res) => {
  const db = load();
  res.json(buildPlan(db, Number(req.query.minutes) || db.settings.dailyMinutes));
}));

app.post("/api/plan/complete", h(async (req, res) => {
  const db = load();
  const list = (db.planCompletions[today()] ??= []);
  const { blockId, done } = req.body as { blockId: string; done: boolean };
  if (done && !list.includes(blockId)) list.push(blockId);
  if (!done) db.planCompletions[today()] = list.filter((x) => x !== blockId);
  await save();
  res.json({ ok: true });
}));

app.get("/api/settings", (_req, res) => res.json(load().settings));

app.put("/api/settings", h(async (req, res) => {
  const db = load();
  const next = { ...db.settings, ...req.body };
  const total = SKILLS.reduce((n, k) => n + Number(next.weights[k] || 0), 0);
  if (Math.abs(total - 100) > 0.5) throw new AiError("Tổng tỷ trọng các kỹ năng phải bằng 100%.", 400);
  db.settings = next;
  await save();
  res.json(db.settings);
}));

app.get("/api/content/:id", h((req, res) => {
  const c = load().content[String(req.params.id)];
  if (!c) throw new AiError("Không tìm thấy nội dung.", 404);
  res.json(publicContent(c, modeOf(req.query.mode)));
}));

app.get("/api/attempts/:id", h((req, res) => {
  const db = load();
  const a = db.attempts.find((x) => x.id === req.params.id);
  if (!a) throw new AiError("Không tìm thấy lượt làm bài.", 404);
  res.json({ attempt: a, content: db.content[a.contentId] ?? null });
}));

app.get("/api/history", h((req, res) => {
  const db = load();
  const skill = String(req.query.skill ?? "");
  const rows = db.attempts.filter((a) => !skill || a.skill === skill).slice(-50).reverse().map((a) => ({
    ...a, title: db.content[a.contentId]?.title ?? "", items: undefined,
  }));
  res.json(rows);
}));

// ---------------- routes: generation ----------------

app.post("/api/generate/:kind", h(async (req, res) => {
  const db = load();
  const { taskType, focus } = req.body as { taskType?: string; focus?: string };
  const mode = modeOf(req.body.mode);
  const kind = String(req.params.kind);
  let item: ContentItem;
  if (kind === "reading") item = await createReading(db, taskType, mode, focus);
  else if (kind === "listening") item = await createListening(db, taskType, mode, focus);
  else if (kind === "writing") item = await createWriting(db, taskType ?? "W1");
  else if (kind === "speaking") item = await createSpeaking(db, taskType ?? "S1");
  else throw new AiError("Loại bài không hợp lệ.", 400);
  await save();
  res.json(publicContent(item, mode));
}));

// ---------------- routes: attempts & evaluation ----------------

app.post("/api/attempts/objective", h(async (req, res) => {
  const db = load();
  const mode = modeOf(req.body.mode);
  const { attempt, created, added } = processObjective(db, { ...req.body, mode });
  await save();
  if (mode === "exam") return res.json({ attemptId: attempt.id, recorded: true });
  const c = db.content[attempt.contentId];
  res.json({ attempt, content: c, mistakes: created, vocabAdded: added, report: weaknessReport(attempt), newDifficulty: db.settings.difficulty[attempt.taskType] });
}));

app.post("/api/evaluate/writing", h(async (req, res) => {
  const db = load();
  const { contentId, response, durationSec } = req.body as { contentId: string; response: string; durationSec: number };
  const content = db.content[contentId];
  if (!content || content.kind !== "writing") throw new AiError("Không tìm thấy đề viết.", 404);
  if (response.trim().split(/\s+/).length < 20) throw new AiError("Bài viết quá ngắn để đánh giá (cần ít nhất 20 từ).", 400);
  const wordCount = response.trim().split(/\s+/).filter(Boolean).length;
  const raw = await evaluateWriting({ prompt: content, response, wordCount, minutesUsed: Math.round(durationSec / 60), profile: weaknessProfileText(db) });
  const out = storeEvaluation(db, { skill: "writing", content, response, raw, durationSec, transcriptSource: null, audioFile: null, mode: modeOf(req.body.mode), mockExamId: null });
  await save();
  res.json({ ...out, newDifficulty: db.settings.difficulty[content.taskType] });
}));

app.post("/api/evaluate/speaking", h(async (req, res) => {
  const db = load();
  const { contentId, transcript, durationSec, transcriptSource, audioFile, chosenOption } = req.body as {
    contentId: string; transcript: string; durationSec: number; transcriptSource: "speech-to-text" | "typed"; audioFile: string | null; chosenOption: string | null;
  };
  const content = db.content[contentId];
  if (!content || content.kind !== "speaking") throw new AiError("Không tìm thấy đề nói.", 404);
  if (transcript.trim().split(/\s+/).length < 8) throw new AiError("Bản chép lời quá ngắn để đánh giá.", 400);
  const raw = await evaluateSpeaking({ prompt: content, transcript, durationSec, transcriptSource, profile: weaknessProfileText(db), chosenOption });
  const out = storeEvaluation(db, { skill: "speaking", content, response: transcript, raw, durationSec, transcriptSource, audioFile, mode: modeOf(req.body.mode), mockExamId: null });
  await save();
  res.json({ ...out, newDifficulty: db.settings.difficulty[content.taskType] });
}));

app.get("/api/evaluations/:id", h((req, res) => {
  const ev = load().evaluations[String(req.params.id)];
  if (!ev) throw new AiError("Không tìm thấy đánh giá.", 404);
  res.json(ev);
}));

app.post("/api/audio", express.raw({ type: ["audio/*", "video/webm", "application/octet-stream"], limit: "30mb" }), h((req, res) => {
  load();
  const ext = String(req.headers["content-type"] ?? "").includes("ogg") ? "ogg" : String(req.headers["content-type"] ?? "").includes("mp4") ? "m4a" : "webm";
  const file = `${uid("rec")}.${ext}`;
  fs.writeFileSync(path.join(AUDIO_DIR, file), req.body as Buffer);
  res.json({ file });
}));

app.get("/api/audio/:file", (req, res) => {
  const file = path.basename(String(req.params.file));
  const full = path.join(AUDIO_DIR, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  res.sendFile(full);
});

// ---------------- routes: mistakes ----------------

app.get("/api/mistakes", h((req, res) => {
  const db = load();
  const status = String(req.query.status ?? "open");
  let list = status === "due" ? dueMistakes(db) : status === "all" ? [...db.mistakes] : db.mistakes.filter((m) => !m.resolved);
  if (status !== "due") list = list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  // Attach the original question (with options) so objective mistakes can be re-answered.
  res.json(list.map((m) => {
    const c = db.content[m.contentId];
    const q = c && (c.kind === "reading" || c.kind === "listening") ? questionsOf(c).find((x) => x.id === m.questionId) ?? null : null;
    return { ...m, original: q, contentTitle: c?.title ?? "" };
  }));
}));

app.post("/api/mistakes/:id/review", h(async (req, res) => {
  const db = load();
  const m = db.mistakes.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy lỗi.", 404);
  const { correct, seconds } = req.body as { correct: boolean; seconds?: number };
  m.srs = reviewSrs(m.srs, correct ? 4 : 1);
  m.lastSeenAt = now();
  if (!correct) m.repeatCount += 1;
  m.priority = mistakePriority(db, m.skill, m.repeatCount);
  if (m.srs.reps >= 3 && m.srs.interval >= 14) m.resolved = true;
  logStudy(db, "review", seconds ?? 45);
  await save();
  res.json(m);
}));

app.post("/api/mistakes/:id/resolve", h(async (req, res) => {
  const db = load();
  const m = db.mistakes.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy lỗi.", 404);
  m.resolved = Boolean(req.body.resolved ?? true);
  await save();
  res.json(m);
}));

app.get("/api/weakness", h((_req, res) => {
  const db = load();
  res.json({ stats: categoryStats(db), profile: weaknessProfileText(db), skills: skillSummaries(db) });
}));

// ---------------- routes: vocabulary ----------------

app.get("/api/vocab", (_req, res) => {
  const db = load();
  res.json(db.vocab.map((v) => ({ ...v, due: isDue(v.srs) })));
});

app.post("/api/vocab", h(async (req, res) => {
  const db = load();
  const { term, context, source } = req.body as { term: string; context?: string; source?: string };
  if (!term?.trim()) throw new AiError("Thiếu từ.", 400);
  const existing = db.vocab.find((v) => v.term.toLowerCase() === term.trim().toLowerCase());
  if (existing) return res.json(existing);
  const { items } = await enrichVocab([{ term: term.trim(), context: context ?? "" }]);
  const e = items[0];
  const item: VocabItem = {
    id: uid("v"), term: term.trim(), vi: e.vi, definition: e.definition, example: e.example, collocations: e.collocations,
    synonyms: e.synonyms, celpipUsage: e.celpipUsage, source: source ?? "manual", enriched: true, srs: newSrs(),
    reviews: 0, correctReviews: 0, createdAt: now(),
  };
  db.vocab.push(item);
  await save();
  res.json(item);
}));

app.post("/api/vocab/enrich", h(async (_req, res) => {
  const db = load();
  const pending = db.vocab.filter((v) => !v.enriched).slice(0, 20);
  if (!pending.length) return res.json({ updated: 0 });
  const { items } = await enrichVocab(pending.map((v) => ({ term: v.term, context: v.example })));
  pending.forEach((v, i) => {
    const e = items[i];
    if (!e) return;
    Object.assign(v, { vi: e.vi || v.vi, definition: e.definition || v.definition, example: e.example || v.example, collocations: e.collocations, synonyms: e.synonyms, celpipUsage: e.celpipUsage, enriched: true });
  });
  await save();
  res.json({ updated: pending.length });
}));

app.post("/api/vocab/:id/review", h(async (req, res) => {
  const db = load();
  const v = db.vocab.find((x) => x.id === req.params.id);
  if (!v) throw new AiError("Không tìm thấy từ.", 404);
  const quality = Math.max(0, Math.min(5, Number(req.body.quality)));
  v.srs = reviewSrs(v.srs, quality);
  v.reviews += 1;
  if (quality >= 3) v.correctReviews += 1;
  logStudy(db, "vocab", Number(req.body.seconds) || 15);
  await save();
  res.json(v);
}));

app.delete("/api/vocab/:id", h(async (req, res) => {
  const db = load();
  db.vocab = db.vocab.filter((v) => v.id !== req.params.id);
  await save();
  res.json({ ok: true });
}));

// ---------------- routes: analytics, weekly check-in ----------------

app.get("/api/analytics", (_req, res) => res.json(analytics(load())));

app.post("/api/weekly/checkin", h(async (_req, res) => {
  const db = load();
  const start = new Date(db.settings.startDate + "T12:00:00").getTime();
  const week = Math.max(1, Math.floor((Date.now() - start) / 86400000 / 7) + 1);
  const summaries = skillSummaries(db);
  const before = { ...db.settings.weights };
  const after = db.settings.autoAdjust ? adjustedWeights(db) : before;
  db.settings.weights = after;
  const weakest = summaries.reduce((a, b) => ((a.estimate ?? a.official) <= (b.estimate ?? b.official) ? a : b));
  const entry = {
    id: uid("wk"), week, date: today(),
    estimates: Object.fromEntries(summaries.map((s) => [s.skill, s.estimate])) as Record<Skill, number | null>,
    weightsBefore: before, weightsAfter: after,
    note: db.settings.autoAdjust
      ? `Đã điều chỉnh tỷ trọng theo khoảng cách tới Level ${db.settings.targetLevel}. Kỹ năng yếu nhất hiện tại: ${weakest.skill}.`
      : "Tự động điều chỉnh đang tắt — giữ nguyên tỷ trọng.",
  };
  db.weekly = db.weekly.filter((w) => w.week !== week);
  db.weekly.push(entry);
  await save();
  res.json(entry);
}));

// ---------------- routes: mock exam ----------------

async function prepareMock(db: Db, mock: MockExam) {
  const jobs: { list: string[]; run: () => Promise<ContentItem> }[] = [
    ...LISTENING_PARTS.map((p) => ({ list: mock.listening, run: () => createListening(db, p.id, "exam") })),
    ...READING_PARTS.map((p) => ({ list: mock.reading, run: () => createReading(db, p.id, "exam") })),
    ...WRITING_TASKS.map((t) => ({ list: mock.writing, run: () => createWriting(db, t.id) })),
    ...SPEAKING_TASKS.map((t) => ({ list: mock.speaking, run: () => createSpeaking(db, t.id) })),
  ];
  mock.progress = { done: 0, total: jobs.length, error: null };
  const results: (ContentItem | null)[] = new Array(jobs.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      for (let attempt = 0; attempt < 2 && !results[i]; attempt++) {
        try { results[i] = await jobs[i].run(); } catch (e) { if (attempt === 1) throw e; }
      }
      mock.progress.done += 1;
    }
  };
  try {
    await Promise.all([worker(), worker(), worker(), worker()]);
    jobs.forEach((j, i) => j.list.push(results[i]!.id));
    mock.status = "ready";
  } catch (e) {
    mock.status = "failed";
    mock.progress.error = e instanceof Error ? e.message : String(e);
  }
  await save();
}

app.get("/api/mock", (_req, res) => res.json([...load().mockExams].reverse()));

app.get("/api/mock/:id", h((req, res) => {
  const m = load().mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  res.json(m);
}));

app.post("/api/mock", h(async (_req, res) => {
  const db = load();
  if (!aiConfigured()) throw new AiError("Chưa cấu hình GEMINI_API_KEY.", 503);
  const mock: MockExam = {
    id: uid("mk"), createdAt: now(), status: "preparing", progress: { done: 0, total: 20, error: null },
    listening: [], reading: [], writing: [], speaking: [], attemptIds: [], submissions: [], results: null, finishedAt: null,
  };
  db.mockExams.push(mock);
  await save();
  void prepareMock(db, mock);
  res.json(mock);
}));

app.get("/api/mock/:id/report", h((req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  const attempts = db.attempts.filter((a) => a.mockExamId === m.id).map((a) => ({
    id: a.id, skill: a.skill, taskType: a.taskType, correct: a.correct, total: a.total, estimatedBand: a.estimatedBand,
    evaluationId: a.evaluationId, title: db.content[a.contentId]?.title ?? "",
    categories: a.items.reduce<Record<string, { correct: number; total: number }>>((acc, it) => {
      const r = (acc[it.category] ??= { correct: 0, total: 0 });
      r.total += 1;
      if (it.correct) r.correct += 1;
      return acc;
    }, {}),
  }));
  res.json({ mock: m, attempts });
}));

app.post("/api/mock/:id/start", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m || m.status !== "ready") throw new AiError("Bài thi chưa sẵn sàng.", 400);
  m.status = "in_progress";
  await save();
  res.json(m);
}));

app.post("/api/mock/:id/objective", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  const { attempt } = processObjective(db, { ...req.body, mode: "exam", mockExamId: m.id });
  m.attemptIds.push(attempt.id);
  await save();
  res.json({ recorded: true });
}));

app.post("/api/mock/:id/submission", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  m.submissions = m.submissions.filter((s) => s.contentId !== req.body.contentId);
  m.submissions.push(req.body);
  await save();
  res.json({ recorded: true });
}));

app.post("/api/mock/:id/finish", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  m.status = "grading";
  await save();
  res.json(m);
  void gradeMock(db, m);
}));

async function gradeMock(db: Db, m: MockExam) {
  try {
    const profile = weaknessProfileText(db);
    const graded = await Promise.all(m.submissions.map(async (s) => {
      const content = db.content[s.contentId];
      if (!content || (content.kind !== "writing" && content.kind !== "speaking")) return null;
      if (s.response.trim().split(/\s+/).filter(Boolean).length < 8) {
        return { skill: s.skill, band: 3 }; // effectively no response
      }
      const raw = content.kind === "writing"
        ? await evaluateWriting({ prompt: content, response: s.response, wordCount: s.response.trim().split(/\s+/).length, minutesUsed: Math.round(s.durationSec / 60), profile })
        : await evaluateSpeaking({ prompt: content, transcript: s.response, durationSec: s.durationSec, transcriptSource: s.transcriptSource ?? "typed", profile, chosenOption: s.chosenOption });
      const { attempt } = storeEvaluation(db, {
        skill: s.skill, content, response: s.response, raw, durationSec: s.durationSec,
        transcriptSource: s.transcriptSource, audioFile: s.audioFile, mode: "exam", mockExamId: m.id,
      });
      m.attemptIds.push(attempt.id);
      return { skill: s.skill, band: (raw.bandLow + raw.bandHigh) / 2 };
    }));
    const results: NonNullable<MockExam["results"]> = {};
    for (const skill of ["listening", "reading"] as const) {
      const atts = db.attempts.filter((a) => a.mockExamId === m.id && a.skill === skill);
      const correct = atts.reduce((n, a) => n + a.correct, 0);
      const total = atts.reduce((n, a) => n + a.total, 0);
      const acc = total ? correct / total : 0;
      // Unofficial heuristic on level-8 material — not the official raw-score conversion.
      const estimate = total ? Math.round((8 + (acc >= 0.85 ? 1 : acc >= 0.75 ? 0 : acc >= 0.6 ? -1 : acc >= 0.45 ? -2 : -3)) * 2) / 2 : null;
      results[skill] = { correct, total, estimate };
    }
    for (const skill of ["writing", "speaking"] as const) {
      const bands = graded.filter((g) => g && g.skill === skill).map((g) => g!.band);
      results[skill] = { estimate: bands.length ? Math.round((bands.reduce((a, b) => a + b, 0) / bands.length) * 2) / 2 : null };
    }
    m.results = results;
    m.status = "done";
    m.finishedAt = now();
  } catch (e) {
    m.status = "failed";
    m.progress.error = e instanceof Error ? e.message : String(e);
  }
  await save();
}

// ---------------- routes: tutor ----------------

app.post("/api/tutor", h(async (req, res) => {
  const db = load();
  const { context, messages } = req.body as { context: unknown; messages: { role: "user" | "assistant"; content: string }[] };
  if (!messages?.length || messages[0].role !== "user") throw new AiError("Tin nhắn không hợp lệ.", 400);
  const ctx = `<context>\nCurrent exercise:\n${JSON.stringify(context ?? { page: "general" }, null, 1)}\n\nWeakness profile:\n${weaknessProfileText(db)}\n</context>\n\n`;
  const msgs = messages.map((m, i) => ({ role: m.role, content: i === 0 ? ctx + m.content : m.content }));
  await streamChat(res, TUTOR_SYSTEM, msgs);
}));

// ---------------- routes: data management ----------------

app.get("/api/export", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="celpip8-coach-backup-${today()}.json"`);
  res.json(load());
});

app.post("/api/import", h(async (req, res) => {
  const data = req.body as Db;
  if (!data || data.version !== 1 || !data.settings) throw new AiError("File sao lưu không hợp lệ.", 400);
  await replaceDb(data);
  res.json({ ok: true });
}));

app.post("/api/reset", h(async (_req, res) => {
  await resetDb();
  res.json({ ok: true });
}));

// ---------------- static (production) + errors ----------------

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AiError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  if (!(err instanceof AiError)) console.error(err);
  else if (status >= 500) console.error(`[${status}] ${message}`);
  if (!res.headersSent) res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  console.log(`CELPIP 8 Coach API on http://localhost:${port} (AI ${aiConfigured() ? `enabled, model ${MODEL}` : "NOT configured — add GEMINI_API_KEY to .env"})`);
});
