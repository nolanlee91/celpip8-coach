# AUDIT (3): Phase 3, Learn Mode and the coaching system

This document is for an independent auditor (Codex). It covers **Phase 3**: Learn Mode, the curriculum, adaptive coaching, the learning plan and the context-aware tutor. Earlier phases are covered by `AUDIT.md`.

**Conventions:**
- Every number below was produced by a command you can re-run; the commands are given in §3 and §8.
- Nothing is claimed as tested unless a test in this repo exercises it.
- Items that are **not** tested are listed in §10.

---

## 1. Summary

| Deliverable | Status |
|---|---|
| Functional Learn Mode (`/learn`, `/learn/:id`) | Implemented; covered by unit + end-to-end tests (§8) |
| Structured four-skill curriculum | 60 lessons / 13 modules: Reading 15, Listening 15, Speaking 15, Writing 15 |
| Complete pre-generated lessons | 60/60 pass schema validation (0 errors, 0 warnings) and are `approved` |
| Adaptive, rule-based recommendations (no AI) | `server/coach.ts`; 4 rule tests + 1 end-to-end check |
| Integrated daily study plan (30/60/90/120) | `buildLearningPlan`; tested for all four lengths |
| Lesson mastery + spaced review | SM-2 via the existing `reviewSrs`; tested |
| Context-aware optional AI Tutor | Implemented. **Live Gemini behaviour untested** (no key used in tests). |
| Updated navigation and dashboard | Learn / Practice sections, "Kế hoạch học hôm nay" plan card, next-lesson card, blockers, improvements, mastery bars |
| Tests and validation scripts | `npm run test:learn` (24 tests), `npm run test:smoke` (45 checks), `npm run content:validate` |
| README + this file | Done |

**Earlier phases still work:**
- Practice Mode, mock exams, library, admin, vocabulary, mistakes and analytics are unchanged, apart from the additive changes listed in §2.
- The existing smoke checks all still pass.

---

## 2. Architecture and files

### Content (Layer A, stored, never generated during study)

| Path | Purpose |
|---|---|
| `content/lessons/curriculum.json` | 13 modules (skill, order, title, goal, ordered lesson ids) |
| `content/lessons/<skill>/<id>.json` | One lesson per file (`rd-01…15`, `ls-01…15`, `sp-01…15`, `wr-01…15`) |
| `content/lessons/LESSON_GUIDE.md` | Authoring specification and quality bar, with the full outline of all 60 lessons |
| `audio-assets/<lessonId>-c<i>-<hash>.mp3` | 83 lesson audio clips (Edge TTS), committed, listed in `audio-assets/manifest.json` |

### Code added

| File | Role |
|---|---|
| `shared/curriculum.ts` | Lesson schema, including 4 exercise types: `choice`, `text` (exact / dictation), `order` and `produce`. Also the progress types and the **pure grading functions**: `gradeExercise`, `dictationAccuracy`, `outcomeFor`. |
| `shared/validate-lesson.ts` | Lesson and curriculum validation (rules in §4) |
| `server/lessons.ts` | Loads and validates the curriculum against the library (for `audioRef` / `imageRef`). Exposes approved, error-free lessons only. |
| `server/learn.ts` | Learn engine: start/resume/restart a pass, steps, answers, mastery score, `completeLesson` (outcome, misconception analysis, SM-2 scheduling, lesson mistakes into the mistake notebook), review quiz, `submitReview`, due reviews |
| `server/coach.ts` | Rule-based coach: competency profile, recommendations with Vietnamese reasons, mastery by skill, blockers, improvements, weekly consistency, `buildLearningPlan` |
| `server/learn-routes.ts` | Learn API (below), and `lessonTutorContext` for the tutor |
| `src/pages/Learn.tsx` | Curriculum map, next recommendation, mastery bars, blockers/improvements, review schedule, weekly consistency, competency table |
| `src/pages/Lesson.tsx` | Lesson player (6 steps), result and mistake analysis, spaced-review session |
| `src/components/LessonExercise.tsx` | Stimulus view (text, audio, scene SVG, transcript after answering) and the 4 exercise UIs |
| `scripts/learn-test.ts` | 24 unit tests |

### Code changed (additive)

