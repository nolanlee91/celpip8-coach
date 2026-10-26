// Learn Mode API. Everything here is local (no AI): lesson content comes from the curriculum
// library, grading/mastery/review from server/learn.ts, recommendations from server/coach.ts.

import express, { type NextFunction, type Request, type Response } from "express";
import type { Db, ListeningSet, SpeakingPrompt, VocabItem, VocabSeed } from "../shared/types";
import type { Lesson, LessonResponse, LessonStep, Stimulus } from "../shared/curriculum";
import { CATEGORIES, SKILL_LABEL } from "../shared/spec";
import { load, save } from "./db";
import { AiError } from "./ai";
import { library } from "./library";
import { curriculum, reloadCurriculum } from "./lessons";
import { lessonAudioStatus, audioStatus, manifestEntry } from "./audio";
import {
  answerExercise, completeLesson, dueLessonReviews, inProgressPass, isCompleted, lessonStatus, prerequisitesMet,
  reviewExercises, setStep, startLesson, submitReview,
} from "./learn";
import { blockers, competencyProfile, improvements, masteryBySkill, recommendations, weeklyConsistency } from "./coach";

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);

export const curView = () => {
  const c = curriculum();
  return { lessons: c.lessons, order: c.order };
};

function getLesson(id: string): Lesson {
  const l = curriculum().lessons.get(id);
  if (!l) throw new AiError("Không tìm thấy bài học (hoặc bài chưa được duyệt).", 404);
  return l;
}

/** Resolves audio files and scene images so the client can render stimuli directly. */
export function publicLesson(l: Lesson) {
  const st = lessonAudioStatus(l);
  const lib = library();
  const stimuli: Record<string, Stimulus & { audioUrl?: string | null; segmentsTiming?: { start: number; end: number }[] | null; svg?: string | null; transcript?: { speaker: string; text: string }[] }> = {};
  for (const [key, s] of Object.entries(l.stimuli)) {
    const out: (typeof stimuli)[string] = { ...s };
    if (s.audio?.length) {
      const c = st.chunks.find((x) => x.key === key);
      out.audioUrl = c?.file ? `/api/audio-assets/${c.file}` : null;
      out.segmentsTiming = c?.file ? manifestEntry(c.file)?.segments ?? null : null;
      out.transcript = s.audio.map((x) => ({ speaker: x.speaker, text: x.text }));
    }
    if (s.audioRef) {
      const set = lib.items.get(s.audioRef.setId) as ListeningSet | undefined;
      const chunk = set?.chunks[s.audioRef.chunk];
      const ch = set ? audioStatus(set).chunks[s.audioRef.chunk] : undefined;
      out.audioUrl = ch?.file ? `/api/audio-assets/${ch.file}` : null;
      out.segmentsTiming = ch?.file ? manifestEntry(ch.file)?.segments ?? null : null;
      out.transcript = chunk?.segments.map((x) => ({ speaker: x.speaker, text: x.text })) ?? [];
      out.title ??= set ? `${set.title}${set.context ? ` — ${set.context}` : ""}` : undefined;
    }
    if (s.imageRef) out.svg = (lib.items.get(s.imageRef) as SpeakingPrompt | undefined)?.svg ?? null;
    stimuli[key] = out;
  }
  return { ...l, stimuli, audioReady: st.ready };
}

function lessonSummary(db: Db, l: Lesson) {
  const p = db.lessons[l.id];
  return {
    id: l.id, skill: l.skill, module: l.module, title: l.title, titleVi: l.titleVi, level: l.level, difficulty: l.difficulty,
    estimatedMinutes: l.estimatedMinutes, competencies: l.competencies, tasks: l.tasks, prerequisites: l.prerequisites,
    status: lessonStatus(db, l.id), mastery: p?.mastery ?? null, step: p?.step ?? null, inProgress: inProgressPass(p),
    completed: isCompleted(p), locked: !prerequisitesMet(db, l), nextReview: p?.srs && p.runs.length ? p.srs.due : null,
    runs: p?.runs.length ?? 0, lastOutcome: p?.runs.at(-1)?.outcome ?? null,
    audioReady: lessonAudioStatus(l).ready,
  };
}

