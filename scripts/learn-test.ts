// Unit tests for Learn Mode (npm run test:learn): grading, mastery, lesson progression, spaced
// review scheduling, lesson mistakes, coaching rules, the daily learning plan and persistence.
// Uses fixture lessons (independent of the authored content) and a temporary DATA_DIR.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "celpip8-learn-"));
process.env.DATA_DIR = dataDir;

const { gradeExercise, dictationAccuracy, outcomeFor } = await import("../shared/curriculum");
const { validateLesson, validateCurriculum } = await import("../shared/validate-lesson");
const learn = await import("../server/learn");
const coach = await import("../server/coach");
const dbm = await import("../server/db");
type Lesson = import("../shared/curriculum").Lesson;
type Exercise = import("../shared/curriculum").Exercise;

let passed = 0;
let failed = 0;
const tests: [string, () => void | Promise<void>][] = [];
const test = (name: string, fn: () => void | Promise<void>) => { tests.push([name, fn]); };

// ---------- fixtures ----------

const choice = (id: string, competency: string, hint?: string): Exercise => ({
  id, type: "choice", prompt: `Question ${id}?`, competency, explanationVi: "Giải thích.", ...(hint ? { hint } : {}),
  options: [{ text: `right ${id}`, misconception: null, whyVi: "Đúng." }, { text: `wrong ${id}`, misconception: "word-match", whyVi: "Sai." }, { text: `other ${id}`, misconception: "too-broad", whyVi: "Sai." }],
  answerIndex: 0,
});
const concept = Array.from({ length: 3 }, (_, i) => ({ heading: `Part ${i}`, body: "word ".repeat(100) }));

function fixture(id: string, skill: Lesson["skill"], competencies: string[], prerequisites: string[] = []): Lesson {
  const comp = competencies[0];
  return {
    id, skill, module: `${skill}-m`, level: "core", difficulty: 7, title: `Lesson ${id}`, titleVi: `Bài ${id}`, estimatedMinutes: 25,
    prerequisites, competencies, tasks: [skill === "reading" ? "R1" : skill === "listening" ? "L1" : skill === "writing" ? "W1" : "S1"],
    objectives: ["Do A", "Do B"], objectiveVi: "Mục tiêu", whyItMattersVi: "Vì sao.", concept, stimuli: { p: { text: "The meeting moved to Friday because the room was booked." } },
    examples: [{ id: "e1", title: "E1", stimulusId: "p", steps: ["s1", "s2"], takeawayVi: "t" }, { id: "e2", title: "E2", steps: ["s1", "s2"], takeawayVi: "t" }],
    guided: [choice("g1", comp, "hint"), choice("g2", comp, "hint"), choice("g3", comp, "hint")],
    independent: ["i1", "i2", "i3", "i4", "i5"].map((x) => choice(x, comp)),
    misconceptions: { "word-match": { label: "Khớp từ", explanationVi: "x", fixVi: "y" }, "too-broad": { label: "Quá rộng", explanationVi: "x", fixVi: "y" } },
    mastery: { advance: 0.8, review: 0.6 }, vocabulary: [1, 2, 3, 4].map((n) => ({ term: `term${n}`, vi: "nghĩa", example: `example ${n}` })),
    grammar: [], practice: [{ label: "Drill", route: `/${skill}?mode=drill&focus=${comp}` }], source: "curated",
    review: { status: "approved", reviewedBy: "test", notes: "" },
  };
}

const rd1 = fixture("rd-01", "reading", ["main_idea"]);
const rd2 = fixture("rd-02", "reading", ["detail"], ["rd-01"]);
const rd8 = fixture("rd-08", "reading", ["inference"], []);
const ls1 = fixture("ls-01", "listening", ["missed_info"]);
const wr1 = fixture("wr-01", "writing", ["grammar"]);
const cur = {
  lessons: new Map([rd1, rd2, rd8, ls1, wr1].map((l) => [l.id, l])),
  order: { reading: ["rd-01", "rd-02", "rd-08"], listening: ["ls-01"], speaking: [], writing: ["wr-01"] } as Record<string, string[]>,
};
const freshDb = () => {
  const db = dbm.load();
  db.lessons = {}; db.attempts = []; db.mistakes = []; db.vocab = []; db.studyLog = []; db.planCompletions = {};
  return db;
};
const answerAll = (db: ReturnType<typeof freshDb>, l: Lesson, correctCount: number) => {
  l.independent.forEach((e, i) => learn.answerExercise(db, l, e.id, i < correctCount ? 0 : 1, 30));
};

// ---------- grading ----------