| File | Change |
|---|---|
| `shared/types.ts` | Adds `Db.lessons` (progress, stored in `progress.json`), plus `PlanBlock.kind`, `reason`, `lessonId` and `Dashboard.learning`. |
| `server/db.ts` | Empty `lessons: {}`. Old data files load with `lessons` defaulted through the existing `merge()`. |
| `server/index.ts` | Mounts the Learn router. `/api/dashboard` and `/api/plan` now use `buildLearningPlan`. The tutor injects lesson context. `/api/mistakes` rebuilds re-answerable questions for lesson mistakes. Admin audio generation includes lesson clips. Library reload also reloads the curriculum. |
| `server/prompts.ts` | Tutor system prompt adds Learn Mode rules: no answer reveal before the learner answers, a follow-up check question, and using the lesson's technique. |
| `server/audio.ts` | `lessonAudioSet` / `lessonAudioStatus` / `lessonAudioKeys`: each lesson's audio stimuli become a synthetic set, so the existing hashing, manifest and resume logic apply. |
| `scripts/audio-generate.ts` | Includes lesson clips; `--lessons` limits generation to them. |
| `scripts/content-validate.ts` | Validates lessons and prints the curriculum summary. |
| `scripts/smoke-test.ts` | Learn Mode end-to-end checks (§8). |
| `src/App.tsx` | Nav grouped into "Học — Learn" and "Luyện thi — Practice"; adds `/learn` routes. |
| `src/pages/Dashboard.tsx` | Today's plan with kind badges and per-block reasons; "what to learn next"; blockers; improvements; mastery bars. |
| `src/pages/Admin.tsx` | New "Bài học (Learn)" tab: per-lesson status, review notes, audio, issues. |
| `src/styles.css` | Learn Mode styles and mobile fixes (§9). |
| `package.json` | Scripts `test:learn` and `test`. **No new dependencies.** |

### API (all local, no AI)

| Endpoint | Purpose |
|---|---|
| `GET /api/curriculum` | Modules with per-lesson status, mastery, lock state and next review, plus recommendations, blockers, improvements, mastery by skill, competencies, consistency, review schedule and counts. |
| `GET /api/lessons/:id` | Lesson with resolved audio URLs, transcripts and scene SVGs, plus progress and missing prerequisites. |
| `POST /api/lessons/:id/start` `{restart?}` | Start, resume, or start a fresh pass. History, mastery and schedule are kept. |
| `POST /api/lessons/:id/step` `{step, timeSec}` | Move to a step and record active time. |
| `POST /api/lessons/:id/answer` `{exerciseId, response, timeSec}` | Graded server-side and stored. |
| `POST /api/lessons/:id/complete` | Mastery check, outcome, misconception analysis, SM-2 schedule, lesson mistakes into the notebook. |
| `GET/POST /api/lessons/:id/review` | Spaced-review quiz (previous errors first) and its submission. |
| `POST /api/lessons/:id/vocab` | Adds lesson expressions to the vocabulary SRS (no AI). |
| `GET /api/coach` | Recommendations summary. |
| `GET /api/admin/curriculum`, `POST /api/admin/curriculum/reload` | Admin view and reload of the curriculum. |

### Storage separation

- Curriculum content lives in `content/lessons` (git).
- Lesson progress lives in `$DATA_DIR/progress.json` under the key `lessons`.
- AI data stays in `ai.json`. A unit test asserts that `lessons` is not written to `ai.json`.

---

## 3. Real content counts

Produced by `npm run content:validate` and by a counting script over `content/lessons/**/*.json`:

| | Reading | Listening | Speaking | Writing | **Total** |
|---|---|---|---|---|---|
| Lessons planned / written / active (approved + valid) | 15/15/15 | 15/15/15 | 15/15/15 | 15/15/15 | **60/60/60** |
| Guided exercises (with hints) | 63 | 62 | 60 | 61 | **246** |
| Independent exercises (mastery check) | 120 | 120 | 115 | 114 | **469** |
| All exercises | 183 | 182 | 175 | 175 | **715** |
| Worked examples | 35 | 34 | 39 | 40 | **148** |
| Concept text (whitespace tokens*) | 8,821 | 9,713 | 8,695 | 9,190 | **36,419** |
| Sum of estimated lesson minutes | 455 | 477 | 485 | 473 | **1,890** (~31.5 h) |

\* A Vietnamese syllable counts as one token, so the real number of English-equivalent words is lower.

