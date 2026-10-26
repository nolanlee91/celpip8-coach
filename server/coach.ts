// Coaching engine (Layer B, rule-based, no AI): decides what to learn next and builds the daily
// learning plan. Every recommendation carries a plain-language reason so the learner can see why.

import type { Db, DailyPlan, PlanBlock } from "../shared/types";
import type { Lesson } from "../shared/curriculum";
import { CATEGORIES, SKILLS, SKILL_LABEL, type Skill } from "../shared/spec";
import {
  buildPlan, categoryStats, currentWeek, dueMistakes, isDue, phaseFor, skillSummaries, trapCounts, weakestTask,
} from "./analytics";
import { addDays, today } from "./db";
import { dueLessonReviews, inProgressPass, isCompleted, lessonStatus, prerequisitesMet } from "./learn";

/** What the coach needs from the curriculum (injectable for tests). */
export interface CurriculumView {
  lessons: Map<string, Lesson>; // active lessons
  order: Record<string, string[]>; // curriculum order per skill
}

const STEP_VI: Record<string, string> = { objective: "mục tiêu", concept: "khái niệm", examples: "ví dụ mẫu", guided: "luyện có hướng dẫn", independent: "tự luyện", result: "kết quả" };
const pct = (x: number) => `${Math.round(x * 100)}%`;

// ---------------- Competency profile ----------------

export interface CompetencyStat {
  skill: Skill;
  competency: string;
  label: string;
  practice: { correct: number; total: number; accuracy: number } | null; // Practice Mode, last 60 days
  lessonMastery: number | null; // mean mastery of completed lessons that teach this competency
  lessonMisses: number; // misconception hits in the latest lesson passes
  lessons: { id: string; title: string; status: string }[];
  need: number; // higher = more urgent (gap to target × weakness)
}

function skillGap(db: Db): Record<Skill, number> {
  const out = {} as Record<Skill, number>;
  for (const s of skillSummaries(db)) out[s.skill] = Math.max(0, s.target - (s.estimate ?? s.official));
  return out;
}

export function competencyProfile(db: Db, cur: CurriculumView): CompetencyStat[] {
  const stats = categoryStats(db);
  const gaps = skillGap(db);
  const out: CompetencyStat[] = [];
  for (const skill of SKILLS) {
    for (const [competency, label] of Object.entries(CATEGORIES[skill])) {
      const st = stats.find((s) => s.skill === skill && s.category === competency);
      const lessons = cur.order[skill].map((id) => cur.lessons.get(id)).filter((l): l is Lesson => !!l && l.competencies.includes(competency));
      const masteries = lessons.map((l) => db.lessons[l.id]).filter((p) => p && p.runs.length).map((p) => p!.mastery ?? 0);
      const lessonMisses = lessons.reduce((n, l) => {
        const run = db.lessons[l.id]?.runs.at(-1);
        if (!run) return n;
        return n + Object.entries(run.misconceptions).filter(([k]) => {
          const ex = [...l.guided, ...l.independent].find((e) => (e.type === "choice" ? e.options.some((o) => o.misconception === k) : "misconception" in e && e.misconception === k));
          return ex?.competency === competency;
        }).reduce((m, [, c]) => m + c, 0);
      }, 0);
      const practice = st && st.total >= 3 ? { correct: st.correct, total: st.total, accuracy: st.accuracy } : null;
      const lessonMastery = masteries.length ? masteries.reduce((s, x) => s + x, 0) / masteries.length : null;
      // Evidence-weighted performance estimate; with no evidence assume 0.6 (learner is below target everywhere).
      const parts: [number, number][] = [];
      if (practice) parts.push([practice.accuracy, Math.min(1, practice.total / 10)]);
      if (lessonMastery !== null) parts.push([lessonMastery, 0.6]);
      const w = parts.reduce((n, [, x]) => n + x, 0);
      const perf = w ? parts.reduce((n, [v, x]) => n + v * x, 0) / w : 0.6;
      const need = (1 - perf) * (0.5 + gaps[skill]) + Math.min(0.3, lessonMisses * 0.05);
      out.push({
        skill, competency, label, practice, lessonMastery, lessonMisses, need: Math.round(need * 100) / 100,
        lessons: lessons.map((l) => ({ id: l.id, title: l.title, status: lessonStatus(db, l.id) })),
      });
    }
  }
  return out.sort((a, b) => b.need - a.need);
}