export function learningSummary(db: Db) {
  const cur = curView();
  const recs = recommendations(db, cur);
  return {
    next: recs[0] ?? null,
    recommendations: recs.slice(0, 6),
    blockers: blockers(db, cur),
    improvements: improvements(db, cur),
    mastery: masteryBySkill(db, cur),
    dueReviews: dueLessonReviews(db).length,
  };
}

export function learnRouter(deps: { upsertVocab: (db: Db, seed: VocabSeed, source: string) => VocabItem | null }) {
  const r = express.Router();

  r.get("/api/curriculum", h((_req, res) => {
    const db = load();
    const c = curriculum();
    const cur = curView();
    const modules = [...c.map.modules].sort((a, b) => a.order - b.order).map((m) => ({
      ...m,
      lessons: m.lessons.map((id) => c.lessons.get(id)).filter((l): l is Lesson => !!l).map((l) => lessonSummary(db, l)),
      planned: m.lessons.length,
    }));
    res.json({
      modules,
      ...learningSummary(db),
      competencies: competencyProfile(db, cur).map((x) => ({ ...x, skillLabel: SKILL_LABEL[x.skill] })),
      consistency: weeklyConsistency(db),
      reviewSchedule: Object.values(db.lessons).filter((p) => p.srs && p.runs.length).map((p) => ({ lessonId: p.lessonId, title: c.lessons.get(p.lessonId)?.titleVi ?? p.lessonId, due: p.srs!.due, status: lessonStatus(db, p.lessonId) })).sort((a, b) => a.due.localeCompare(b.due)),
      counts: { planned: Object.values(c.order).reduce((n, x) => n + x.length, 0), active: c.lessons.size, files: c.all.size },
    });
  }));

  r.get("/api/lessons/:id", h((req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    const missing = l.prerequisites.filter((id) => !isCompleted(db.lessons[id])).map((id) => ({ id, title: curriculum().lessons.get(id)?.titleVi ?? id }));
    res.json({ lesson: publicLesson(l), progress: db.lessons[l.id] ?? null, status: lessonStatus(db, l.id), missingPrerequisites: missing, categories: CATEGORIES[l.skill] });
  }));

  r.post("/api/lessons/:id/start", h(async (req, res) => {
    const db = load();
    const p = startLesson(db, getLesson(String(req.params.id)), { restart: Boolean(req.body?.restart) });
    await save();
    res.json(p);
  }));

  r.post("/api/lessons/:id/step", h(async (req, res) => {
    const db = load();
    const p = setStep(db, getLesson(String(req.params.id)), req.body?.step as LessonStep, Number(req.body?.timeSec) || 0);
    await save();
    res.json(p);
  }));

  r.post("/api/lessons/:id/answer", h(async (req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    const { exerciseId, response, timeSec } = req.body as { exerciseId: string; response: LessonResponse; timeSec?: number };
    let g;
    try { g = answerExercise(db, l, exerciseId, response, Number(timeSec) || 0); } catch (e) { throw new AiError((e as Error).message, 400); }
    await save();
    res.json(g);
  }));

  r.post("/api/lessons/:id/complete", h(async (req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    const result = completeLesson(db, l);
    await save();
    res.json(result);
  }));

  r.get("/api/lessons/:id/review", h((req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    res.json({ exerciseIds: reviewExercises(l, db.lessons[l.id]).map((e) => e.id), due: db.lessons[l.id]?.srs?.due ?? null });
  }));

  r.post("/api/lessons/:id/review", h(async (req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    let out;
    try { out = submitReview(db, l, req.body?.responses ?? {}, Number(req.body?.timeSec) || 0); } catch (e) { throw new AiError((e as Error).message, 400); }
    await save();
    res.json(out);
  }));

  /** Adds the lesson's expressions to the vocabulary notebook (SM-2), without AI. */
  r.post("/api/lessons/:id/vocab", h(async (req, res) => {
    const db = load();
    const l = getLesson(String(req.params.id));
    const terms = new Set(((req.body?.terms as string[] | undefined) ?? l.vocabulary.map((v) => v.term)).map((t) => t.toLowerCase()));
    const added = l.vocabulary.filter((v) => terms.has(v.term.toLowerCase()))
      .map((v) => deps.upsertVocab(db, { term: v.term, vi: v.vi, definition: "", example: v.example }, `lesson:${l.id}`))
      .filter(Boolean);
    await save();
    res.json({ added: added.length, total: terms.size });
  }));

  r.get("/api/coach", h((_req, res) => res.json(learningSummary(load()))));

  r.post("/api/admin/curriculum/reload", h((_req, res) => {
    const c = reloadCurriculum();
    res.json({ lessons: c.lessons.size, issues: c.issues.length });
  }));

  r.get("/api/admin/curriculum", h((_req, res) => {
    const c = curriculum();
    res.json({
      lessons: [...c.all.values()].map(({ lesson, file, active }) => ({
        id: lesson.id, skill: lesson.skill, title: lesson.title, file, active, review: lesson.review,
        exercises: (lesson.guided?.length ?? 0) + (lesson.independent?.length ?? 0), audio: lessonAudioStatus(lesson),
      })),
      issues: c.issues,
      planned: Object.values(c.order).reduce((n, x) => n + x.length, 0),
    });
  }));

  return r;
}