| Other content | Count |
|---|---|
| Exercise types: `choice` / `text` / `order` / `produce` | 522 / 114 / 48 / 31 |
| Misconceptions (mistake-analysis entries) | 295 |
| Linked vocabulary expressions | 537 |
| Grammar points | 87 |
| Speaking examples with weak / acceptable / Level 8 versions | 15 (≥ 1 per speaking lesson) |
| Writing examples with before / after versions | 30 (≥ 1 per writing lesson) |
| Speaking scene images reused (`imageRef`, practice prompts only) | 7 references |
| Library recordings reused (`audioRef`, `*-full-01` sets only) | 6 references |
| **New lesson audio clips generated** | **83 MP3s, 17 lessons, ~64.7 min, ~23.3 MB** |

### Audio and listening exercises

- All 15 Listening lessons have audio for **every** exercise.
- Lessons `sp-01` and `sp-04` each have one model-answer clip.
- The validator requires at least 70% of exercises in each Listening lesson to have an audio stimulus.
- Audio is generated once with Edge TTS (the same pipeline and voices as Phase 2): en-CA Clara/Liam, plus en-US Jenny/Guy for extra speakers.

### Mock-item reuse

Lessons never reuse mock-exam items. The validator rejects `audioRef` or `imageRef` pointing to `*-mock-*` items.

---

## 4. Validation rules (`shared/validate-lesson.ts`)

### Structure

- **Ids:**
  - Id format is `rd|ls|sp|wr-NN` and matches the folder.
  - File name is `<id>.json`.
  - Ids are unique.
- **Lesson metadata:**
  - Module and order must match `curriculum.json`.
  - Prerequisites must exist and come earlier in the same skill.
  - Competencies must be keys of `CATEGORIES[skill]`.
  - Tasks must be valid CELPIP task ids.
  - Difficulty 5–10; estimated minutes 10–45; 2–5 objectives.

### Teaching depth

- **Concept:** ≥ 3 sections and ≥ 250 tokens.
- **Examples:** ≥ 2 worked examples, each with ≥ 2 steps and a takeaway.
- **Speaking** lessons need a weak / acceptable / Level 8 comparison.
- **Writing** lessons need a before / after comparison.

### Practice sections

- **Guided:** 3–5 exercises, each with a hint.
- **Independent:** 5–10 exercises, with **no** hints.
- **Reading/Listening:** all exercises auto-graded.
- **Speaking/Writing:** ≥ 3 auto-graded independent exercises and ≥ 1 production exercise.
- **Listening:** ≥ 70% of exercises have audio.

### Per exercise

| Type | Rules |
|---|---|
| `choice` | 3–5 distinct options; valid `answerIndex`. The correct option has `misconception: null`; every wrong option maps to a defined misconception and has a `whyVi`. `evidence`, when given, must be a verbatim quote of the stimulus text or transcript. Warns if a hint contains the answer. |
| `text` | Has accepted answers. A dictation answer must be a verbatim part of an audio transcript. |
| `order` | 3–7 distinct items. |
| `produce` | 3–6 checklist items; model answer ≥ 15 words. |

### Lesson-wide

- **Misconceptions:** ≥ 2 defined, each with label, explanation and fix. Unused ones produce a warning.
- **Stimuli:** non-empty, with valid voices. `audioRef` must point to an active library set and chunk. `imageRef` must point to a speaking prompt with an SVG. Mock items are rejected. Unused stimuli produce a warning.
- **Mastery thresholds:** 0 < review < advance ≤ 1.
- **Vocabulary:** ≥ 4 entries.
- **Grammar:** ≥ 1 point for Speaking/Writing lessons.
- **Practice links:** routes must start with `/`.
- **Review:** `review.status` is required.
- **Cross-lesson:** duplicate exercises (prompt + stimulus + options) are rejected.

### Limits of validation

- Passing validation means the lesson is well-formed and consistent. It does **not** prove teaching quality; that is what the review in §5 is for.

---

## 5. Authorship: AI-generated vs independently reviewed

**All 60 lessons are AI-generated.** They were authored in 12 parallel batches of 5 by Claude (Opus) subagents, following `LESSON_GUIDE.md`. No lesson was written by a human, and no human has reviewed them.