// ---------------- Recommendations ----------------

export interface Recommendation {
  kind: "resume" | "review" | "repeat" | "remediate" | "next" | "practice";
  skill: Skill;
  lessonId: string | null;
  title: string;
  reasonVi: string;
  minutes: number;
  route: string;
  priority: number;
}

/** Skill priority: distance to target, with Reading/Listening first while they are the weakest. */
function skillPriority(db: Db): Record<Skill, number> {
  const gaps = skillGap(db);
  const out = {} as Record<Skill, number>;
  const lastLesson = (skill: Skill) => Object.values(db.lessons).filter((p) => p.skill === skill).map((p) => p.updatedAt.slice(0, 10)).sort().at(-1);
  for (const s of SKILLS) {
    const objectiveBonus = s === "reading" || s === "listening" ? 1 : 0;
    const last = lastLesson(s);
    const daysSince = last ? Math.max(0, (Date.parse(today()) - Date.parse(last)) / 86400000) : 7;
    // Rotation: a skill not studied for a while rises, so Writing/Speaking are maintained.
    out[s] = gaps[s] * 8 + objectiveBonus * 4 + Math.min(7, daysSince) * 1.2;
  }
  return out;
}

function lessonRoute(id: string, step?: string) {
  return `/learn/${id}${step ? `?step=${step}` : ""}`;
}

