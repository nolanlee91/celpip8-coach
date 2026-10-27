import type {
  Attempt, CategoryStat, DailyPlan, Dashboard, Db, MistakeRecord, PlanBlock, SkillSummary, Srs,
} from "../shared/types";
import {
  CATEGORIES, LISTENING_PARTS, READING_PARTS, SKILLS, SKILL_LABEL, SPEAKING_TASKS, WRITING_TASKS,
  taskName, type Skill,
} from "../shared/spec";
import { addDays, today, dayOf } from "./db";

// ---------------- Spaced repetition (SM-2) ----------------

export function newSrs(): Srs {
  return { ease: 2.5, interval: 0, reps: 0, due: addDays(today(), 1), lapses: 0 };
}

/** quality: 0–5 (≥3 = recalled). */
export function reviewSrs(s: Srs, quality: number): Srs {
  const next = { ...s };
  if (quality < 3) {
    next.reps = 0;
    next.interval = 1;
    next.lapses += 1;
  } else {
    next.reps += 1;
    next.interval = next.reps === 1 ? 1 : next.reps === 2 ? 3 : Math.round(next.interval * next.ease);
  }
  next.ease = Math.max(1.3, next.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  next.due = addDays(today(), next.interval);
  return next;
}

export const isDue = (s: Srs) => s.due <= today();

// ---------------- Estimates (practice only, never official) ----------------

const roundHalf = (n: number) => Math.round(n * 2) / 2;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Objective-skill practice estimate. Heuristic: performance on a set of difficulty d
 * maps to roughly d when accuracy ≥ 75%, lower otherwise. Drills are excluded because
 * they deliberately over-sample weak question types.
 */
function objectiveEstimate(attempts: Attempt[]): number | null {
  const recent = attempts.filter((a) => a.mode !== "drill" && a.total > 0).slice(-6);
  if (recent.length === 0) return null;
  const perf = recent.map((a) => {
    const acc = a.correct / a.total;
    const adj = acc >= 0.85 ? 0.5 : acc >= 0.75 ? 0 : acc >= 0.6 ? -1 : acc >= 0.45 ? -2 : -3;
    return a.difficulty + adj;
  });
  return clamp(roundHalf(perf.reduce((s, x) => s + x, 0) / perf.length), 3, 12);
}

function productiveEstimate(attempts: Attempt[]): number | null {
  const recent = attempts.filter((a) => a.estimatedBand).slice(-5);
  if (recent.length === 0) return null;
  const mids = recent.map((a) => (a.estimatedBand![0] + a.estimatedBand![1]) / 2);
  return roundHalf(mids.reduce((s, x) => s + x, 0) / mids.length);
}

export function skillSummaries(db: Db): SkillSummary[] {
  const s = db.settings;
  return SKILLS.map((skill) => {
    const atts = db.attempts.filter((a) => a.skill === skill);
    const objective = skill === "reading" || skill === "listening";
    const estimate = objective ? objectiveEstimate(atts) : productiveEstimate(atts);
    const scored = atts.filter((a) => a.total > 0);
    const correct = scored.reduce((n, a) => n + a.correct, 0);
    const total = scored.reduce((n, a) => n + a.total, 0);
    const accOf = (list: Attempt[]) => {
      const t = list.reduce((n, a) => n + a.total, 0);
      return t ? list.reduce((n, a) => n + a.correct, 0) / t : null;
    };
    const last5 = accOf(scored.slice(-5));
    const prev5 = accOf(scored.slice(-10, -5));
    return {
      skill,
      official: s.officialScores[skill],
      target: s.targetLevel,
      estimate,
      estimateBasis: objective
        ? `Ước tính từ ${Math.min(6, atts.filter((a) => a.mode !== "drill").length)} bài gần nhất (độ khó × độ chính xác)`
        : `Trung bình band AI ước tính của ${Math.min(5, atts.filter((a) => a.estimatedBand).length)} bài gần nhất`,
      accuracy: objective && total ? correct / total : null,
      attempts: atts.length,
      recentTrend: objective && last5 !== null && prev5 !== null ? last5 - prev5 : null,
    };
  });
}

// ---------------- Weakness profile ----------------

export function categoryStats(db: Db, sinceDays = 60): CategoryStat[] {
  const since = addDays(today(), -sinceDays);
  const map = new Map<string, CategoryStat>();
  const bump = (skill: Skill, category: string, ok: boolean) => {
    const key = `${skill}:${category}`;
    const st = map.get(key) ?? { skill, category, correct: 0, total: 0, accuracy: 0 };
    st.total += 1;
    if (ok) st.correct += 1;
    map.set(key, st);
  };
  for (const a of db.attempts) {
    if (dayOf(a.finishedAt) < since) continue;
    if (a.skill === "reading" || a.skill === "listening") {
      for (const it of a.items) bump(a.skill, it.category, it.correct);
    } else if (a.evaluationId) {
      // Productive skills: each evaluation counts as a "pass" for every dimension
      // not flagged as a weakness, and a "miss" for each flagged one.
      const ev = db.evaluations[a.evaluationId];
      if (!ev) continue;
      const flagged = new Set(ev.weaknesses.map((w) => w.category));
      for (const cat of Object.keys(CATEGORIES[a.skill])) bump(a.skill, cat, !flagged.has(cat));
    }
  }
  return [...map.values()].map((st) => ({ ...st, accuracy: st.correct / st.total }));
}

/** Ranks weaknesses by expected benefit: low accuracy × how far the skill is from target. */
export function rankWeaknesses(db: Db, stats: CategoryStat[]): CategoryStat[] {
  const summaries = skillSummaries(db);
  const gap = (skill: Skill) => {
    const s = summaries.find((x) => x.skill === skill)!;
    return Math.max(0.5, s.target + 0.5 - (s.estimate ?? s.official));
  };
  return stats
    .filter((s) => s.total >= 3 && s.category !== "time_management")
    .map((s) => ({ s, score: (1 - s.accuracy) * gap(s.skill) * Math.min(1, s.total / 8 + 0.5) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.s);
}

export function weakestCategory(db: Db, skill: Skill): string | null {
  const ranked = rankWeaknesses(db, categoryStats(db)).filter((s) => s.skill === skill);
  return ranked[0]?.category ?? null;
}

export function weaknessProfileText(db: Db): string {
  const stats = categoryStats(db);
  const summaries = skillSummaries(db);
  const lines = summaries.map((s) => {
    const acc = s.accuracy !== null ? `, practice accuracy ${(s.accuracy * 100).toFixed(0)}%` : "";
    return `- ${SKILL_LABEL[s.skill]}: official ${s.official}, practice estimate ${s.estimate ?? "n/a"}${acc}`;
  });
  const weak = rankWeaknesses(db, stats).slice(0, 6).map(
    (c) => `- ${c.skill}/${c.category}: ${(c.accuracy * 100).toFixed(0)}% over ${c.total} items`,
  );
  const traps = trapCounts(db).slice(0, 3).map((t) => `- chose "${t.trap}" distractors ${t.count} times`);
  return [
    "Skill overview:", ...lines,
    "Weakest categories (by expected benefit):", ...(weak.length ? weak : ["- not enough data yet"]),
    "Most frequent distractor traps:", ...(traps.length ? traps : ["- not enough data yet"]),
  ].join("\n");
}

export function trapCounts(db: Db): { trap: string; count: number }[] {
  const m = new Map<string, number>();
  for (const a of db.attempts) for (const it of a.items) {
    if (!it.correct && it.chosenTrap && it.chosenTrap !== "none") m.set(it.chosenTrap, (m.get(it.chosenTrap) ?? 0) + 1);
  }
  return [...m.entries()].map(([trap, count]) => ({ trap, count })).sort((a, b) => b.count - a.count);
}

// ---------------- Adaptive difficulty ----------------

export function adaptDifficulty(db: Db, a: Attempt) {
  if (a.mode === "exam") return;
  const cur = db.settings.difficulty[a.taskType] ?? 7;
  let next = cur;
  if (a.total > 0) {
    const acc = a.correct / a.total;
    if (acc >= 0.85) next = cur + 1;
    else if (acc < 0.55) next = cur - 1;
  } else if (a.estimatedBand) {
    const mid = (a.estimatedBand[0] + a.estimatedBand[1]) / 2;
    if (mid >= cur) next = cur + 1;
    else if (mid < cur - 1.5) next = cur - 1;
  }
  db.settings.difficulty[a.taskType] = clamp(next, 5, 10);
}

// ---------------- Mistakes ----------------

export function mistakePriority(db: Db, skill: Skill, repeatCount: number): number {
  const s = skillSummaries(db).find((x) => x.skill === skill)!;
  const gap = s.target - (s.estimate ?? s.official);
  return clamp(2 + (repeatCount >= 3 ? 1 : 0) + (repeatCount >= 6 ? 1 : 0) + (gap >= 2 ? 1 : 0), 1, 5);
}

export function repeatCountFor(db: Db, skill: Skill, category: string): number {
  return db.mistakes.filter((m) => m.skill === skill && m.category === category).length + 1;
}

export function dueMistakes(db: Db): MistakeRecord[] {
  return db.mistakes
    .filter((m) => !m.resolved && isDue(m.srs))
    .sort((a, b) => b.priority - a.priority || a.srs.due.localeCompare(b.srs.due));
}

// ---------------- Study time ----------------

export function logStudy(db: Db, skill: Skill | "vocab" | "review", seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  const date = today();
  const entry = db.studyLog.find((e) => e.date === date && e.skill === skill);
  if (entry) entry.minutes += minutes;
  else db.studyLog.push({ date, skill, minutes });
}

function minutesSince(db: Db, date: string) {
  return db.studyLog.filter((e) => e.date >= date).reduce((n, e) => n + e.minutes, 0);
}

function streak(db: Db): number {
  const days = new Set(db.studyLog.filter((e) => e.minutes > 0).map((e) => e.date));
  let d = days.has(today()) ? today() : addDays(today(), -1);
  let n = 0;
  while (days.has(d)) {
    n += 1;
    d = addDays(d, -1);
  }
  return n;
}

// ---------------- Planner ----------------

export function currentWeek(db: Db): number {
  const start = new Date(db.settings.startDate + "T12:00:00").getTime();
  const now = new Date(today() + "T12:00:00").getTime();
  return Math.max(1, Math.floor((now - start) / 86400000 / 7) + 1);
}

export function phaseFor(week: number, totalWeeks: number) {
  // Phase boundaries scale with plan length (12 weeks → 2/4/4/2).
  const f = week / totalWeeks;
  if (f <= 2 / 12) return { number: 1, name: "Chẩn đoán & nền tảng", goal: "Làm đủ các dạng bài để xác định điểm yếu thật sự." };
  if (f <= 6 / 12) return { number: 2, name: "Sửa điểm yếu trọng tâm", goal: "Luyện drill đúng loại lỗi bạn hay mắc nhất." };
  if (f <= 10 / 12) return { number: 3, name: "Luyện chuẩn Level 8", goal: "Làm bài full part ở độ khó 8–9, giữ độ chính xác ≥ 75%." };
  return { number: 4, name: "Thi thử & hoàn thiện", goal: "Thi thử đủ 4 kỹ năng, ôn lỗi, giữ phong độ." };
}

export const PART_IDS: Record<Skill, string[]> = {
  reading: READING_PARTS.map((p) => p.id),
  listening: LISTENING_PARTS.map((p) => p.id),
  writing: WRITING_TASKS.map((t) => t.id),
  speaking: SPEAKING_TASKS.map((t) => t.id),
};

export function leastPractised(db: Db, skill: Skill, exclude: string[] = []): string {
  const ids = PART_IDS[skill].filter((id) => !exclude.includes(id));
  const counts = (ids.length ? ids : PART_IDS[skill]).map((id) => ({ id, n: db.attempts.filter((a) => a.taskType === id).length }));
  return counts.sort((a, b) => a.n - b.n)[0].id;
}

export function weakestTask(db: Db, skill: Skill, exclude: string[] = []): string {
  const ids = PART_IDS[skill].filter((id) => !exclude.includes(id));
  const rows = (ids.length ? ids : PART_IDS[skill]).map((id) => {
    const atts = db.attempts.filter((a) => a.taskType === id).slice(-5);
    if (atts.length === 0) return { id, score: -1 };
    if (skill === "reading" || skill === "listening") {
      const t = atts.reduce((n, a) => n + a.total, 0);
      return { id, score: t ? atts.reduce((n, a) => n + a.correct, 0) / t : 1 };
    }
    const bands = atts.filter((a) => a.estimatedBand).map((a) => (a.estimatedBand![0] + a.estimatedBand![1]) / 2);
    return { id, score: bands.length ? bands.reduce((s, x) => s + x, 0) / bands.length / 12 : 1 };
  });
  return rows.sort((a, b) => a.score - b.score)[0].id; // unpractised (-1) first
}

export function buildPlan(db: Db, minutes: number, date = today()): DailyPlan {
  const s = db.settings;
  const week = currentWeek(db);
  const phase = phaseFor(week, s.planWeeks);
  const dayIndex = Math.round(
    (new Date(date + "T12:00:00").getTime() - new Date(s.startDate + "T12:00:00").getTime()) / 86400000,
  );
  const blocks: PlanBlock[] = [];

  // Phase 4: two mock exams per week replace the regular session on those days.
  if (phase.number === 4 && (dayIndex % 7 === 2 || dayIndex % 7 === 5) && minutes >= 90) {
    blocks.push({
      id: "mock", skill: "review", title: "Thi thử đầy đủ (Mock Exam)",
      detail: "Listening → Reading → Writing → Speaking, đúng thời gian thi. Chuẩn bị đề trước ~3 phút.",
      minutes, route: "/mock",
    });
    return { date, week, phase, minutes, blocks, completed: db.planCompletions[date] ?? [] };
  }

  // 1) Spaced-repetition review first.
  const dueM = dueMistakes(db).length;
  const dueV = db.vocab.filter((v) => isDue(v.srs)).length;
  let reviewMin = 0;
  if (dueM + dueV > 0) {
    reviewMin = Math.min(Math.round(minutes * 0.15 / 5) * 5 || 5, Math.max(5, Math.ceil((dueM * 1.5 + dueV * 0.25) / 5) * 5));
    if (dueM) blocks.push({
      id: "review-mistakes", skill: "review", title: `Ôn ${dueM} lỗi đến hạn`,
      detail: "Làm lại câu đã sai — lặp lại ngắt quãng để không mắc lại.",
      minutes: dueV ? Math.max(5, reviewMin - 5) : reviewMin, route: "/mistakes?review=1",
    });
    if (dueV) blocks.push({
      id: "review-vocab", skill: "review", title: `Ôn ${dueV} từ vựng`,
      detail: "Flashcard + chọn nghĩa + nghe nhận diện.", minutes: dueM ? 5 : reviewMin, route: "/vocabulary?review=1",
    });
  }

  // 2) Weekly assessment on the last day of each week.
  const weeklyDay = dayIndex % 7 === 6 && !db.weekly.some((w) => w.week === week);
  let remaining = minutes - reviewMin;
  if (weeklyDay) {
    const wMin = Math.min(remaining, 40);
    blocks.push({
      id: "weekly", skill: "review", title: `Kiểm tra tuần ${week}`,
      detail: "1 part Reading + 1 part Listening + 1 task Speaking, sau đó hệ thống tự điều chỉnh kế hoạch.",
      minutes: wMin, route: "/planner?weekly=1",
    });
    remaining -= wMin;
  }

  // 3) Allocate remaining time by skill weights. Skills that would get < 10 min
  //    alternate days with double time instead of a token 5-minute block.
  const raw = SKILLS.map((skill, i) => {
    let m = (remaining * s.weights[skill]) / 100;
    if (m < 10) m = (dayIndex + i) % 2 === 0 ? m * 2 : 0;
    return { skill, m };
  });
  const rawTotal = raw.reduce((n, a) => n + a.m, 0) || 1;
  const alloc = raw.map(({ skill, m }) => ({ skill, min: Math.round((m * remaining) / rawTotal / 5) * 5 }));
  // Blocks under 10 minutes are too short to be useful; fold them into the main skill.
  for (const a of alloc) if (a.min > 0 && a.min < 10) a.min = 0;
  const diff = remaining - alloc.reduce((n, a) => n + a.min, 0);
  alloc.sort((a, b) => s.weights[b.skill] - s.weights[a.skill]);
  alloc[0].min += diff;

  for (const { skill, min } of alloc) {
    if (min <= 0) continue;
    blocks.push(...skillBlocks(db, skill, min, phase.number));
  }
  return { date, week, phase, minutes, blocks, completed: db.planCompletions[date] ?? [] };
}

function skillBlocks(db: Db, skill: Skill, min: number, phase: number): PlanBlock[] {
  const label = SKILL_LABEL[skill];
  const path = `/${skill}`;
  const weakCat = weakestCategory(db, skill);
  const catLabel = weakCat ? CATEGORIES[skill][weakCat] : null;
  const out: PlanBlock[] = [];

  if (skill === "reading" || skill === "listening") {
    const parts = skill === "reading" ? READING_PARTS : LISTENING_PARTS;
    let left = min;
    let k = 0;
    while (left >= 8) {
      const useDrill = (phase === 2 || (phase >= 3 && k === 1)) && weakCat;
      if (useDrill) {
        const m = Math.min(left, 15);
        out.push({
          id: `${skill}-drill-${k}`, skill, title: `${label} drill: ${catLabel}`,
          detail: `Bài ngắn chỉ tập trung vào lỗi "${catLabel}" — lỗi gây mất điểm nhiều nhất của bạn.`,
          minutes: m, route: `${path}?mode=drill&focus=${weakCat}`,
        });
        left -= m;
      } else {
        const used = out.map((b) => new URLSearchParams(b.route.split("?")[1]).get("task")).filter((x): x is string => !!x);
        const task = phase === 1 ? leastPractised(db, skill, used) : weakestTask(db, skill, used);
        const spec = parts.find((p) => p.id === task)!;
        const m = Math.min(left, spec.minutes + 6); // + review time
        out.push({
          id: `${skill}-part-${k}`, skill, title: `${label} Part ${spec.part}: ${spec.name}`,
          detail: phase === 1 ? "Bài chẩn đoán — làm nghiêm túc, bấm giờ." : `Độ khó ${db.settings.difficulty[task]}. Xem kỹ phần giải thích sau khi nộp.`,
          minutes: m, route: `${path}?task=${task}`,
        });
        left -= m;
      }
      k += 1;
      if (k > 4) break;
    }
    if (left > 0 && out.length) out[out.length - 1].minutes += left;
    if (!out.length) out.push({ id: `${skill}-mini`, skill, title: `${label}: bài ngắn`, detail: "Bài drill ngắn.", minutes: min, route: `${path}?mode=drill${weakCat ? `&focus=${weakCat}` : ""}` });
    return out;
  }

  if (skill === "speaking") {
    const n = Math.max(1, Math.floor(min / 6));
    const task = phase === 1 ? leastPractised(db, skill) : weakestTask(db, skill);
    out.push({
      id: "speaking", skill, title: `Speaking: ${n} task (bắt đầu với Task ${task.slice(1)})`,
      detail: `${taskName(task)} — ghi âm, xem nhận xét, rồi làm bài lặp lại ngắn.${catLabel ? ` Chú ý: ${catLabel}.` : ""}`,
      minutes: min, route: `${path}?task=${task}`,
    });
    return out;
  }

  const task = weakestTask(db, "writing");
  out.push({
    id: "writing", skill, title: `Writing: ${taskName(task)}`,
    detail: min >= 27 ? "Viết đủ thời gian thi, 150–200 từ, rồi đọc bản Level 8." : `Viết trong ${min} phút: tập trung bố cục + trả lời đủ các ý.`,
    minutes: min, route: `${path}?task=${task}`,
  });
  return out;
}

// ---------------- Weekly auto-adjustment ----------------

export function adjustedWeights(db: Db): Record<Skill, number> {
  const summaries = skillSummaries(db);
  const gaps = Object.fromEntries(summaries.map((s) => [s.skill, Math.max(0.25, s.target + 0.5 - (s.estimate ?? s.official))])) as Record<Skill, number>;
  const gapTotal = SKILLS.reduce((n, k) => n + gaps[k], 0);
  const raw = Object.fromEntries(SKILLS.map((k) => [k, 0.5 * db.settings.weights[k] + 0.5 * (100 * gaps[k]) / gapTotal])) as Record<Skill, number>;
  for (const k of SKILLS) raw[k] = Math.max(8, raw[k]);
  const total = SKILLS.reduce((n, k) => n + raw[k], 0);
  const out = Object.fromEntries(SKILLS.map((k) => [k, Math.round((raw[k] / total) * 100)])) as Record<Skill, number>;
  const fix = 100 - SKILLS.reduce((n, k) => n + out[k], 0);
  out.reading += fix;
  return out;
}

// ---------------- Dashboard ----------------

export function dashboard(db: Db, minutes?: number): Dashboard {
  const s = db.settings;
  const skills = skillSummaries(db);
  const stats = categoryStats(db);
  const ranked = rankWeaknesses(db, stats);
  const top = ranked[0] ?? null;
  const plan = buildPlan(db, minutes ?? s.dailyMinutes);

  let recommendation: string;
  if (top) {
    const accSkill = skills.find((x) => x.skill === top.skill)?.accuracy;
    recommendation =
      `Điểm yếu lớn nhất: ${SKILL_LABEL[top.skill]} — ${CATEGORIES[top.skill][top.category]} ` +
      `(${Math.round(top.accuracy * 100)}% trên ${top.total} lượt` +
      (accSkill != null ? `, trong khi độ chính xác chung ${Math.round(accSkill * 100)}%` : "") +
      `). Hãy làm 15 phút bài tập trọng tâm hôm nay.`;
    const trap = trapCounts(db)[0];
    if (trap && trap.count >= 3 && trap.trap === "word_match") {
      recommendation += " Bạn hay chọn đáp án lặp lại từ trong bài nhưng sai nghĩa — hãy so nghĩa, không so từ.";
    }
  } else {
    recommendation =
      "Chưa đủ dữ liệu luyện tập. Theo điểm chính thức, Reading (5) là kỹ năng cần ưu tiên nhất — hãy làm bài chẩn đoán Reading hôm nay.";
  }

  const weekStart = addDays(today(), -6);
  const thisWeek = db.attempts.filter((a) => dayOf(a.finishedAt) >= weekStart);
  const weeklyMin = s.dailyMinutes * 7;
  const weeklyGoals = [
    { label: "Bài Reading", done: thisWeek.filter((a) => a.skill === "reading").length, target: Math.max(2, Math.round((weeklyMin * s.weights.reading) / 100 / 14)) },
    { label: "Bài Listening", done: thisWeek.filter((a) => a.skill === "listening").length, target: Math.max(2, Math.round((weeklyMin * s.weights.listening) / 100 / 12)) },
    { label: "Task Speaking", done: thisWeek.filter((a) => a.skill === "speaking").length, target: Math.max(3, Math.round((weeklyMin * s.weights.speaking) / 100 / 6)) },
    { label: "Bài Writing", done: thisWeek.filter((a) => a.skill === "writing").length, target: Math.max(1, Math.round((weeklyMin * s.weights.writing) / 100 / 27)) },
    { label: "Phút ôn từ vựng & lỗi", done: db.studyLog.filter((e) => e.date >= weekStart && (e.skill === "vocab" || e.skill === "review")).reduce((n, e) => n + e.minutes, 0), target: Math.round(weeklyMin * 0.1) },
  ];

  const est = skills.map((k) => k.estimate ?? k.official);
  const percent = Math.round((est.reduce((n, e) => n + Math.min(1, e / s.targetLevel), 0) / est.length) * 100);
  const enoughData = skills.every((k) => k.attempts >= 3);
  const ready = enoughData && est.every((e) => e >= s.targetLevel - 0.5);
  const weakest = skills.reduce((a, b) => ((a.estimate ?? a.official) <= (b.estimate ?? b.official) ? a : b));
  const readiness = {
    percent,
    ready,
    message: !enoughData
      ? "Cần ít nhất 3 bài mỗi kỹ năng trước khi dự đoán mức sẵn sàng."
      : ready
        ? "Sẵn sàng làm một bài thi thử đầy đủ."
        : `Chưa sẵn sàng thi thử: ${SKILL_LABEL[weakest.skill]} đang ước tính ${weakest.estimate ?? weakest.official}.`,
  };

  const accuracyTrend: Dashboard["accuracyTrend"] = [];
  for (let w = 7; w >= 0; w--) {
    const from = addDays(today(), -7 * w - 6);
    const to = addDays(today(), -7 * w);
    const inWeek = db.attempts.filter((a) => {
      const d = dayOf(a.finishedAt);
      return d >= from && d <= to;
    });
    const acc = (skill: Skill) => {
      const l = inWeek.filter((a) => a.skill === skill && a.total > 0);
      const t = l.reduce((n, a) => n + a.total, 0);
      return t ? Math.round((l.reduce((n, a) => n + a.correct, 0) / t) * 100) : null;
    };
    accuracyTrend.push({ week: from.slice(5), listening: acc("listening"), reading: acc("reading") });
  }

  return {
    settings: s,
    skills,
    categoryStats: stats,
    topWeakness: top,
    recommendation,
    plan,
    streak: streak(db),
    minutesToday: minutesSince(db, today()),
    minutesWeek: minutesSince(db, weekStart),
    minutesTotal: db.studyLog.reduce((n, e) => n + e.minutes, 0),
    dueMistakes: dueMistakes(db).length,
    dueVocab: db.vocab.filter((v) => isDue(v.srs)).length,
    recentMistakes: [...db.mistakes].filter((m) => !m.resolved).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6),
    readiness,
    weeklyGoals,
    accuracyTrend,
  };
}

// ---------------- Analytics page ----------------

export function analytics(db: Db) {
  const objective = db.attempts.filter((a) => a.total > 0);
  const acc = (list: Attempt[]) => {
    const t = list.reduce((n, a) => n + a.total, 0);
    return t ? Math.round((list.reduce((n, a) => n + a.correct, 0) / t) * 100) : null;
  };

  const weekly: Record<string, number | string | null>[] = [];
  for (let w = 11; w >= 0; w--) {
    const from = addDays(today(), -7 * w - 6);
    const to = addDays(today(), -7 * w);
    const inW = db.attempts.filter((a) => dayOf(a.finishedAt) >= from && dayOf(a.finishedAt) <= to);
    const band = (skill: Skill) => {
      const b = inW.filter((a) => a.skill === skill && a.estimatedBand);
      return b.length ? Math.round((b.reduce((n, a) => n + (a.estimatedBand![0] + a.estimatedBand![1]) / 2, 0) / b.length) * 10) / 10 : null;
    };
    weekly.push({
      week: from.slice(5),
      reading: acc(inW.filter((a) => a.skill === "reading" && a.total > 0)),
      listening: acc(inW.filter((a) => a.skill === "listening" && a.total > 0)),
      writingBand: band("writing"),
      speakingBand: band("speaking"),
      minutes: db.studyLog.filter((e) => e.date >= from && e.date <= to).reduce((n, e) => n + e.minutes, 0),
    });
  }

  const byTask = [...READING_PARTS, ...LISTENING_PARTS].map((p) => {
    const l = objective.filter((a) => a.taskType === p.id);
    return { taskType: p.id, name: p.name, accuracy: acc(l), attempts: l.length };
  });

  const byDifficulty = [5, 6, 7, 8, 9, 10].map((d) => ({
    difficulty: d,
    reading: acc(objective.filter((a) => a.skill === "reading" && a.difficulty === d)),
    listening: acc(objective.filter((a) => a.skill === "listening" && a.difficulty === d)),
  }));

  const studyDaily = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(today(), i - 29);
    const row: Record<string, number | string> = { date: date.slice(5) };
    for (const k of [...SKILLS, "vocab", "review"]) {
      row[k] = db.studyLog.filter((e) => e.date === date && e.skill === k).reduce((n, e) => n + e.minutes, 0);
    }
    return row;
  });

  const reviews = db.vocab.reduce((n, v) => n + v.reviews, 0);
  const vocabStats = {
    total: db.vocab.length,
    mastered: db.vocab.filter((v) => v.srs.interval >= 21).length,
    learning: db.vocab.filter((v) => v.reviews > 0 && v.srs.interval < 21).length,
    fresh: db.vocab.filter((v) => v.reviews === 0).length,
    retention: reviews ? Math.round((db.vocab.reduce((n, v) => n + v.correctReviews, 0) / reviews) * 100) : null,
  };

  const recurring = new Map<string, { skill: Skill; category: string; count: number; unresolved: number }>();
  for (const m of db.mistakes) {
    const key = `${m.skill}:${m.category}`;
    const r = recurring.get(key) ?? { skill: m.skill, category: m.category, count: 0, unresolved: 0 };
    r.count += 1;
    if (!m.resolved) r.unresolved += 1;
    recurring.set(key, r);
  }

  const mocks = db.mockExams.filter((m) => m.status === "done" && m.results).map((m) => ({
    date: dayOf(m.createdAt),
    listening: m.results!.listening?.estimate ?? null,
    reading: m.results!.reading?.estimate ?? null,
    writing: m.results!.writing?.estimate ?? null,
    speaking: m.results!.speaking?.estimate ?? null,
  }));

  return {
    skills: skillSummaries(db),
    weekly,
    byTask,
    byDifficulty,
    studyDaily,
    vocabStats,
    recurring: [...recurring.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    traps: trapCounts(db),
    mocks,
    weeklyAssessments: db.weekly,
    official: db.settings.officialScores,
  };
}