**All 60 were then reviewed by a separate Claude subagent per batch**, which never wrote that batch. Each reviewer:
- solved every exercise from the stimulus or transcript **before** looking at the key;
- checked evidence quotes, hints, Vietnamese, CELPIP/BC facts, model-answer length versus speaking time, and SVG details against the picture markup;
- fixed problems with minimal edits;
- re-ran validation;
- set `review.status = "approved"` and `reviewedBy = "author-agent+independent-review-agent"`, with notes in each file.

**Result:** 60/60 approved, 0 left as draft. The `notes` field of every lesson file records what was checked and fixed.

### What the reviews found and fixed (aggregated from the 12 review reports)

**Answer keys:**
- No multiple-choice key pointed at a wrong option.
- 4 items had **a second defensible answer** or an ambiguous order and were fixed:
  - `rd-07 i3`
  - `sp-13 g2` (two valid orders)
  - `wr-12 g2`
  - `wr-14 g3`
- Several correct options were reworded so they no longer overclaim:
  - `ls-14 g3`: "supports" changed to "no objection".
  - `ls-14 i7`: "gently", which is not audible, was removed.
  - `rd-11 i8`
  - `rd-12 i7`
  - `rd-10 i7`
- 2 accepted typed answers that contradicted the lesson were **removed**:
  - `sp-15 i1` "kids"
  - `sp-15 i3` "was"
- More accepted answers were **removed**:
  - `ls-03 i4` "a couple", for the same reason.
  - The misspellings "toony" and "tooney" in `ls-04 g3`.
- **Accepted variants added** to about 30 exercises, where a correct answer would have been marked wrong (number, date and currency formats, synonyms).

**False or risky claims corrected:**
- ls-09 said CELPIP shows questions before the audio. They appear after it.
- Several claims about real BC towns or programs were made generic or fictional.
- ICBC insurance wording.
- BC Day is in August.
- The Swartz Bay ferry claim.
- A CPR / heart-attack wording.
- An arithmetic error in `sp-02 i6`.
- A grammatical sentence that was shown as an error.
- A phonetics error (flap t).

**Concept text:** in ls-07, ls-08, ls-09 and ls-10, concept or example text that revealed exercise answers was replaced.

**Hints:** 13 hints that gave the answer away were rewritten.

**Audio limitations (TTS):** items that required *hearing* reductions, contrastive stress or intonation (ls-03, ls-05) were rewritten so they are answerable by the rule taught, because TTS prosody is neutral.

**Content fixes:**
- Model answers were trimmed so they fit the speaking time: about 120–150 words for 60 s and 170–210 words for 90 s.
- Writing models were kept within the stated word limits.
- Dialogue logic was fixed:
  - `ls-08` moving day
  - `ls-05` "beach"
- Duplicates of earlier lessons were rewritten:
  - `wr-13 i2`
  - `wr-14 i2`
- The wr-14 proofreading draft, its error list and its corrected model were reconciled.
- About 30 misconception mappings on wrong options were tightened.

**Caveat:** both the authoring and the review are AI work. An AI reviewer can miss errors that a human teacher would catch. Treat "approved" as "independently AI-reviewed", not as "human-certified". A human spot check is recommended (§10).

---

## 6. What works offline vs what needs Gemini

| Feature | Without `GEMINI_API_KEY` |
|---|---|
| Whole curriculum: lessons, examples, guided/independent practice, grading, explanations, mistake analysis, mastery decision | ✅ Works fully offline (local grading) |
| Spaced lesson reviews, adding lesson expressions to the SRS, lesson mistakes in the mistake notebook | ✅ |
| Coach recommendations, daily learning plan, blockers, improvements, mastery and consistency views | ✅ Rule-based |
| Lesson audio | ✅ Pre-generated and bundled; no key, no TTS at runtime |
| Practice Mode, mock exams, analytics, vocabulary (Phase 2) | ✅ (unchanged) |
| AI Tutor (lesson-aware hints, explanations, follow-up questions, sentence improvement) | ❌ Needs Gemini. Used **only when the learner presses** 💬, "Hỏi AI gợi ý" or "Hỏi AI tutor". |
| AI evaluation of Writing/Speaking (Practice Mode) | ❌ Needs Gemini (unchanged) |
| Production exercises in lessons | ✅ Self-assessed against a checklist, with a model answer shown. AI feedback is optional, through the tutor. |

**Gemini is never called when a lesson is opened or answered.** The smoke test runs the whole lesson flow with an empty key.

---