export function recommendations(db: Db, cur: CurriculumView): Recommendation[] {
  const recs: Recommendation[] = [];
  const seen = new Set<string>();
  const add = (r: Recommendation) => {
    const key = `${r.kind}:${r.lessonId ?? r.route}`;
    if (seen.has(key)) return;
    seen.add(key);
    recs.push(r);
  };
  const L = (id: string) => cur.lessons.get(id);

  // 1) Unfinished lesson pass → resume it before starting anything new.
  for (const p of Object.values(db.lessons)) {
    const l = L(p.lessonId);
    if (!l || !inProgressPass(p)) continue;
    add({
      kind: "resume", skill: l.skill, lessonId: l.id, title: `Tiếp tục: ${l.titleVi}`, minutes: Math.max(10, Math.round(l.estimatedMinutes * 0.6)),
      route: lessonRoute(l.id), priority: 100,
      reasonVi: `Bạn đang học dở bài này (đang ở bước: ${STEP_VI[p.step] ?? p.step}). Hoàn thành trước khi bắt đầu bài mới để kiến thức liền mạch.`,
    });
  }

  // 2) Spaced reviews that are due.
  for (const p of dueLessonReviews(db)) {
    const l = L(p.lessonId);
    if (!l) continue;
    const overdue = Math.max(0, (Date.parse(today()) - Date.parse(p.srs!.due)) / 86400000);
    add({
      kind: "review", skill: l.skill, lessonId: l.id, title: `Ôn lại: ${l.titleVi}`, minutes: 6, route: `/learn/${l.id}?review=1`,
      priority: 90 + Math.min(5, overdue),
      reasonVi: `Đến hạn ôn ngắt quãng (lần ôn thứ ${p.reviews.length + 1}). Ôn đúng lúc giúp kỹ năng không bị quên.`,
    });
  }

  // 3) Last mastery check failed → repeat the lesson (concept + examples again).
  for (const p of Object.values(db.lessons)) {
    const l = L(p.lessonId);
    const last = p.runs.at(-1);
    if (!l || !last || last.outcome !== "repeat" || inProgressPass(p)) continue;
    add({
      kind: "repeat", skill: l.skill, lessonId: l.id, title: `Học lại: ${l.titleVi}`, minutes: l.estimatedMinutes, route: lessonRoute(l.id, "concept"),
      priority: 85,
      reasonVi: `Lần kiểm tra trước đạt ${pct(last.score)} (< ${pct(l.mastery.review)}). Đọc lại phần khái niệm và ví dụ trước khi làm lại bài tập.`,
    });
  }

  // 4) Practice data shows a weak competency → teach it before assigning more of the same questions.
  const stats = categoryStats(db).filter((s) => s.total >= (s.category === "time_management" ? 3 : 5));
  for (const st of stats) {
    if (st.accuracy >= 0.65) continue;
    const candidates = cur.order[st.skill].map(L).filter((l): l is Lesson => !!l && l.competencies.includes(st.category));
    const target = candidates.find((l) => !isCompleted(db.lessons[l.id]) && prerequisitesMet(db, l))
      ?? candidates.find((l) => !isCompleted(db.lessons[l.id]))
      ?? candidates.find((l) => lessonStatus(db, l.id) !== "mastered");
    const label = CATEGORIES[st.skill][st.category];
    if (target) {
      add({
        kind: "remediate", skill: st.skill, lessonId: target.id, title: `Học: ${target.titleVi}`, minutes: target.estimatedMinutes,
        route: lessonRoute(target.id), priority: 80 + (0.65 - st.accuracy) * 40,
        reasonVi: `Trong Practice Mode bạn đúng ${st.correct}/${st.total} câu "${label}" (${pct(st.accuracy)}). Làm thêm câu cùng loại sẽ không giúp nhiều — học kỹ thuật này với ví dụ mẫu trước.`,
      });
    } else if (candidates.length) {
      const l = candidates[0];
      add({
        kind: "practice", skill: st.skill, lessonId: l.id, title: `Áp dụng: ${label}`, minutes: 15, route: `/${st.skill}?mode=drill&focus=${st.category}`,
        priority: 60,
        reasonVi: `Bạn đã học xong các bài về "${label}" nhưng luyện tập vẫn ${pct(st.accuracy)}. Làm drill ngắn rồi xem lại bài "${l.titleVi}" nếu còn sai.`,
      });
    }
  }
  // Word-match trap habit → paraphrase / distractor lessons.
  const trap = trapCounts(db)[0];
  if (trap && trap.count >= 3 && (trap.trap === "word_match" || trap.trap === "partially_true")) {
    const l = ["rd-06", "rd-10", "ls-06"].map(L).find((x) => x && !isCompleted(db.lessons[x.id]));
    if (l) add({
      kind: "remediate", skill: l.skill, lessonId: l.id, title: `Học: ${l.titleVi}`, minutes: l.estimatedMinutes, route: lessonRoute(l.id), priority: 78,
      reasonVi: `Bạn đã ${trap.count} lần chọn đáp án bẫy kiểu "${trap.trap === "word_match" ? "lặp lại từ trong bài" : "đúng một phần"}". Bài này dạy cách so nghĩa thay vì so từ.`,
    });
  }

  // 5) Next lesson in each skill (curriculum order, prerequisites met), weighted by skill priority.
  const prio = skillPriority(db);
  for (const skill of SKILLS) {
    const next = cur.order[skill].map(L).find((l): l is Lesson => !!l && !db.lessons[l.id] && prerequisitesMet(db, l));
    if (!next) continue;
    const official = db.settings.officialScores[skill];
    add({
      kind: "next", skill, lessonId: next.id, title: `Học: ${next.titleVi}`, minutes: next.estimatedMinutes, route: lessonRoute(next.id),
      priority: 40 + prio[skill],
      reasonVi: `Bài tiếp theo trong lộ trình ${SKILL_LABEL[skill]} (điểm chính thức ${official} → mục tiêu ${db.settings.targetLevel}). ${next.whyItMattersVi}`,
    });
  }

  // 6) Recently mastered lessons → applied practice in Practice Mode.
  for (const p of Object.values(db.lessons)) {
    const l = L(p.lessonId);
    const last = p.runs.at(-1);
    if (!l || !last || last.outcome !== "advance" || last.at.slice(0, 10) < addDays(today(), -3) || !l.practice[0]) continue;
    add({
      kind: "practice", skill: l.skill, lessonId: l.id, title: `Áp dụng: ${l.practice[0].label}`, minutes: 15, route: l.practice[0].route, priority: 35,
      reasonVi: `Bạn vừa nắm vững "${l.titleVi}" (${pct(last.score)}). Áp dụng ngay vào bài dạng thi để kỹ năng chuyển sang điểm số.`,
    });
  }
  return recs.sort((a, b) => b.priority - a.priority);
}

// ---------------- Progress views ----------------

export function masteryBySkill(db: Db, cur: CurriculumView) {
  return SKILLS.map((skill) => {
    const ids = cur.order[skill].filter((id) => cur.lessons.has(id));
    const statuses = ids.map((id) => lessonStatus(db, id));
    const done = ids.map((id) => db.lessons[id]).filter((p) => p?.runs.length);
    return {
      skill,
      lessons: ids.length,
      mastered: statuses.filter((s) => s === "mastered").length,
      needsReview: statuses.filter((s) => s === "needs_review").length,
      inProgress: statuses.filter((s) => s === "in_progress").length,
      notStarted: statuses.filter((s) => s === "not_started").length,
      // Mean lesson mastery over completed lessons — a learning measure, NOT a CELPIP score.
      averageMastery: done.length ? Math.round((done.reduce((n, p) => n + (p!.mastery ?? 0), 0) / done.length) * 100) / 100 : null,
    };
  });
}