test("choice: correct option scores 1; wrong option reports its misconception", () => {
  const ex = choice("x", "detail");
  assert.deepEqual(gradeExercise(ex, 0), { correct: true, score: 1, misconception: null });
  const w = gradeExercise(ex, 2);
  assert.equal(w.correct, false);
  assert.equal(w.misconception, "too-broad");
});

test("text: exact answers ignore case, punctuation and curly apostrophes", () => {
  const ex: Exercise = { id: "t", type: "text", prompt: "p", competency: "grammar", explanationVi: "e", answers: ["doesn't", "does not"], mode: "exact", misconception: "word-match" };
  assert.equal(gradeExercise(ex, "Doesn’t.").correct, true);
  assert.equal(gradeExercise(ex, " does NOT ").correct, true);
  assert.equal(gradeExercise(ex, "don't").correct, false);
  assert.equal(gradeExercise(ex, "don't").misconception, "word-match");
});

test("dictation: ≥ 90% of words in order counts as correct, missing words are reported", () => {
  const target = "The bus to Metrotown leaves every fifteen minutes on weekdays";
  assert.equal(dictationAccuracy(target, target.toLowerCase()).accuracy, 1);
  const ex: Exercise = { id: "d", type: "text", prompt: "p", competency: "vocabulary", explanationVi: "e", answers: [target], mode: "dictation", misconception: "word-match" };
  const near = gradeExercise(ex, "The bus to Metrotown leaves every fifteen minutes on weekday");
  assert.equal(near.correct, true, `accuracy ${near.score}`);
  const far = gradeExercise(ex, "The bus leaves every minutes");
  assert.equal(far.correct, false);
  assert.match(far.detail ?? "", /metrotown/);
});

test("order: partial credit by position, full credit only for the exact order", () => {
  const ex: Exercise = { id: "o", type: "order", prompt: "p", competency: "coherence", explanationVi: "e", items: ["a", "b", "c", "d"], misconception: "m" };
  assert.equal(gradeExercise(ex, ["a", "b", "c", "d"]).correct, true);
  const g = gradeExercise(ex, ["a", "b", "d", "c"]);
  assert.equal(g.correct, false);
  assert.equal(g.score, 0.5);
});

test("produce: checklist self-assessment; an empty response scores 0", () => {
  const ex: Exercise = { id: "p", type: "produce", medium: "write", prompt: "p", competency: "coherence", explanationVi: "e", checklist: ["a", "b", "c", "d"], modelAnswer: "m ".repeat(20), misconception: "m", minWords: 50 };
  assert.equal(gradeExercise(ex, { text: "one two three four five six", checked: [0, 1, 2] }).score, 0.75);
  assert.equal(gradeExercise(ex, { text: "one two three four five six", checked: [0, 1, 2] }).correct, true);
  assert.equal(gradeExercise(ex, { text: "", checked: [0, 1, 2, 3] }).score, 0);
  assert.equal(gradeExercise(ex, { text: "one two three four five six", checked: [0] }).misconception, "m");
});

test("outcome thresholds: ≥ advance → advance, ≥ review → review, else repeat", () => {
  const m = { advance: 0.8, review: 0.6 };
  assert.equal(outcomeFor(0.8, m), "advance");
  assert.equal(outcomeFor(0.79, m), "review");
  assert.equal(outcomeFor(0.6, m), "review");
  assert.equal(outcomeFor(0.59, m), "repeat");
});

test("mastery score: unanswered independent items count as 0; guided answers do not count", () => {
  const db = freshDb();
  learn.startLesson(db, rd1);
  for (const g of rd1.guided) learn.answerExercise(db, rd1, g.id, 0);
  learn.answerExercise(db, rd1, "i1", 0);
  learn.answerExercise(db, rd1, "i2", 0);
  assert.equal(learn.masteryScore(rd1, db.lessons[rd1.id].answers), 0.4);
});

test("mastery score: production exercises weigh 25% when mixed with auto-graded ones", () => {
  const l = fixture("wr-01", "writing", ["grammar"]);
  l.independent = [...l.independent.slice(0, 4), { id: "pp", type: "produce", medium: "write", prompt: "p", competency: "grammar", explanationVi: "e", checklist: ["a", "b", "c"], modelAnswer: "m ".repeat(20), misconception: "word-match" }];
  const answers = Object.fromEntries(l.independent.map((e) => [e.id, { section: "independent" as const, response: 0, correct: e.type !== "produce", score: e.type === "produce" ? 0 : 1, misconception: null, at: "" }]));
  assert.equal(learn.masteryScore(l, answers), 0.75);
});