## 7. Mastery, scoring and scheduling rules (for verification)

### Scoring each exercise

| Type | Rule |
|---|---|
| Choice | 1 or 0 |
| Exact text | Normalized match: case, the punctuation `.,!?;:"()`, curly apostrophes and dashes are ignored. Hyphens and straight apostrophes are kept. |
| Dictation | Word-level LCS accuracy. Words typed beyond the sentence length are penalised by 0.5 each. **≥ 0.9 counts as correct.** |
| Order | Fraction of items in the correct position; correct only if the whole order is exact. |
| Produce | Checked checklist items ÷ total, and 0 if the response has fewer than 5 words. Counts as correct if ≥ 0.75. |

### Mastery score

- The mastery score is the mean over **independent** exercises; unanswered exercises score 0.
- When a lesson has production exercises, auto-graded items weigh 75% and production items 25%. This means the learner cannot reach "mastered" through self-assessment alone.

### Outcome

| Score | Outcome | Status |
|---|---|---|
| ≥ 0.8 (`mastery.advance`) | advance | mastered |
| ≥ 0.6 (`mastery.review`) | review | needs_review |
| below 0.6 | repeat | needs_review |

- A lesson unlocks the lessons that list it as a prerequisite once an outcome of "advance" or "review" is reached.
- Prerequisites are **advisory**: locked lessons show 🔒 but can still be opened.

### Spaced review

- Uses the existing SM-2 (`reviewSrs`).
- Quality is mapped from the score: ≥ 0.9 → 5, ≥ 0.8 → 4, ≥ 0.6 → 3, ≥ 0.4 → 2, otherwise 1.
- Intervals grow 1 → 3 → ≈ 8 days, and a failed review resets the interval to 1 (tested).
- A mastered lesson whose review is due shows as "Cần ôn" (needs review).
- The review quiz has 5 auto-graded independent exercises, previously wrong ones first, rotated across reviews.

### Coach priority

| Priority | Rule |
|---|---|
| 100 | Resume an unfinished pass |
| 90+ | Due review |
| 85 | Repeat a failed lesson |
| 80+ | **Remediation**: a competency with ≥ 5 practice items and < 65% accuracy → teach the earliest unfinished lesson for that competency. If all of them are completed, assign an applied drill instead. |
| 78 | Trap-habit rule: word-match / partially-true traps chosen ≥ 3 times → paraphrase or distractor lesson |
| 40 + skill priority | Next lesson. Skill priority = gap × 8 + 4 (Reading/Listening) + 1.2 × days since the last lesson in that skill (capped at 7). |
| 35 | Applied practice after a recent mastery |

**Every recommendation carries a Vietnamese reason string.**

### Daily plan composition

Blocks are added in this order:
1. A lesson, split into "Học" (learn) and "Luyện có hướng dẫn + kiểm tra" (guided practice + mastery check).
2. Due lesson reviews.
3. Vocabulary review.
4. Applied practice (≥ 60 min plans).
5. Mistake review.
6. A second lesson in another skill (≥ 90 min plans).
7. Exam practice (120 min, or once a week at ≥ 60 min).
8. The existing Practice planner fills the remaining time with blocks of ≥ 8 min.

Phase-4 mock days are kept. Lesson blocks tick themselves once the pass or review is done that day.

---