/** What still separates the learner from Level 8: weakest competencies in skills below target. */
export function blockers(db: Db, cur: CurriculumView) {
  const gaps = skillGap(db);
  return competencyProfile(db, cur)
    .filter((c) => gaps[c.skill] > 0)
    .slice(0, 4)
    .map((c) => {
      const evidence = c.practice ? `luyện tập ${pct(c.practice.accuracy)} (${c.practice.correct}/${c.practice.total})`
        : c.lessonMastery !== null ? `mastery bài học ${pct(c.lessonMastery)}` : "chưa có dữ liệu — ưu tiên theo điểm chính thức";
      const lesson = c.lessons.find((l) => l.status !== "mastered");
      return {
        skill: c.skill, competency: c.competency, label: c.label, evidence,
        lessonId: lesson?.id ?? null, lessonTitle: lesson?.title ?? null,
        textVi: `${SKILL_LABEL[c.skill]} — ${c.label}: ${evidence}.`,
      };
    });
}

/** Concrete improvements the learner has made recently (no invented numbers: only what the data shows). */
export function improvements(db: Db, cur: CurriculumView): string[] {
  const out: string[] = [];
  const weekAgo = addDays(today(), -6);
  const mastered = Object.values(db.lessons).filter((p) => p.runs.some((r) => r.outcome === "advance" && r.at.slice(0, 10) >= weekAgo));
  if (mastered.length) out.push(`Nắm vững ${mastered.length} bài học trong 7 ngày qua: ${mastered.map((p) => cur.lessons.get(p.lessonId)?.titleVi ?? p.lessonId).slice(0, 4).join(", ")}.`);
  for (const p of Object.values(db.lessons)) {
    if (p.runs.length < 2) continue;
    const first = p.runs[0].score;
    const best = Math.max(...p.runs.map((r) => r.score), ...p.reviews.map((r) => r.score));
    if (best - first >= 0.2) out.push(`"${cur.lessons.get(p.lessonId)?.titleVi ?? p.lessonId}": từ ${pct(first)} lên ${pct(best)}.`);
  }
  // Practice accuracy per competency: last 14 days vs the 14 days before.
  const recent = categoryStats(db, 14);
  const older = new Map(categoryStats(db, 28).map((s) => [`${s.skill}:${s.category}`, s]));
  for (const r of recent) {
    const o = older.get(`${r.skill}:${r.category}`);
    if (!o || r.total < 4) continue;
    const prevCorrect = o.correct - r.correct;
    const prevTotal = o.total - r.total;
    if (prevTotal < 4) continue;
    const delta = r.accuracy - prevCorrect / prevTotal;
    if (delta >= 0.1) out.push(`${SKILL_LABEL[r.skill]} — ${CATEGORIES[r.skill][r.category]}: ${pct(prevCorrect / prevTotal)} → ${pct(r.accuracy)} (luyện tập, 14 ngày gần nhất).`);
  }
  const reviews = Object.values(db.lessons).flatMap((p) => p.reviews.filter((r) => r.at.slice(0, 10) >= weekAgo));
  if (reviews.length) out.push(`Ôn ${reviews.length} bài đúng hạn tuần này, điểm ôn trung bình ${pct(reviews.reduce((n, r) => n + r.score, 0) / reviews.length)}.`);
  return out.slice(0, 6);
}

export function weeklyConsistency(db: Db) {
  return [3, 2, 1, 0].map((w) => {
    const from = addDays(today(), -7 * w - 6);
    const to = addDays(today(), -7 * w);
    const inRange = (d: string) => d >= from && d <= to;
    const days = new Set(db.studyLog.filter((e) => inRange(e.date) && e.minutes > 0).map((e) => e.date));
    return {
      week: from.slice(5),
      daysStudied: days.size,
      minutes: db.studyLog.filter((e) => inRange(e.date)).reduce((n, e) => n + e.minutes, 0),
      lessonsCompleted: Object.values(db.lessons).reduce((n, p) => n + p.runs.filter((r) => inRange(r.at.slice(0, 10))).length, 0),
      reviews: Object.values(db.lessons).reduce((n, p) => n + p.reviews.filter((r) => inRange(r.at.slice(0, 10))).length, 0),
    };
  });
}

