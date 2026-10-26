import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AUDIO_DIR, load, replaceDb, resetDb, save, today, uid } from "./db";
import { AiError, aiConfigured, availability, MODEL, onUsage, streamChat, TTS_MODEL } from "./ai";
import { enrichVocab, evaluateSpeaking, evaluateWriting, TUTOR_SYSTEM, type RawEvaluation } from "./prompts";
import {
  adaptDifficulty, adjustedWeights, analytics, buildPlan, categoryStats, dashboard, dueMistakes,
  isDue, logStudy, mistakePriority, newSrs, repeatCountFor as repeatCount, reviewSrs, skillSummaries, weaknessProfileText,
} from "./analytics";
import { library, reloadLibrary } from "./library";
import { candidates, mockPackages, selectNext } from "./selection";
import { AUDIO_ASSETS_DIR, audioJob, audioStatus, generateAudioBatch, manifestEntry, stopAudioJob } from "./audio";
import { createJob, decide, getJob, importApproved, listJobs, readDraft, runJob, type JobSkill } from "./pipeline";
import { CATEGORIES, SKILLS, TRAPS, type Skill } from "../shared/spec";
import { TOPIC_LABEL, type VocabEntry } from "../shared/content";
import type {
  Attempt, AttemptItem, ContentItem, Db, Evaluation, ListeningSet, McqQuestion, MistakeRecord, MockExam, Mode,
  SpeakingPrompt, Submission, VocabItem, VocabSeed, WritingPrompt,
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
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// Persist every AI call (Layer C usage log, capped) without blocking the request.
let usageSaveTimer: NodeJS.Timeout | null = null;
onUsage((e) => {
  const db = load();
  db.aiUsage.push(e);
  if (db.aiUsage.length > 3000) db.aiUsage.splice(0, db.aiUsage.length - 3000);
  usageSaveTimer ??= setTimeout(() => { usageSaveTimer = null; void save(); }, 1000);
});

// ---------------- helpers ----------------

function questionsOf(c: { kind: string } & Partial<{ questions: McqQuestion[]; chunks: { questions: McqQuestion[] }[] }>): McqQuestion[] {
  return c.kind === "reading" ? c.questions ?? [] : c.kind === "listening" ? (c.chunks ?? []).flatMap((ch) => ch.questions) : [];
}

/** Library first (active, then inactive for history), then legacy AI-generated content kept in progress.json. */
function getContent(db: Db, id: string): ContentItem | null {
  const lib = library();
  return lib.items.get(id) ?? lib.all.get(id)?.item ?? db.content[id] ?? null;
}

const bankIndex = () => new Map(library().vocab.map((v) => [v.term.trim().toLowerCase(), v]));

function fromBank(e: VocabEntry, source: string): VocabItem {
  return {
    id: uid("v"), term: e.term, vi: e.vi, definition: e.definition, example: e.example, collocations: e.collocations,
    synonyms: e.synonyms, celpipUsage: `Chủ đề: ${TOPIC_LABEL[e.topic] ?? e.topic} · dùng nhiều ở ${e.tasks.join(", ")} · cấp độ ~${e.difficulty}`,
    source, enriched: true, srs: newSrs(), reviews: 0, correctReviews: 0, createdAt: now(),
  };
}

/** Adds a seed to the notebook, enriched from the vocabulary library when the term exists there (no AI). */
function upsertVocab(db: Db, seed: VocabSeed, source: string): VocabItem | null {
  const term = seed.term.trim();
  if (!term || db.vocab.some((v) => v.term.toLowerCase() === term.toLowerCase())) return null;
  const bank = bankIndex().get(term.toLowerCase());
  const item: VocabItem = bank ? fromBank(bank, source) : {
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

/** Listening sets carry their pre-generated audio references; exam mode strips the answer key. */
function publicContent(c: ContentItem, mode: Mode) {
  let out: ContentItem & { audio?: unknown } = c;
  if (c.kind === "listening") {
    const st = c.id ? audioStatus(c) : null;
    out = {
      ...c,
      audio: st && {
        ready: st.ready,
        chunks: st.chunks.map((ch) => ({ url: ch.file ? `/api/audio-assets/${ch.file}` : null, durationSec: ch.durationSec, segments: ch.file ? manifestEntry(ch.file)?.segments ?? null : null })),
      },
    };
  }
  if (mode !== "exam") return out;
  const strip = (q: McqQuestion) => ({ ...q, answerIndex: -1, evidence: "", explanationVi: "", category: "", vocabulary: [], options: q.options.map((o) => ({ text: o.text, trap: "", whyVi: "" })) });
  if (out.kind === "reading") return { ...out, questions: out.questions.map(strip) };
  if (out.kind === "listening") return { ...out, chunks: out.chunks.map((ch) => ({ ...ch, questions: ch.questions.map(strip) })) };
  if (out.kind === "writing") return { ...out, modelResponse: undefined, structure: undefined, usefulExpressions: undefined, commonMistakes: undefined };
  if (out.kind === "speaking") return { ...out, modelAnswer: undefined, structure: undefined, usefulExpressions: undefined, commonMistakes: undefined };
  return out;
}

// ---------------- attempt processing ----------------

function processObjective(db: Db, body: {
  contentId: string; mode: Mode; answers: Record<string, number | null>; durationSec: number; timedOut?: boolean; mockExamId?: string | null;
}) {
  const c = getContent(db, body.contentId);
  if (!c || (c.kind !== "reading" && c.kind !== "listening")) throw new AiError("Không tìm thấy bài.", 404);
  const skill: Skill = c.kind;
  const qs = questionsOf(c);
  const items: AttemptItem[] = qs.map((q) => {
    const chosen = body.answers?.[q.id] ?? null;
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
    const rc = repeatCount(db, skill, it.category);
    const chosen = it.chosenIndex === null ? null : q.options[it.chosenIndex];
    const qVocab = q.vocabulary?.length ? q.vocabulary : c.vocabulary.filter((v) => `${q.prompt} ${q.evidence}`.toLowerCase().includes(v.term.toLowerCase())).map((v) => v.term);
    const m: MistakeRecord = {
      id: uid("m"), skill, taskType: c.taskType, questionId: q.id, contentId: c.id, category: it.category,
      trap: it.chosenTrap, difficulty: c.difficulty,
      question: `Q${q.number}. ${q.prompt}`,
      learnerResponse: chosen ? chosen.text : "(bỏ trống)",
      correctAnswer: q.options[q.answerIndex].text,
      explanation: [q.explanationVi, chosen?.whyVi ? `Vì sao đáp án bạn chọn sai: ${chosen.whyVi}` : ""].filter(Boolean).join("\n"),
      vocabulary: qVocab,
      priority: mistakePriority(db, skill, rc), repeatCount: rc, srs: newSrs(),
      createdAt: now(), lastSeenAt: now(), resolved: false,
    };
    db.mistakes.push(m);
    created.push(m);
  }

  // Vocabulary: words tied to wrong answers first, plus a few key words from the set.
  const added: VocabItem[] = [];
  const wrongVocab = new Set(created.flatMap((m) => m.vocabulary.map((t) => t.toLowerCase())));
  const related = c.vocabulary.filter((v) => wrongVocab.has(v.term.toLowerCase()) || wrongText.some((t) => t.includes(v.term.toLowerCase())));
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
  const worst = rows.filter((r) => r.correct < r.total && r.category !== "time_management").sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
  return {
    rows,
    traps: [...traps.entries()].map(([trap, count]) => ({ trap, label: TRAPS[trap] ?? trap, count })).sort((a, b) => b.count - a.count),
    followUpFocus: worst?.category ?? null,
    summary: worst
      ? `Lỗi chính lần này: ${worst.label} (${worst.correct}/${worst.total}). Làm drill tiếp theo để sửa đúng lỗi này.`
      : "Không sai câu nào — hệ thống sẽ tăng độ khó cho lần sau.",
  };
}

/** Records a writing/speaking response without AI: an attempt (for history/time) + a pending submission. */
function createSubmission(db: Db, body: {
  skill: "writing" | "speaking"; contentId: string; response: string; durationSec: number; transcriptSource: Submission["transcriptSource"];
  audioFile: string | null; chosenOption: string | null; mode: Mode; mockExamId: string | null;
}): Submission {
  const content = getContent(db, body.contentId);
  if (!content || content.kind !== body.skill) throw new AiError("Không tìm thấy đề bài.", 404);
  const attempt: Attempt = {
    id: uid("at"), skill: body.skill, taskType: content.taskType, mode: body.mode, contentId: content.id, difficulty: content.difficulty,
    startedAt: new Date(Date.now() - body.durationSec * 1000).toISOString(), finishedAt: now(), durationSec: Math.round(body.durationSec),
    correct: 0, total: 0, items: [], estimatedBand: null, evaluationId: null, mockExamId: body.mockExamId,
  };
  db.attempts.push(attempt);
  const sub: Submission = {
    id: uid("sub"), skill: body.skill, contentId: content.id, attemptId: attempt.id, response: body.response,
    durationSec: Math.round(body.durationSec), transcriptSource: body.transcriptSource, audioFile: body.audioFile,
    chosenOption: body.chosenOption, createdAt: now(), status: "pending", evaluationId: null, lastError: null, mockExamId: body.mockExamId,
  };
  db.submissions.push(sub);
  logStudy(db, body.skill, body.durationSec);
  return sub;
}

const cacheKey = (contentId: string, response: string, extra: string) =>
  crypto.createHash("sha256").update(`${contentId}\n${extra}\n${response.trim().replace(/\s+/g, " ")}`).digest("hex");

/** Calls Gemini (on explicit request) and attaches the evaluation to the submission's attempt. */
async function evaluateSubmission(db: Db, sub: Submission): Promise<{ evaluation: Evaluation; cached: boolean }> {
  if (sub.status === "evaluated" && sub.evaluationId && db.evaluations[sub.evaluationId]) {
    return { evaluation: db.evaluations[sub.evaluationId], cached: true };
  }
  const content = getContent(db, sub.contentId) as WritingPrompt | SpeakingPrompt | null;
  if (!content) throw new AiError("Không tìm thấy đề bài.", 404);
  if (words(sub.response) < (sub.skill === "writing" ? 20 : 8)) throw new AiError(sub.skill === "writing" ? "Bài viết quá ngắn để đánh giá (cần ít nhất 20 từ)." : "Bản chép lời quá ngắn để đánh giá.", 400);
  const attempt = db.attempts.find((a) => a.id === sub.attemptId);

  const key = cacheKey(sub.contentId, sub.response, sub.chosenOption ?? "");
  const cachedId = db.settings.aiCache ? db.aiCache[key] : undefined;
  let ev: Evaluation;
  let cached = false;
  if (cachedId && db.evaluations[cachedId]) {
    ev = db.evaluations[cachedId];
    cached = true;
  } else {
    const profile = weaknessProfileText(db);
    let raw: RawEvaluation;
    try {
      raw = content.kind === "writing"
        ? await evaluateWriting({ prompt: content, response: sub.response, chosenOption: sub.chosenOption, wordCount: words(sub.response), minutesUsed: Math.round(sub.durationSec / 60), profile })
        : await evaluateSpeaking({ prompt: content as SpeakingPrompt, transcript: sub.response, durationSec: sub.durationSec, transcriptSource: sub.transcriptSource ?? "typed", profile, chosenOption: sub.chosenOption });
    } catch (e) {
      sub.status = "failed";
      sub.lastError = e instanceof Error ? e.message : String(e);
      await save();
      throw e;
    }
    const lo = Math.max(1, Math.min(12, raw.bandLow));
    const hi = Math.max(lo, Math.min(12, raw.bandHigh));
    ev = {
      id: uid("ev"), skill: sub.skill, taskType: content.taskType, contentId: content.id, response: sub.response,
      meta: { wordCount: words(sub.response), durationSec: sub.durationSec, audioFile: sub.audioFile, transcriptSource: sub.transcriptSource },
      bandLow: lo, bandHigh: hi, dimensions: raw.dimensions, strengths: raw.strengths, weaknesses: raw.weaknesses.slice(0, 3),
      corrections: raw.corrections, improvedVersion: raw.improvedVersion, improvementNotesVi: raw.improvementNotesVi,
      reusableExpressions: raw.reusableExpressions, followUpExercise: raw.followUpExercise,
      audioCaveat: sub.skill === "speaking"
        ? "Nhận xét dựa trên bản chép lời (speech-to-text). Phát âm, ngữ điệu và độ trôi chảy trong âm thanh KHÔNG được AI đánh giá — hãy tự nghe lại bản ghi âm."
        : null,
      createdAt: now(),
    };
    db.evaluations[ev.id] = ev;
    db.aiCache[key] = ev.id;
    for (const w of ev.weaknesses) {
      const rc = repeatCount(db, sub.skill, w.category);
      const fix = ev.corrections[0];
      db.mistakes.push({
        id: uid("m"), skill: sub.skill, taskType: content.taskType, questionId: ev.id, contentId: content.id, category: w.category, trap: null,
        difficulty: content.difficulty, question: content.title, learnerResponse: fix ? fix.original : sub.response.slice(0, 200),
        correctAnswer: fix ? fix.corrected : ev.improvedVersion.slice(0, 300), explanation: w.descriptionVi,
        vocabulary: raw.vocabulary.map((v) => v.term).slice(0, 4), priority: mistakePriority(db, sub.skill, rc),
        repeatCount: rc, srs: newSrs(), createdAt: now(), lastSeenAt: now(), resolved: false,
      });
    }
    for (const seed of raw.vocabulary) upsertVocab(db, seed, `${sub.skill}-feedback`);
  }
  sub.status = "evaluated";
  sub.evaluationId = ev.id;
  sub.lastError = null;
  if (attempt) {
    attempt.estimatedBand = [ev.bandLow, ev.bandHigh];
    attempt.evaluationId = ev.id;
    if (attempt.mode !== "exam") adaptDifficulty(db, attempt);
  }
  if (sub.mockExamId) {
    const m = db.mockExams.find((x) => x.id === sub.mockExamId);
    if (m) computeMockResults(db, m);
  }
  await save();
  return { evaluation: ev, cached };
}

/** Plan blocks point at library content; flag skills that currently have nothing playable. */
function annotatePlan<T extends { blocks: { skill: string; title: string; detail: string; route: string }[] }>(db: Db, plan: T): T {
  const playable = (skill: Skill) => candidates(db, { skill, mode: "learn" }).some((r) => r.audio !== "pending") || candidates(db, { skill, mode: "drill" }).some((r) => r.audio !== "pending");
  const ok = Object.fromEntries(SKILLS.map((k) => [k, playable(k)])) as Record<Skill, boolean>;
  for (const b of plan.blocks) {
    if (b.skill in ok && !ok[b.skill as Skill]) {
      b.detail = b.skill === "listening"
        ? "⚠︎ Chưa có bài Listening nào có audio — tạo audio ở trang Quản trị (một lần), hoặc bật giọng đọc trình duyệt trong Cài đặt."
        : "⚠︎ Thư viện chưa có bài phù hợp cho kỹ năng này.";
      if (b.skill === "listening") b.route = "/admin";
    }
  }
  return plan;
}

// ---------------- routes: core ----------------

app.get("/api/status", (_req, res) => {
  const db = load();
  const lib = library();
  const todayUsage = db.aiUsage.filter((u) => u.at.slice(0, 10) === new Date().toISOString().slice(0, 10));
  res.json({
    today: today(),
    ai: {
      configured: aiConfigured(), model: MODEL, ttsModel: TTS_MODEL, ...availability,
      rateLimited: Boolean(availability.rateLimitedUntil && Date.now() < Date.parse(availability.rateLimitedUntil)),
      callsToday: todayUsage.length, tokensToday: todayUsage.reduce((n, u) => n + u.totalTokens, 0),
    },
    aiConfigured: aiConfigured(),
    model: MODEL,
    library: { items: lib.items.size, vocab: lib.vocab.length, mocks: lib.mocks.filter((m) => m.valid).length, errors: lib.issues.filter((i) => i.severity === "error").length },
  });
});

app.get("/api/dashboard", h((req, res) => {
  const minutes = Number(req.query.minutes) || undefined;
  const db = load();
  const d = dashboard(db, minutes);
  annotatePlan(db, d.plan);
  res.json(d);
}));

app.get("/api/plan", h((req, res) => {
  const db = load();
  res.json(annotatePlan(db, buildPlan(db, Number(req.query.minutes) || db.settings.dailyMinutes)));
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
  const db = load();
  const c = getContent(db, String(req.params.id));
  if (!c) throw new AiError("Không tìm thấy nội dung.", 404);
  res.json(publicContent(c, modeOf(req.query.mode)));
}));

app.get("/api/attempts/:id", h((req, res) => {
  const db = load();
  const a = db.attempts.find((x) => x.id === req.params.id);
  if (!a) throw new AiError("Không tìm thấy lượt làm bài.", 404);
  const c = getContent(db, a.contentId);
  res.json({ attempt: a, content: c ? publicContent(c, "learn") : null });
}));

app.get("/api/history", h((req, res) => {
  const db = load();
  const skill = String(req.query.skill ?? "");
  const rows = db.attempts.filter((a) => !skill || a.skill === skill).slice(-50).reverse().map((a) => ({
    ...a, title: getContent(db, a.contentId)?.title ?? "", items: undefined,
    submissionId: db.submissions.find((s) => s.attemptId === a.id)?.id ?? null,
  }));
  res.json(rows);
}));

// ---------------- routes: library & selection (no AI) ----------------

app.get("/api/library/:skill", h((req, res) => {
  const db = load();
  const skill = String(req.params.skill) as Skill;
  if (!SKILLS.includes(skill)) throw new AiError("Kỹ năng không hợp lệ.", 400);
  const q = req.query as Record<string, string | undefined>;
  const rows = candidates(db, {
    skill, mode: modeOf(q.mode), taskType: q.taskType || undefined, topic: q.topic || undefined,
    difficulty: q.difficulty ? Number(q.difficulty) : undefined, status: (q.status as "new" | "done" | "any") || "any", focus: q.focus || undefined,
  });
  res.json({ rows, topics: TOPIC_LABEL });
}));

app.post("/api/practice/next", h((req, res) => {
  const db = load();
  const b = req.body as { skill: Skill; mode?: Mode; taskType?: string; focus?: string; topic?: string; difficulty?: number; status?: "new" | "done" | "any" };
  if (!SKILLS.includes(b.skill)) throw new AiError("Kỹ năng không hợp lệ.", 400);
  const mode = modeOf(b.mode);
  const sel = selectNext(db, { skill: b.skill, mode, taskType: b.taskType || undefined, focus: b.focus || undefined, topic: b.topic || undefined, difficulty: b.difficulty || undefined, status: b.status });
  if (!sel.ok) return res.status(404).json({ error: sel.message, noContent: true });
  res.json({ item: publicContent(sel.item as ContentItem, mode), reason: sel.reason, repeated: sel.repeated, browserVoice: sel.browserVoice });
}));

app.get("/api/audio-assets/:file", (req, res) => {
  const file = path.basename(String(req.params.file));
  const full = path.join(AUDIO_ASSETS_DIR, file);
  if (!file.endsWith(".wav") || !fs.existsSync(full)) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable"); // file names contain the script hash
  res.sendFile(full);
});

// ---------------- routes: attempts & submissions ----------------

app.post("/api/attempts/objective", h(async (req, res) => {
  const db = load();
  const mode = modeOf(req.body.mode);
  const { attempt, created, added } = processObjective(db, { ...req.body, mode });
  await save();
  if (mode === "exam") return res.json({ attemptId: attempt.id, recorded: true });
  const c = getContent(db, attempt.contentId)!;
  res.json({ attempt, content: publicContent(c, "learn"), mistakes: created, vocabAdded: added, report: weaknessReport(attempt), newDifficulty: db.settings.difficulty[attempt.taskType] });
}));

/** Saves a writing/speaking response with NO AI call; returns immediately. */
app.post("/api/submissions", h(async (req, res) => {
  const db = load();
  const b = req.body as { skill: "writing" | "speaking"; contentId: string; response: string; durationSec: number; transcriptSource?: "speech-to-text" | "typed"; audioFile?: string | null; chosenOption?: string | null; mode?: Mode };
  if (b.skill !== "writing" && b.skill !== "speaking") throw new AiError("Kỹ năng không hợp lệ.", 400);
  if (!b.response?.trim()) throw new AiError("Bài làm trống.", 400);
  const sub = createSubmission(db, {
    skill: b.skill, contentId: b.contentId, response: b.response, durationSec: Number(b.durationSec) || 0,
    transcriptSource: b.skill === "speaking" ? b.transcriptSource ?? "typed" : null, audioFile: b.audioFile ?? null,
    chosenOption: b.chosenOption ?? null, mode: modeOf(b.mode), mockExamId: null,
  });
  await save();
  res.json({ submission: sub, aiAvailable: aiConfigured() });
}));

app.get("/api/submissions", h((req, res) => {
  const db = load();
  const status = String(req.query.status ?? "");
  res.json(db.submissions.filter((s) => !status || s.status === status).slice(-100).reverse().map((s) => ({ ...s, title: getContent(db, s.contentId)?.title ?? "" })));
}));

/** Explicit learner request: evaluate with Gemini (or reuse a cached evaluation). */
app.post("/api/submissions/:id/evaluate", h(async (req, res) => {
  const db = load();
  const sub = db.submissions.find((s) => s.id === req.params.id);
  if (!sub) throw new AiError("Không tìm thấy bài nộp.", 404);
  const { evaluation, cached } = await evaluateSubmission(db, sub);
  const content = getContent(db, sub.contentId);
  res.json({ evaluation, cached, submission: sub, newDifficulty: content ? db.settings.difficulty[content.taskType] : undefined });
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
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
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
    const c = getContent(db, m.contentId);
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

// ---------------- routes: vocabulary (works without AI) ----------------

app.get("/api/vocab", (_req, res) => {
  const db = load();
  res.json(db.vocab.map((v) => ({ ...v, due: isDue(v.srs) })));
});

/** Browse the curated vocabulary library. */
app.get("/api/vocab/library", h((req, res) => {
  const db = load();
  const q = req.query as Record<string, string | undefined>;
  const inNotebook = new Set(db.vocab.map((v) => v.term.toLowerCase()));
  const search = (q.q ?? "").toLowerCase();
  const rows = library().vocab
    .filter((e) => (!q.topic || e.topic === q.topic) && (!q.difficulty || e.difficulty === Number(q.difficulty)) && (!q.task || e.tasks.includes(q.task)))
    .filter((e) => !search || e.term.toLowerCase().includes(search) || e.vi.toLowerCase().includes(search))
    .map((e) => ({ ...e, inNotebook: inNotebook.has(e.term.toLowerCase()) }));
  res.json({ rows, total: library().vocab.length, topics: TOPIC_LABEL });
}));

/** Add one word: from the library when possible (no AI); AI lookup only when explicitly requested. */
app.post("/api/vocab", h(async (req, res) => {
  const db = load();
  const { term, context, source, useAi } = req.body as { term: string; context?: string; source?: string; useAi?: boolean };
  if (!term?.trim()) throw new AiError("Thiếu từ.", 400);
  const t = term.trim();
  const existing = db.vocab.find((v) => v.term.toLowerCase() === t.toLowerCase());
  if (existing) return res.json({ item: existing, from: "notebook" });
  const bank = bankIndex().get(t.toLowerCase());
  if (bank) {
    const item = fromBank(bank, source ?? "library");
    db.vocab.push(item);
    await save();
    return res.json({ item, from: "library" });
  }
  if (!useAi) {
    // Saved without AI; the learner can request an AI lookup later.
    const item: VocabItem = {
      id: uid("v"), term: t, vi: "", definition: "", example: context?.slice(0, 300) ?? "", collocations: [], synonyms: [], celpipUsage: "",
      source: source ?? "manual", enriched: false, srs: newSrs(), reviews: 0, correctReviews: 0, createdAt: now(),
    };
    db.vocab.push(item);
    await save();
    return res.json({ item, from: "manual" });
  }
  const { items } = await enrichVocab([{ term: t, context: context ?? "" }]);
  const e = items[0];
  const item: VocabItem = {
    id: uid("v"), term: t, vi: e.vi, definition: e.definition, example: e.example, collocations: e.collocations,
    synonyms: e.synonyms, celpipUsage: e.celpipUsage, source: source ?? "manual", enriched: true, srs: newSrs(),
    reviews: 0, correctReviews: 0, createdAt: now(),
  };
  db.vocab.push(item);
  await save();
  res.json({ item, from: "ai" });
}));

/** Add several library entries at once (e.g. a topic pack). */
app.post("/api/vocab/pack", h(async (req, res) => {
  const db = load();
  const ids = new Set((req.body.ids as string[]) ?? []);
  const have = new Set(db.vocab.map((v) => v.term.toLowerCase()));
  let added = 0;
  for (const e of library().vocab) {
    if (!ids.has(e.id) || have.has(e.term.toLowerCase())) continue;
    db.vocab.push(fromBank(e, `library:${e.topic}`));
    added++;
  }
  await save();
  res.json({ added });
}));

/** Fill in missing details: library first (no AI); Gemini only when `useAi` is set. */
app.post("/api/vocab/enrich", h(async (req, res) => {
  const db = load();
  const bank = bankIndex();
  let fromLibrary = 0;
  for (const v of db.vocab.filter((x) => !x.enriched)) {
    const e = bank.get(v.term.toLowerCase());
    if (!e) continue;
    Object.assign(v, { ...fromBank(e, v.source), id: v.id, srs: v.srs, reviews: v.reviews, correctReviews: v.correctReviews, createdAt: v.createdAt });
    fromLibrary++;
  }
  let fromAi = 0;
  const pending = db.vocab.filter((v) => !v.enriched).slice(0, 20);
  if (req.body?.useAi && pending.length) {
    const { items } = await enrichVocab(pending.map((v) => ({ term: v.term, context: v.example })));
    pending.forEach((v, i) => {
      const e = items[i];
      if (!e) return;
      Object.assign(v, { vi: e.vi || v.vi, definition: e.definition || v.definition, example: e.example || v.example, collocations: e.collocations, synonyms: e.synonyms, celpipUsage: e.celpipUsage, enriched: true });
      fromAi++;
    });
  }
  await save();
  res.json({ fromLibrary, fromAi, stillPending: db.vocab.filter((v) => !v.enriched).length });
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

// ---------------- routes: mock exam (prebuilt packages, no generation) ----------------

function computeMockResults(db: Db, m: MockExam) {
  const results: NonNullable<MockExam["results"]> = {};
  for (const skill of ["listening", "reading"] as const) {
    const atts = db.attempts.filter((a) => a.mockExamId === m.id && a.skill === skill);
    const correct = atts.reduce((n, a) => n + a.correct, 0);
    const total = atts.reduce((n, a) => n + a.total, 0);
    const acc = total ? correct / total : 0;
    // Unofficial heuristic on level-8 material — not the official raw-score conversion.
    const estimate = total ? 8 + (acc >= 0.85 ? 1 : acc >= 0.75 ? 0 : acc >= 0.6 ? -1 : acc >= 0.45 ? -2 : -3) : null;
    results[skill] = { correct, total, estimate };
  }
  for (const skill of ["writing", "speaking"] as const) {
    const subs = db.submissions.filter((s) => s.mockExamId === m.id && s.skill === skill);
    const bands = subs.map((s) => (s.evaluationId ? db.evaluations[s.evaluationId] : null)).filter((e): e is Evaluation => Boolean(e)).map((e) => (e.bandLow + e.bandHigh) / 2);
    const empty = subs.filter((s) => words(s.response) < 8).length; // no real response
    const all = [...bands, ...Array(empty).fill(3)];
    const pending = subs.filter((s) => s.status !== "evaluated" && words(s.response) >= 8).length;
    results[skill] = { estimate: all.length && !pending ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 2) / 2 : null, pending };
  }
  m.results = results;
}

app.get("/api/mock/packages", h((_req, res) => {
  const db = load();
  res.json(mockPackages(db).map((p) => ({ id: p.pkg.id, title: p.pkg.title, valid: p.valid, available: p.available, problems: p.problems, timesTaken: p.timesTaken, browserVoice: p.browserVoice })));
}));

app.get("/api/mock", (_req, res) => res.json([...load().mockExams].reverse()));

app.get("/api/mock/:id", h((req, res) => {
  const m = load().mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  res.json(m);
}));

/** Starts a mock from a validated, prebuilt package — instant, no AI. */
app.post("/api/mock", h(async (req, res) => {
  const db = load();
  const pkgId = String(req.body?.packageId ?? "");
  const status = mockPackages(db).find((p) => p.pkg.id === pkgId);
  if (!status) throw new AiError("Không tìm thấy gói đề thi thử.", 404);
  if (!status.available) throw new AiError(`Gói đề chưa sẵn sàng: ${status.problems.join(" ")}`, 400);
  const mock: MockExam = {
    id: uid("mk"), packageId: pkgId, createdAt: now(), status: "ready", progress: { done: 20, total: 20, error: null },
    listening: [...status.pkg.listening], reading: [...status.pkg.reading], writing: [...status.pkg.writing], speaking: [...status.pkg.speaking],
    attemptIds: [], submissions: [], results: null, finishedAt: null,
  };
  db.mockExams.push(mock);
  await save();
  res.json(mock);
}));

app.get("/api/mock/:id/report", h((req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  const attempts = db.attempts.filter((a) => a.mockExamId === m.id).map((a) => ({
    id: a.id, skill: a.skill, taskType: a.taskType, correct: a.correct, total: a.total, estimatedBand: a.estimatedBand,
    evaluationId: a.evaluationId, title: getContent(db, a.contentId)?.title ?? "",
    submission: db.submissions.find((s) => s.attemptId === a.id) ?? null,
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
  if (!m || (m.status !== "ready" && m.status !== "in_progress")) throw new AiError("Bài thi chưa sẵn sàng.", 400);
  m.status = "in_progress";
  await save();
  res.json(m);
}));

app.post("/api/mock/:id/objective", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  // Idempotent per part so a resumed exam can't double-count.
  if (db.attempts.some((a) => a.mockExamId === m.id && a.contentId === req.body.contentId)) return res.json({ recorded: true });
  const { attempt } = processObjective(db, { ...req.body, mode: "exam", mockExamId: m.id });
  m.attemptIds.push(attempt.id);
  await save();
  res.json({ recorded: true });
}));

app.post("/api/mock/:id/submission", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  if (db.submissions.some((s) => s.mockExamId === m.id && s.contentId === req.body.contentId)) return res.json({ recorded: true });
  const b = req.body as { skill: "writing" | "speaking"; contentId: string; response: string; durationSec: number; transcriptSource: Submission["transcriptSource"]; audioFile: string | null; chosenOption: string | null };
  const sub = createSubmission(db, { ...b, response: b.response ?? "", mode: "exam", mockExamId: m.id });
  m.attemptIds.push(sub.attemptId);
  await save();
  res.json({ recorded: true });
}));

/** Finishing never waits on AI: objective parts are scored locally; writing/speaking are evaluated when AI is available. */
app.post("/api/mock/:id/finish", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  computeMockResults(db, m);
  m.status = "done";
  m.finishedAt = now();
  await save();
  res.json(m);
  if (aiConfigured() && req.body?.evaluate !== false) void evaluateMockSubmissions(db, m);
}));

app.post("/api/mock/:id/evaluate", h(async (req, res) => {
  const db = load();
  const m = db.mockExams.find((x) => x.id === req.params.id);
  if (!m) throw new AiError("Không tìm thấy bài thi thử.", 404);
  const out = await evaluateMockSubmissions(db, m);
  res.json(out);
}));

async function evaluateMockSubmissions(db: Db, m: MockExam) {
  let ok = 0;
  let failed = 0;
  for (const s of db.submissions.filter((x) => x.mockExamId === m.id && x.status !== "evaluated" && words(x.response) >= 8)) {
    try { await evaluateSubmission(db, s); ok++; } catch (e) {
      failed++;
      if (e instanceof AiError && [401, 429, 503].includes(e.status)) break;
    }
  }
  computeMockResults(db, m);
  await save();
  return { evaluated: ok, failed };
}

// ---------------- routes: tutor (AI) ----------------

app.post("/api/tutor", h(async (req, res) => {
  const db = load();
  const { context, messages } = req.body as { context: unknown; messages: { role: "user" | "assistant"; content: string }[] };
  if (!messages?.length || messages[0].role !== "user") throw new AiError("Tin nhắn không hợp lệ.", 400);
  const ctx = `<context>\nCurrent exercise:\n${JSON.stringify(context ?? { page: "general" }, null, 1)}\n\nWeakness profile:\n${weaknessProfileText(db)}\n</context>\n\n`;
  const msgs = messages.map((m, i) => ({ role: m.role, content: i === 0 ? ctx + m.content : m.content }));
  await streamChat(res, TUTOR_SYSTEM, msgs);
}));

// ---------------- routes: AI usage ----------------

app.get("/api/ai/usage", (_req, res) => {
  const db = load();
  const byDay = new Map<string, { day: string; calls: number; failed: number; cached: number; tokens: number }>();
  const byKind = new Map<string, { kind: string; calls: number; failed: number; tokens: number }>();
  for (const u of db.aiUsage) {
    const d = u.at.slice(0, 10);
    const r = byDay.get(d) ?? { day: d, calls: 0, failed: 0, cached: 0, tokens: 0 };
    r.calls++; if (!u.ok) r.failed++; if (u.cached) r.cached++; r.tokens += u.totalTokens;
    byDay.set(d, r);
    const kind = u.kind.split(":")[0];
    const k = byKind.get(kind) ?? { kind, calls: 0, failed: 0, tokens: 0 };
    k.calls++; if (!u.ok) k.failed++; k.tokens += u.totalTokens;
    byKind.set(kind, k);
  }
  res.json({
    availability: { configured: aiConfigured(), model: MODEL, ttsModel: TTS_MODEL, ...availability },
    byDay: [...byDay.values()].slice(-30), byKind: [...byKind.values()], recent: db.aiUsage.slice(-25).reverse(),
    cacheEntries: Object.keys(db.aiCache).length, pendingSubmissions: db.submissions.filter((s) => s.status !== "evaluated").length,
  });
});

// ---------------- routes: admin (content library, audio, generation) ----------------

app.get("/api/admin/library", h((_req, res) => {
  const lib = library();
  const db = load();
  const counts: Record<string, Record<string, { active: number; inactive: number }>> = {};
  let audioReady = 0, audioPending = 0;
  const listening: { id: string; title: string; ready: boolean; chunks: number; durationSec: number }[] = [];
  for (const { item, active } of lib.all.values()) {
    const st = (item as { setType?: string }).setType ?? "?";
    const r = ((counts[item.taskType] ??= {})[st] ??= { active: 0, inactive: 0 });
    if (active) r.active++; else r.inactive++;
    if (item.kind === "listening" && active) {
      const s = audioStatus(item as ListeningSet);
      if (s.ready) audioReady++; else audioPending++;
      listening.push({ id: item.id, title: item.title, ready: s.ready, chunks: s.chunks.length, durationSec: s.chunks.reduce((n, c) => n + (c.durationSec ?? 0), 0) });
    }
  }
  const active = [...lib.items.values()];
  const totals = {
    reading: active.filter((i) => i.kind === "reading").length,
    listening: active.filter((i) => i.kind === "listening").length,
    writing: active.filter((i) => i.kind === "writing").length,
    speaking: active.filter((i) => i.kind === "speaking").length,
    vocabulary: lib.vocab.length,
    mocks: lib.mocks.filter((m) => m.valid).length,
  };
  res.json({
    counts, totals, targets: { reading: 200, listening: 150, writing: 100, speaking: 160, vocabulary: 2000 },
    completeSets: { reading: active.filter((i) => i.kind === "reading" && (i as { setType?: string }).setType !== "drill").length, listening: active.filter((i) => i.kind === "listening" && (i as { setType?: string }).setType !== "drill").length },
    audioReady, audioPending, listening, issues: lib.issues, loadedAt: lib.loadedAt,
    packages: mockPackages(db).map((p) => ({ id: p.pkg.id, title: p.pkg.title, valid: p.valid, available: p.available, problems: p.problems })),
  });
}));

app.post("/api/admin/library/reload", h((_req, res) => {
  const lib = reloadLibrary();
  res.json({ items: lib.items.size, issues: lib.issues.length });
}));

app.get("/api/admin/audio", (_req, res) => res.json(audioJob));

app.post("/api/admin/audio/generate", h((req, res) => {
  if (!aiConfigured()) throw new AiError("Cần GEMINI_API_KEY để tạo audio.", 503);
  const ids = (req.body?.setIds as string[] | undefined) ?? null;
  const sets = [...library().items.values()].filter((i): i is ListeningSet => i.kind === "listening" && (!ids || ids.includes(i.id)));
  void generateAudioBatch(sets, { limit: Number(req.body?.limit) || undefined, log: (s) => console.log(s) }).catch((e) => console.error(e));
  res.json({ started: true });
}));

app.post("/api/admin/audio/stop", (_req, res) => { stopAudioJob(); res.json({ ok: true }); });

app.get("/api/admin/jobs", (_req, res) => res.json(listJobs()));

app.post("/api/admin/jobs", h((req, res) => {
  if (!aiConfigured()) throw new AiError("Cần GEMINI_API_KEY để sinh nội dung.", 503);
  const db = load();
  const b = req.body as { skill: JobSkill; taskType?: string; setType?: string; count: number; focus?: string; topic?: string; difficulty?: number; aiReview?: boolean };
  const job = createJob({ ...b, count: Number(b.count) || 1, effort: db.settings.effort });
  void runJob(job.id, { log: (s) => console.log(s), difficultyFor: (t) => db.settings.difficulty[t] ?? 7 }).catch((e) => console.error(e));
  res.json(job);
}));

app.post("/api/admin/jobs/:id/run", h((req, res) => {
  const db = load();
  const job = getJob(String(req.params.id));
  void runJob(job.id, { log: (s) => console.log(s), difficultyFor: (t) => db.settings.difficulty[t] ?? 7 }).catch((e) => console.error(e));
  res.json({ resumed: true });
}));

app.get("/api/admin/jobs/:id/items/:itemId", h((req, res) => {
  const data = readDraft(String(req.params.id), String(req.params.itemId));
  if (!data) throw new AiError("Không tìm thấy bản nháp.", 404);
  res.json(data);
}));

app.post("/api/admin/jobs/:id/items/:itemId/decision", h((req, res) => {
  res.json(decide(String(req.params.id), String(req.params.itemId), req.body.decision, req.body.notes ?? ""));
}));

app.post("/api/admin/import", h((req, res) => {
  res.json(importApproved({ jobId: req.body?.jobId || undefined, target: "library" }));
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
  else if (status >= 500 && status !== 503) console.error(`[${status}] ${message}`);
  if (!res.headersSent) res.status(status).json({ error: message });
});

// Load (and, on first run after the refactor, migrate) learner data before serving requests.
load();

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => {
  const lib = library();
  console.log(`CELPIP 8 Coach API on http://localhost:${port}`);
  console.log(`  Library: ${lib.items.size} active items, ${lib.vocab.length} vocabulary, ${lib.mocks.filter((m) => m.valid).length} valid mock packages, ${lib.issues.filter((i) => i.severity === "error").length} validation errors`);
  console.log(`  AI: ${aiConfigured() ? `configured (${MODEL}, TTS ${TTS_MODEL})` : "not configured — practice still works; evaluation/tutor/generation need GEMINI_API_KEY"}`);
});