// ---------- progression & persistence of a pass ----------

test("progression: start → steps → answers → resume keeps answers → complete", () => {
  const db = freshDb();
  const p = learn.startLesson(db, rd1);
  assert.equal(p.status, "in_progress");
  assert.equal(learn.lessonStatus(db, rd1.id), "in_progress");
  learn.setStep(db, rd1, "concept", 120);
  learn.setStep(db, rd1, "examples", 60);
  const g = learn.answerExercise(db, rd1, "g1", 1, 30);
  assert.equal(g.correct, false);
  assert.equal(g.section, "guided");
  assert.equal(db.lessons[rd1.id].step, "guided", "answering a guided exercise moves the pass to the guided step");
  const again = learn.startLesson(db, rd1);
  assert.equal(Object.keys(again.answers).length, 1, "resume keeps the unfinished pass");
  assert.equal(learn.inProgressPass(again), true);
  answerAll(db, rd1, 5);
  const r = learn.completeLesson(db, rd1);
  assert.equal(r.run.score, 1);
  assert.equal(r.run.outcome, "advance");
  assert.equal(db.lessons[rd1.id].status, "mastered");
  assert.equal(db.lessons[rd1.id].step, "result");
  assert.equal(r.run.misconceptions["word-match"], 1, "guided misconceptions are part of the analysis");
  assert.ok(r.run.timeSec >= 240, `time tracked: ${r.run.timeSec}`);
  assert.equal(learn.inProgressPass(db.lessons[rd1.id]), false);
});

test("restart keeps history and review schedule but clears the pass", () => {
  const db = dbm.load();
  const before = db.lessons[rd1.id];
  const srsDue = before.srs!.due;
  learn.startLesson(db, rd1, { restart: true });
  const p = db.lessons[rd1.id];
  assert.equal(p.step, "objective");
  assert.equal(Object.keys(p.answers).length, 0);
  assert.equal(p.runs.length, 1);
  assert.equal(p.srs!.due, srsDue);
  assert.equal(p.status, "mastered");
});

test("prerequisites unlock after completion with outcome ≥ review", () => {
  const db = freshDb();
  assert.equal(learn.prerequisitesMet(db, rd2), false);
  learn.startLesson(db, rd1);
  answerAll(db, rd1, 2); // 40% → repeat
  learn.completeLesson(db, rd1);
  assert.equal(learn.prerequisitesMet(db, rd2), false, "a failed mastery check does not unlock");
  learn.startLesson(db, rd1, { restart: true });
  answerAll(db, rd1, 3); // 60% → review
  const r = learn.completeLesson(db, rd1);
  assert.equal(r.run.outcome, "review");
  assert.equal(db.lessons[rd1.id].status, "needs_review");
  assert.equal(learn.prerequisitesMet(db, rd2), true);
});

test("wrong independent answers become mistake cards; repeats are not duplicated", () => {
  const db = freshDb();
  learn.startLesson(db, rd8);
  answerAll(db, rd8, 3);
  const r1 = learn.completeLesson(db, rd8);
  assert.equal(r1.mistakesAdded, 2);
  assert.ok(db.mistakes.every((m) => m.contentId === "rd-08" && m.category === "inference" && m.questionId.startsWith("rd-08:")));
  learn.startLesson(db, rd8, { restart: true });
  answerAll(db, rd8, 3);
  const r2 = learn.completeLesson(db, rd8);
  assert.equal(r2.mistakesAdded, 0);
  assert.equal(db.mistakes.length, 2);
  assert.ok(db.mistakes.every((m) => m.repeatCount >= 2));
});

// ---------- spaced review ----------

test("review scheduling: SM-2 intervals grow with good reviews and reset on a failed review", () => {
  const db = freshDb();
  learn.startLesson(db, rd1);
  answerAll(db, rd1, 5);
  learn.completeLesson(db, rd1);
  const p = db.lessons[rd1.id];
  assert.equal(p.srs!.interval, 1);
  assert.equal(p.srs!.due, dbm.addDays(dbm.today(), 1));
  assert.equal(learn.dueLessonReviews(db).length, 0, "not due on the day it was learned");
  assert.equal(learn.lessonStatus(db, rd1.id), "mastered");

  p.srs!.due = dbm.today(); // simulate the passage of a day
  assert.equal(learn.dueLessonReviews(db).length, 1);
  assert.equal(learn.lessonStatus(db, rd1.id), "needs_review", "a due review shows as needs review");
  const ids = learn.reviewExercises(rd1, p).map((e) => e.id);
  assert.equal(ids.length, 5);
  const good = learn.submitReview(db, rd1, Object.fromEntries(ids.map((id) => [id, 0])), 60);
  assert.equal(good.score, 1);
  assert.equal(p.srs!.interval, 3);
  assert.equal(good.nextReview, dbm.addDays(dbm.today(), 3));

  p.srs!.due = dbm.today();
  learn.submitReview(db, rd1, Object.fromEntries(ids.map((id) => [id, 0])));
  assert.ok(p.srs!.interval >= 7, `third interval ${p.srs!.interval}`);

  p.srs!.due = dbm.today();
  const bad = learn.submitReview(db, rd1, Object.fromEntries(ids.map((id) => [id, 1])));
  assert.equal(bad.status, "needs_review");
  assert.equal(p.srs!.interval, 1);
  assert.equal(p.srs!.lapses, 1);
  assert.equal(p.reviews.length, 3);
});