// ---------------- Daily learning plan ----------------

/**
 * Today's plan mixes learning and practice: a lesson (split into "learn" and "guided practice"),
 * due lesson reviews, vocabulary and mistake review, applied practice, and — on longer days — a second
 * lesson in another skill or occasional exam practice. It is never only tests.
 */
export function buildLearningPlan(db: Db, cur: CurriculumView, minutes: number, date = today()): DailyPlan {
  const s = db.settings;
  const week = currentWeek(db);
  const phase = phaseFor(week, s.planWeeks);
  const dayIndex = Math.round((Date.parse(date + "T12:00:00") - Date.parse(s.startDate + "T12:00:00")) / 86400000);
  const recs = recommendations(db, cur);
  const blocks: PlanBlock[] = [];
  let left = minutes;
  const push = (b: PlanBlock) => { if (b.minutes > 0 && left > 0) { b.minutes = Math.min(b.minutes, left); blocks.push(b); left -= b.minutes; } };

  // Phase 4 mock days keep the full mock exam (occasional exam practice).
  if (phase.number === 4 && (dayIndex % 7 === 2 || dayIndex % 7 === 5) && minutes >= 120) {
    push({ id: "mock", skill: "review", kind: "exam", title: "Thi thử đầy đủ (Mock Exam)", detail: "Listening → Reading → Writing → Speaking, đúng thời gian thi.", minutes: minutes - 15, route: "/mock", reason: "Giai đoạn 4: thi thử 2 lần/tuần để quen áp lực thời gian." });
  }

  const lessonRecs = recs.filter((r) => r.lessonId && (r.kind === "resume" || r.kind === "repeat" || r.kind === "remediate" || r.kind === "next"));
  const primary = lessonRecs[0];
  const lessonOf = (r: Recommendation | undefined) => (r?.lessonId ? cur.lessons.get(r.lessonId) : undefined);

  const addLesson = (r: Recommendation, tag: string, budget: number) => {
    const l = lessonOf(r)!;
    const total = Math.min(budget, r.kind === "resume" ? r.minutes : l.estimatedMinutes);
    const learn = Math.max(5, Math.round((total * 0.45) / 5) * 5);
    const practice = Math.max(5, total - learn);
    const resumeAt = db.lessons[l.id]?.step;
    push({
      id: `learn-${tag}`, skill: l.skill, kind: "learn", lessonId: l.id, title: `Học: ${l.titleVi}`,
      detail: `${l.title} — mục tiêu, khái niệm, ví dụ mẫu.${resumeAt && resumeAt !== "objective" && r.kind === "resume" ? ` (tiếp tục từ bước: ${STEP_VI[resumeAt] ?? resumeAt})` : ""}`,
      minutes: learn, route: `/learn/${l.id}${r.kind === "repeat" ? "?step=concept" : ""}`, reason: r.reasonVi,
    });
    push({
      id: `guided-${tag}`, skill: l.skill, kind: "guided", lessonId: l.id, title: "Luyện có hướng dẫn + bài kiểm tra mức độ nắm vững",
      detail: `${l.guided.length} bài có gợi ý, ${l.independent.length} bài tự làm. Đạt ≥ ${pct(l.mastery.advance)} là nắm vững.`,
      minutes: practice, route: `/learn/${l.id}?step=guided`, reason: "Luyện ngay sau khi học giúp nhớ kỹ thuật lâu hơn.",
    });
  };

  const big = minutes >= 90;
  if (primary && lessonOf(primary)) addLesson(primary, "1", minutes <= 30 ? 20 : minutes <= 60 ? 25 : 35);

  // Spaced lesson reviews.
  for (const r of recs.filter((x) => x.kind === "review").slice(0, minutes <= 30 ? 1 : 2)) {
    push({ id: `lesson-review-${r.lessonId}`, skill: r.skill, kind: "lesson-review", lessonId: r.lessonId ?? undefined, title: r.title, detail: "5 câu ngắn — kiểm tra bạn còn nhớ kỹ thuật không.", minutes: r.minutes, route: r.route, reason: r.reasonVi });
  }

  // Vocabulary + mistakes (spaced repetition).
  const dueV = db.vocab.filter((v) => isDue(v.srs)).length;
  const dueM = dueMistakes(db).length;
  if (dueV) push({ id: "review-vocab", skill: "review", kind: "vocab", title: `Ôn ${dueV} từ vựng`, detail: "Flashcard + chọn nghĩa — gồm các cụm từ bạn thêm từ bài học.", minutes: minutes <= 30 ? 5 : 10, route: "/vocabulary?review=1", reason: "Từ vựng đến hạn ôn theo lặp lại ngắt quãng." });
  else if (minutes >= 60) push({ id: "review-vocab", skill: "review", kind: "vocab", title: "Học cụm từ của bài hôm nay", detail: "Thêm các cụm từ trong bài vào sổ từ vựng để ôn ngắt quãng.", minutes: 5, route: primary?.lessonId ? `/learn/${primary.lessonId}?step=result` : "/vocabulary", reason: "Gắn từ vựng với bài học giúp dùng được ngay." });

  // Applied practice in Practice Mode (connected to what was just learned).
  const pl = lessonOf(primary);
  if (minutes >= 60 && pl) {
    const route = pl.practice[0]?.route ?? `/${pl.skill}`;
    push({ id: "practice-1", skill: pl.skill, kind: "practice", title: `${SKILL_LABEL[pl.skill]} practice: ${pl.practice[0]?.label ?? "bài dạng thi"}`, detail: "Áp dụng kỹ thuật vừa học vào bài dạng thi (Practice Mode).", minutes: 15, route, reason: "Chuyển kỹ thuật từ bài học sang bài thi thật." });
  }
  if (dueM) push({ id: "review-mistakes", skill: "review", kind: "mistakes", title: `Ôn ${dueM} lỗi đến hạn`, detail: "Làm lại câu đã sai — gồm cả lỗi trong bài học.", minutes: minutes <= 30 ? 5 : 10, route: "/mistakes?review=1", reason: "Lỗi lặp lại là thứ giữ điểm bạn ở mức hiện tại." });

  // Longer days: a second lesson in a different skill (keeps Writing/Speaking maintained), then practice/exam.
  if (big) {
    const second = lessonRecs.find((r) => r.skill !== primary?.skill && lessonOf(r));
    if (second) addLesson(second, "2", minutes >= 120 ? 30 : 25);
  }
  if (minutes >= 120 || (dayIndex % 7 === 5 && minutes >= 60)) {
    const skill: Skill = (skillGap(db).reading >= skillGap(db).listening ? "reading" : "listening");
    const task = weakestTask(db, skill);
    push({ id: "exam-part", skill, kind: "exam", title: `Exam practice: ${SKILL_LABEL[skill]} ${task} (đủ giờ)`, detail: "Một part làm nghiêm túc như thi thật để đo tiến bộ.", minutes: 20, route: `/${skill}?task=${task}`, reason: "Thỉnh thoảng làm bài đủ giờ để kiểm tra kỹ năng đã chuyển thành điểm chưa." });
  }

  // Fill what is left with regular Practice Mode blocks (existing planner), never more than the time left.
  if (left >= 10) {
    const filler = buildPlan(db, left, date).blocks.filter((b) => b.skill !== "review" && b.id !== "mock" && b.id !== "weekly");
    for (const b of filler) { if (left < 8 || Math.min(b.minutes, left) < 8) continue; push({ ...b, id: `p-${b.id}`, kind: "practice", reason: b.reason ?? "Duy trì luyện tập dạng thi theo tỷ trọng kỹ năng." }); }
  }
  if (left > 0 && blocks.length) blocks[blocks.length - 1].minutes += left;

  // Lesson blocks tick themselves once the lesson pass/review was done today.
  const auto = blocks.filter((b) => {
    if (!b.lessonId) return false;
    const p = db.lessons[b.lessonId];
    if (!p) return false;
    if (b.kind === "lesson-review") return p.reviews.some((r) => r.at.slice(0, 10) === date);
    if (b.kind === "guided") return p.runs.some((r) => r.at.slice(0, 10) === date);
    if (b.kind === "learn") return p.runs.some((r) => r.at.slice(0, 10) === date) || ["guided", "independent", "result"].includes(p.step) && p.updatedAt.slice(0, 10) === date;
    return false;
  }).map((b) => b.id);
  const completed = [...new Set([...(db.planCompletions[date] ?? []), ...auto])];
  return { date, week, phase, minutes, blocks, completed };
}