## 8. Tests actually run (latest run, this commit)

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run test:learn` | ✅ **24 passed, 0 failed** |
| `npm run test:smoke` | ✅ **45 passed, 0 failed** (35 Phase-2 checks + 10 Learn Mode checks) |
| `npm run content:validate` | ✅ 0 errors, 0 warnings. 60/60 lessons active. Lesson audio 83/83 clips. Practice listening audio 24/24. |
| `npm run build` | ✅ |

### `test:learn` covers

- **Grading of all 4 types:** curly apostrophes, the dictation threshold and missing words, order partial credit, production checklist.
- **Outcome thresholds** at their boundaries.
- **Mastery weighting**, including unanswered = 0.
- **Progression:**
  - start → steps → answer → resume keeps answers → complete;
  - time tracking;
  - restart keeps history and schedule;
  - prerequisite unlocking with repeat vs review.
- **Lesson mistakes** go to the notebook without duplicates.
- **SM-2 scheduling:** 1 → 3 → ≥ 7 days, reset on a failed review, due-status display, review quiz ordering.
- **Coach rules:**
  - with no data, a Reading lesson comes first;
  - failing inference in practice (2/8) → inference lesson before more practice;
  - once that lesson is mastered and practice is still weak → applied drill instead;
  - resume > due review.
- **Daily plan** at 30/60/90/120: totals exact, always contains learn and guided blocks, practice/exam < 70% of the time, a second skill at ≥ 90 min.
- **Progress views** contain only real data.
- **Validator:** accepts a complete lesson; rejects thin lessons and hints in independent exercises; enforces curriculum order.
- **Persistence:** lesson progress is written to `progress.json`, not `ai.json`.

### `test:smoke` Learn Mode checks

The real server is run with no API key and a temporary `DATA_DIR`. It checks:
- the curriculum lists 60/60;
- a lesson opens without AI;
- a guided answer is graded locally;
- the plan resumes the unfinished lesson;
- **after a server restart** the unfinished lesson resumes at the same step, with its answer kept;
- a full independent pass gives mastered plus a scheduled review;
- lesson expressions are added to the SRS;
- the coach moves on to a different lesson;
- the tutor without a key returns a clean SSE error and the server stays healthy.

### Additional manual checks (not automated)

1. **Fresh-deploy simulation** (empty `DATA_DIR`): all 89 audio stimuli in lessons (83 new clips + 6 `audioRef`) resolve to a URL and are served (HTTP 200, > 5 KB each) from the bundled `audio-assets/`.
2. **Mobile layout** at 375 px, emulated through the Chrome DevTools protocol in headless Edge:
   - `document.scrollWidth` equals 375 (no horizontal page scroll) on `/`, `/learn`, `/learn/rd-08`, `/learn/sp-08`, `/analytics` and `/mistakes`.
   - Only the nav bar and the lesson step bar scroll horizontally, by design.
   - Before the fix, `/` and `/learn` were 655 px wide.

---

## 9. Known limitations

1. **Content is AI-authored and AI-reviewed** (§5). No human teacher has checked it.
2. **TTS prosody is neutral.** Lessons on stress, intonation and connected speech teach those features, but the audio does not reliably model them, so those exercises are rule-based.
   - Two of five voices are US.
   - Edge TTS is an unofficial service. Already-generated clips are unaffected.
3. **Production exercises are self-assessed.** The 25% weighting cap (§7) limits their effect on mastery, but they are honest-system scores. Pronunciation is not assessed.
4. **The text grader is strict about spelling:** "wont" does not match "won't". Accepted variants were widened by reviewers, but uncommon correct phrasings can still be marked wrong.
5. **Time per lesson is client-reported** active time, capped at 15 min per interval.
6. **Lesson mastery is not a CELPIP score,** and the UI says so. Practice estimates remain rough (Phase 2 caveat).
7. **The coach's weights are hand-set heuristics** (§7), not tuned on learner data.
8. **Curriculum size:** 60 lessons (~31 h estimated). Lessons cannot yet be added through the Admin pipeline; they are authored as files.
9. **Lesson mistakes with audio** are not re-shown as text cards in the mistake notebook, since they need the clip. They are reviewed through the lesson's spaced review instead.

---

## 10. Untested functionality (please audit)

- **AI Tutor with a real Gemini key:** whether it actually withholds answers before the learner answers, asks follow-up questions and stays on the lesson. Only the context assembly (`lessonTutorContext`) and the no-key error path were exercised.
- **Browser speech recognition** in speaking production exercises (needs a real microphone, Edge/Chrome).
- **Listening quality:** no human has listened to the 83 lesson clips. Only programmatic checks were done (generated, 0 failures, served, size).
- **Teaching quality and difficulty calibration** with a real learner, and whether mastery scores predict CELPIP improvement.
- **The full UI flow in a real browser by a human:** only automated API flows and screenshots were verified.
- **Long-running behaviour:** reviews over weeks; plan rotation across skills over many days.
- **Railway deploy** of this commit. It is expected to work the same as Phase 2: no new dependencies, bundled audio is about 45 MB in total.

### Suggested spot checks

```
npm run content:validate -- --filter ls-08     # one lesson's issues
npm run test:learn && npm run test:smoke
```

Then:
- Open `/learn/rd-08`, `/learn/ls-07` and `/learn/sp-13` and complete a pass.
- Review any lesson's `review.notes` field.