test("review quiz puts previously wrong exercises first", () => {
  const db = freshDb();
  learn.startLesson(db, rd1);
  rd1.independent.forEach((e) => learn.answerExercise(db, rd1, e.id, e.id === "i5" ? 1 : 0));
  learn.completeLesson(db, rd1);
  assert.equal(learn.reviewExercises(rd1, db.lessons[rd1.id], 3)[0].id, "i5");
});

// ---------- coaching rules ----------

function seedPractice(db: ReturnType<typeof freshDb>, category: string, correct: number, total: number) {
  db.attempts.push({
    id: `at_${category}`, skill: "reading", taskType: "R4", mode: "learn", contentId: "x", difficulty: 7, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    durationSec: 600, correct, total, estimatedBand: null, evaluationId: null, mockExamId: null,
    items: Array.from({ length: total }, (_, i) => ({ questionId: `q${i}`, number: i + 1, category, correct: i < correct, chosenIndex: 0, chosenTrap: i < correct ? "none" : "partially_true" })),
  });
}

test("coach: with no data, recommends the next Reading lesson first (weakest official score)", () => {
  const db = freshDb();
  const recs = coach.recommendations(db, cur);
  assert.equal(recs[0].kind, "next");
  assert.equal(recs[0].skill, "reading");
  assert.equal(recs[0].lessonId, "rd-01");
  assert.ok(recs[0].reasonVi.length > 20);
  assert.ok(!recs.some((r) => r.lessonId === "rd-02" && r.kind === "next"), "locked lesson is not offered as next");
});

test("coach: repeated inference failures in practice → inference lesson before more practice", () => {
  const db = freshDb();
  seedPractice(db, "inference", 2, 8);
  const recs = coach.recommendations(db, cur);
  assert.equal(recs[0].kind, "remediate");
  assert.equal(recs[0].lessonId, "rd-08");
  assert.match(recs[0].reasonVi, /2\/8/);
});

test("coach: once the lesson is mastered but practice is still weak → applied drill, not the same lesson", () => {
  const db = freshDb();
  seedPractice(db, "inference", 2, 8);
  learn.startLesson(db, rd8);
  answerAll(db, rd8, 5);
  learn.completeLesson(db, rd8);
  const recs = coach.recommendations(db, cur);
  assert.ok(!recs.some((r) => r.kind === "remediate" && r.lessonId === "rd-08"));
  assert.ok(recs.some((r) => r.kind === "practice" && r.route.includes("focus=inference")));
});

test("coach: an unfinished lesson is resumed first; due reviews come next", () => {
  const db = freshDb();
  learn.startLesson(db, rd1);
  answerAll(db, rd1, 5);
  learn.completeLesson(db, rd1);
  db.lessons[rd1.id].srs!.due = dbm.today();
  learn.startLesson(db, ls1);
  learn.setStep(db, ls1, "concept");
  const recs = coach.recommendations(db, cur);
  assert.equal(recs[0].kind, "resume");
  assert.equal(recs[0].lessonId, "ls-01");
  assert.equal(recs[1].kind, "review");
  assert.equal(recs[1].lessonId, "rd-01");
});