/** Tutor context for a lesson: the material, the current exercise and the learner's actual answers. */
export function lessonTutorContext(db: Db, lessonId: string, exerciseId?: string | null): string | null {
  const l = curriculum().lessons.get(lessonId);
  if (!l) return null;
  const p = db.lessons[l.id];
  const ex = exerciseId ? [...l.guided, ...l.independent].find((e) => e.id === exerciseId) : null;
  const answer = ex && p?.answers[ex.id];
  const stim = ex?.stimulusId ? l.stimuli[ex.stimulusId] : undefined;
  const stimText = stim ? [stim.text, ...(stim.audio ?? []).map((s) => `${s.speaker}: ${s.text}`)].filter(Boolean).join("\n") : "";
  const lines = [
    `Lesson: ${l.title} (${l.titleVi}) — ${SKILL_LABEL[l.skill]}, ${l.level}, tasks ${l.tasks.join(", ")}`,
    `Objectives: ${l.objectives.join(" | ")}`,
    `Concept summary: ${l.concept.map((c) => `${c.heading}: ${c.body.slice(0, 400)}`).join("\n")}`,
  ];
  if (ex) {
    const sectionIsIndependent = l.independent.some((e) => e.id === ex.id);
    lines.push(`Current exercise (${sectionIsIndependent ? "independent practice" : "guided practice"}, type ${ex.type}): ${ex.prompt}`);
    if (stimText) lines.push(`Stimulus:\n${stimText.slice(0, 2500)}`);
    if (ex.type === "choice") lines.push(`Options: ${ex.options.map((o, i) => `${String.fromCharCode(65 + i)}) ${o.text}`).join(" | ")}`);
    if (answer) {
      lines.push(`Learner's answer: ${JSON.stringify(answer.response)} — ${answer.correct ? "correct" : "incorrect"}${answer.misconception ? ` (misconception: ${l.misconceptions[answer.misconception]?.label ?? answer.misconception})` : ""}`);
      const key = ex.type === "choice" ? ex.options[ex.answerIndex].text : ex.type === "text" ? ex.answers[0] : ex.type === "order" ? ex.items.join(" → ") : ex.modelAnswer;
      lines.push(`Correct answer: ${key}`, `Explanation: ${ex.explanationVi}`);
    } else {
      lines.push("The learner has NOT answered yet: do not reveal or confirm the answer. Give a hint that points to the lesson technique and ask a guiding question.");
      if (ex.hint) lines.push(`Built-in hint: ${ex.hint}`);
    }
  }
  const lastRun = p?.runs.at(-1);
  if (lastRun && Object.keys(lastRun.misconceptions).length) {
    lines.push(`Learner's misconceptions in this lesson's last mastery check (${Math.round(lastRun.score * 100)}%): ${Object.entries(lastRun.misconceptions).map(([k, n]) => `${l.misconceptions[k]?.label ?? k} ×${n}`).join(", ")}`);
  }
  return lines.join("\n");
}