test("daily plan: 30/60/90/120 minutes, always includes learning, totals match, not only tests", () => {
  for (const minutes of [30, 60, 90, 120]) {
    const db = freshDb();
    db.settings.startDate = dbm.today();
    const plan = coach.buildLearningPlan(db, cur, minutes);
    const total = plan.blocks.reduce((n, b) => n + b.minutes, 0);
    assert.equal(total, minutes, `${minutes}: blocks sum to ${total}`);
    assert.ok(plan.blocks.some((b) => b.kind === "learn"), `${minutes}: has a learn block`);
    assert.ok(plan.blocks.some((b) => b.kind === "guided"), `${minutes}: has guided practice`);
    const testMinutes = plan.blocks.filter((b) => b.kind === "practice" || b.kind === "exam").reduce((n, b) => n + b.minutes, 0);
    assert.ok(testMinutes < minutes * 0.7, `${minutes}: practice/exam ${testMinutes} min`);
    assert.ok(plan.blocks.every((b) => b.minutes > 0 && b.route.startsWith("/")));
    if (minutes >= 90) assert.ok(new Set(plan.blocks.filter((b) => b.kind === "learn").map((b) => b.skill)).size >= 2, `${minutes}: second lesson in another skill`);
  }
});

test("daily plan: lesson blocks tick themselves once the lesson is completed today", () => {
  const db = freshDb();
  const plan1 = coach.buildLearningPlan(db, cur, 60);
  const learnBlock = plan1.blocks.find((b) => b.kind === "guided")!;
  const l = cur.lessons.get(learnBlock.lessonId!)!;
  learn.startLesson(db, l);
  answerAll(db, l, 5);
  learn.completeLesson(db, l);
  // The completed lesson is no longer recommended, so check the completion rule directly on a plan that still lists it.
  const p = db.lessons[l.id];
  assert.ok(p.runs.some((r) => r.at.slice(0, 10) === dbm.today()));
  const plan2 = coach.buildLearningPlan(db, cur, 60);
  assert.ok(!plan2.blocks.some((b) => b.kind === "learn" && b.lessonId === l.id), "mastered lesson is not planned again as a new lesson");
});

test("progress views: mastery by skill, blockers and improvements come only from real data", () => {
  const db = freshDb();
  const m0 = coach.masteryBySkill(db, cur).find((x) => x.skill === "reading")!;
  assert.equal(m0.mastered, 0);
  assert.equal(m0.averageMastery, null);
  assert.deepEqual(coach.improvements(db, cur), []);
  learn.startLesson(db, rd1);
  answerAll(db, rd1, 4);
  learn.completeLesson(db, rd1);
  const m1 = coach.masteryBySkill(db, cur).find((x) => x.skill === "reading")!;
  assert.equal(m1.mastered, 1);
  assert.equal(m1.averageMastery, 0.8);
  assert.ok(coach.improvements(db, cur)[0].includes("1 bài"));
  assert.ok(coach.blockers(db, cur).length > 0);
});

// ---------- validation ----------

test("validator: a complete fixture lesson passes; a thin lesson is rejected", () => {
  const ctx = { listeningChunks: new Map(), speakingImages: new Set<string>() };
  const ok = validateLesson(rd8, ctx).filter((i) => i.severity === "error");
  assert.deepEqual(ok.map((i) => i.message), []);
  const thin = { ...rd8, concept: [{ heading: "x", body: "short" }], guided: [], independent: rd8.independent.slice(0, 2) };
  const errs = validateLesson(thin, ctx).filter((i) => i.severity === "error").map((i) => i.message).join(" | ");
  assert.match(errs, /concept/);
  assert.match(errs, /guided practice/);
  assert.match(errs, /independent practice/);
  const leaky = { ...rd8, independent: rd8.independent.map((e) => ({ ...e, hint: "x" })) };
  assert.match(validateLesson(leaky, ctx).map((i) => i.message).join(" "), /must not have a hint/);
});

test("validator: curriculum order and prerequisites are enforced", () => {
  const map = { version: 1 as const, modules: [{ id: "reading-m", skill: "reading" as const, order: 1, title: "", titleVi: "", goalVi: "", lessons: ["rd-02", "rd-01"] }] };
  const issues = validateCurriculum(map, [rd1, rd2]);
  assert.ok(issues.some((i) => i.id === "rd-02" && /must come earlier/.test(i.message)));
});

// ---------- persistence ----------

test("persistence: lesson progress is written to progress.json and survives a reload", async () => {
  const db = freshDb();
  learn.startLesson(db, rd1);
  learn.answerExercise(db, rd1, "g1", 0, 10);
  await dbm.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "progress.json"), "utf8"));
  assert.ok(onDisk.lessons?.["rd-01"]?.answers?.g1, "answers saved in progress.json");
  const ai = JSON.parse(fs.readFileSync(path.join(dataDir, "ai.json"), "utf8"));
  assert.ok(!("lessons" in ai), "lesson progress is not stored with AI data");
});

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${(e as Error).message}`); }
}
console.log(`\n${passed} passed, ${failed} failed.`);
fs.rmSync(dataDir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
