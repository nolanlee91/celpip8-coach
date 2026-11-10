# CELPIP 8 Coach: audit report

This is the single, current audit document for the repository. It replaces all earlier audit files. It is written for an independent reviewer (Codex) and covers the whole app as of the latest commit on `main`, built in five stages:

1. offline-first content library;
2. Learn Mode with coaching;
3. interface redesign and mobile support;
4. guided onboarding and clear learning navigation;
5. a tripled practice library (288 items, 6 mock exams), read-aloud audio and Vietnamese translations for every passage (§13).

| | |
|---|---|
| **Repository** | https://github.com/nolanlee91/celpip8-coach |
| **Stack** | React 19 + Vite 8, Express 5 + `tsx`, TypeScript, Google Gemini via `@google/genai` (optional) |
| **Learner** | Vietnamese adult in British Columbia. Official CELPIP-General scores (April 2026): Listening 6, Reading 5, Writing 7, Speaking 6. Target: 8 or higher in every skill. |
| **Code size** | 12,104 lines in `server/`, `shared/`, `scripts/` and `src/` |

**Ground rules for this report:**
- Every number was produced by a script or command output.
- Anything not exercised by a test is listed in §12 (Untested).

---

## 1. Summary

| Area | Status |
|---|---|
| **Practice Mode:** Reading, Listening, Writing, Speaking, mock exams | Works offline from a prebuilt library of 288 items (tripled in stage 5) + 1,000 vocabulary entries + 6 mock-exam packages |
| **Learn Mode:** structured curriculum | 60 lessons (15 per skill), 715 exercises, all approved and valid |
| **Coach:** what to learn next, daily plan | Rule-based, no AI; explains each choice in Vietnamese |
| **Mastery and spaced review** | SM-2 for lessons, mistakes and vocabulary |
| **Listening audio** | 113 MP3 files (30 for practice sets, 83 for lessons), bundled in the repo |
| **AI (Gemini)** | Optional. Used only for the AI Tutor, Writing/Speaking evaluation on request, and admin content generation. |
| **Interface** | Redesigned; bottom tab navigation on phones; no horizontal scroll at 375 px |
| **Guided navigation** | 3-step onboarding for new learners; one dominant "do this now" action on the dashboard; a "next step" on every result screen; dismissible first-visit help; a "Bắt đầu từ đâu?" page |
| **Tests** | Typecheck OK; `test:learn` 30/30; `test:smoke` 55/55; content validation 0 errors / 0 warnings; build OK |

**Not yet done:**
- No human has reviewed the content or listened to the audio.
- The AI Tutor has not been tested with a live Gemini key.
- The app has not been tested on a real phone.

---

## 2. Architecture

| Layer | Contents | Location | Needs AI? |
|---|---|---|---|
| **A. Practice library** | Reading/Listening sets, Writing/Speaking prompts with Level 8 model answers, vocabulary, mock-exam packages | `content/` (git) + `$DATA_DIR/library/` (admin-imported) | No |
| **A2. Curriculum** | `content/lessons/curriculum.json` (13 modules) + 60 lesson files + `LESSON_GUIDE.md` | `content/lessons/` | No |
| **B. Engine** | Selection, local scoring, mistakes, SM-2, adaptive difficulty, planner, analytics, lesson progress, mastery, coach | `server/selection.ts`, `analytics.ts`, `learn.ts`, `coach.ts` | No |
| **C. AI assistance** | Tutor, Writing/Speaking evaluation on request, admin generation and review | `server/ai.ts`, `prompts.ts`, `pipeline.ts` | Gemini |
| **D. Audio** | Pre-generated MP3s + `manifest.json` | `audio-assets/` (bundled) + `$DATA_DIR/audio-assets/` (generated later) | Edge TTS, once, at build time |

### Storage

| File | Contents |
|---|---|
| `$DATA_DIR/progress.json` | Settings, attempts, mistakes, vocabulary notebook, plans, mock exams, **lesson progress** (`lessons`) |
| `$DATA_DIR/ai.json` | AI evaluations, pending submissions, AI usage log, evaluation cache |

**Migration:** a legacy `db.json` is split into the two files on first start, and a backup is kept as `db.json.migrated-<timestamp>`.

**Persistence on Railway:** `DATA_DIR=/data` must point to a mounted volume.

### Key files

**Server:**

| File | Role |
|---|---|
| `server/index.ts` | Express app and routes; HTTP Basic auth via `APP_PASSWORD` |
| `server/library.ts`, `shared/validate.ts` | Load and validate the practice library; only approved, error-free items are active |
| `server/lessons.ts`, `shared/validate-lesson.ts` | Load and validate the curriculum (§5) |
| `shared/curriculum.ts` | Lesson schema + pure grading functions |
| `server/learn.ts` | Lesson pass lifecycle, mastery score, outcome, misconception analysis, SM-2 lesson review, lesson mistakes into the notebook |
| `server/coach.ts` | Competency profile, recommendations, blockers, improvements, consistency, daily learning plan |
| `server/learn-routes.ts` | Learn Mode API and tutor lesson context |
| `server/selection.ts` | Practice exercise selection and mock package availability |
| `server/audio.ts` | TTS batch pipeline: Edge (default, parallel) or Gemini; hash-named files; lesson clips handled as synthetic sets |
| `server/pipeline.ts` | Admin generation jobs: drafts, validation, AI review, approval, import |

**Frontend:**

| Area | Files |
|---|---|
| Learn Mode | `src/pages/Learn.tsx` (curriculum map), `Lesson.tsx` (6-step player, result, spaced review), `components/LessonExercise.tsx` (4 exercise types) |
| Shell and hubs | `src/App.tsx` (desktop rail + mobile top bar and tab bar), `pages/Hubs.tsx` (Luyện thi and Thêm pages), `components/Icon.tsx` (Lucide icons, inline) |
| Dashboard | `src/pages/Dashboard.tsx` (today's plan as a timetable) |

**Scripts:**
- `content:validate`, `content:generate`, `content:review`, `content:import`
- `audio:generate`
- `test:learn`, `test:smoke`, `test`

**Dependencies:**
- Runtime: `@google/genai`, `express`, `msedge-tts`, `react`, `react-router-dom`, `recharts`, `dotenv`, `tsx`, `vite`.
- The interface redesign and Learn Mode added no dependencies.

---

## 3. Content: exact counts

All counts come from `npm run content:validate` (0 errors, 0 warnings) and counting scripts.

### 3.1 Practice library (all active)

| Item | Count | Detail |
|---|---|---|
| Reading sets | **84** | R1–R4: each part has 9 full, 6 mock and 6 drill sets. **716 questions.** |
| Listening sets | **72** | L1–L6: each part has 4 full, 6 mock and 2 drill sets. **436 questions.** |
| Writing prompts | **36** | W1/W2: 12 practice + 6 mock each, with model response, structure, expressions and common mistakes |
| Speaking prompts | **96** | S1–S8: 6 practice + 6 mock each; 36 hand-drawn SVG scenes (S3/S4/S8) |
| Vocabulary entries | **1,000** | 13 topics, 76–77 each; difficulty 5: 70, 6: 273, 7: 350, 8: 239, 9: 68; 1,000 unique terms |
| Mock-exam packages | **6** | Each has 6 L + 4 R + 2 W + 8 S |

**Progress toward long-term targets:**

| Skill | Current | Target |
|---|---|---|
| Reading sets | 84 | 200 |
| Listening sets | 72 | 150 |
| Writing prompts | 36 | 100 |
| Speaking prompts | 96 | 160 |
| Vocabulary | 1,000 | 2,000 |

### 3.2 Learn Mode curriculum (60/60 active)

| | Reading | Listening | Speaking | Writing | **Total** |
|---|---|---|---|---|---|
| Lessons | 15 | 15 | 15 | 15 | **60** (13 modules) |
| Guided exercises (with hints) | 63 | 62 | 60 | 61 | **246** |
| Independent exercises (mastery check) | 120 | 120 | 115 | 114 | **469** |
| Worked examples | 35 | 34 | 39 | 40 | **148** |
| Concept text (whitespace tokens)* | 8,821 | 9,713 | 8,695 | 9,190 | **36,419** |
| Estimated lesson time (minutes) | 455 | 477 | 485 | 473 | **1,890** (~31.5 h) |

\* A Vietnamese syllable counts as one token.

**Other curriculum content:**

| Item | Count |
|---|---|
| Exercise types: choice / text / order / produce | 522 / 114 / 48 / 31 |
| Misconceptions (mistake-analysis entries) | 295 |
| Linked vocabulary expressions | 537 |
| Grammar points | 87 |
| Speaking examples with weak / acceptable / Level 8 versions | 15 |
| Writing examples with before / after versions | 30 |
| Reused speaking scenes (`imageRef`, practice prompts only) | 7 |
| Reused library recordings (`audioRef`, full sets only) | 6 |

Lessons never reuse mock-exam items; the validator enforces this.

---

## 4. How the content was produced and reviewed

### Authorship

- **All content is AI-generated.** Claude agents wrote it following `content/CONTENT_GUIDE.md` (library) and `content/lessons/LESSON_GUIDE.md` (lessons).
- No item was written by a human.
- **No human has reviewed any item.**

### Independent AI review

Every item was reviewed by a separate Claude agent that did not write it. Reviewers:
- solved every question from the text or transcript before looking at the key;
- checked evidence quotes, distractors, hints, the Vietnamese explanations, CELPIP and BC facts, model-answer length against speaking time, and SVG scenes against their actual drawing;
- fixed problems with minimal edits and re-ran validation.

Every file's `review.notes` records what was checked and fixed.

| Batch | Result | Answer keys |
|---|---|---|
| Practice library (96 items) | 96/96 approved | No wrong key among 377 Reading/Listening questions |
| Curriculum (60 lessons, 12 batches) | 60/60 approved | No choice key pointed at a wrong option |

### Problems the reviews found and fixed (representative)

**Ambiguous or overclaimed answers:**
- Items with a second defensible answer or an ambiguous order:
  - Library: r2-drill-01 Q4, r3-drill-01 Q5.
  - Lessons: rd-07 i3, sp-13 g2, wr-12 g2, wr-14 g3.
- Correct options that overclaimed: ls-14 g3 and i7, rd-11 i8, rd-12 i7, rd-10 i7.

**Accepted typed answers:**
- Answers that contradicted the lesson were removed: sp-15 i1 and i3, ls-03 i4, and misspellings in ls-04 g3.
- Correct variants were added to about 30 exercises (number, date and currency formats, synonyms).

**False or risky claims:**
- About CELPIP: ls-09 said questions appear before the audio; they appear after it.
- About BC:
  - The volunteer record check fee; it is free.
  - The strata vote threshold for EV chargers.
  - The rule on transferring prescriptions.
  - ICBC insurance wording.
  - BC Day is in August.
  - A Swartz Bay ferry claim.
  - Invented events attached to real towns, which were made fictional.
- Other errors:
  - Arithmetic errors.
  - A grammatical sentence shown as an error.
  - A phonetics error.
  - Inconsistent dialogue logic (ls-08, ls-05).

**Things the learner sees before answering:**
- 13 hints that gave the answer away.
- Concept or example text that revealed exercise answers (ls-07 to ls-10).

**Audio limits:** items that relied on hearing stress, intonation or reductions were rewritten to be rule-based, because TTS prosody is neutral.

**Content fixes:**
- Speaking model answers trimmed to about 120–150 words for 60 s and 170–210 words for 90 s.
- Writing models kept within word limits.
- Scene descriptions corrected to match the SVG drawings.
- Vocabulary, first 400 entries: 137 corrected.
- Vocabulary, 600 entries added later (4 author agents, then 4 separate review agents on other batches):
  - **223 of 600 changed**, including **14 near-duplicates replaced**. For example, "convince" duplicated "persuade" and "alternate route" duplicated a synonym of "detour".
  - **Kinds of fixes:**
    - Synonyms that were only loose matches (most fixes).
    - Vietnamese in the wrong sense. For example: "học bạ" → "phiếu báo điểm", "nước sinh hoạt" → "nước uống", "gió lốc" → "trận bão gió", "thờ ơ" → "xem nhẹ".
    - Examples that gave medical advice or stated absolute legal rules.
    - Outdated or false facts. For example, Canada's children's fitness tax credit, which ended in 2017; the claim that a wire transfer is "faster than an e-transfer"; an invented regulation.
    - Inaccurate definitions (windstorm, blood pressure, housing co-op).
  - New entries focus on difficulty 7–9 and on Level 8 writing and speaking language: opinions, concession, complaints and requests.
  - **Limits:** the reviewers checked facts from their own knowledge, not against official sources. No native Vietnamese speaker has checked the translations.

**Caveat:** this is careful AI review, not expert certification. A human spot check is still recommended (§12).

---

## 5. Validation rules

### Practice library (`shared/validate.ts`)

- Required fields and unique ids.
- Answer keys:
  - exactly 4 options (R3: fixed A–E);
  - valid answer index;
  - evidence quoted verbatim from the passage or transcript.
- Part-specific blank layouts.
- No duplicate or near-duplicate questions (5-gram Jaccard similarity above 0.25 is flagged).
- Every mock-package reference must be valid.

### Lessons (`shared/validate-lesson.ts`)

**Structure:**
- Id format `rd|ls|sp|wr-NN`, matching its folder, file name and `curriculum.json` module.
- Prerequisites must come earlier in the curriculum.
- Competencies must be valid keys of `CATEGORIES`.

**Teaching depth:**
- Concept: at least 3 sections and 250 tokens.
- At least 2 worked examples, each with at least 2 steps.
- Speaking lessons need a weak / acceptable / Level 8 comparison.
- Writing lessons need a before / after comparison.

**Practice sections:**
- Guided: 3–5 exercises, each with a hint.
- Independent: 5–10 exercises, with no hints.
- Reading/Listening: every exercise is auto-graded.
- Speaking/Writing: at least 3 auto-graded exercises and at least 1 production task.
- Listening: at least 70% of exercises have audio.

**Per exercise:**
- `choice`: the correct option has no misconception; every wrong option maps to a defined misconception; evidence is verbatim.
- Dictation answers are verbatim from the transcript.
- `order`: 3–7 distinct items.
- `produce`: checklist of 3–6 items; model answer of at least 15 words.

**Lesson-wide:**
- At least 2 misconceptions.
- At least 4 vocabulary entries.
- Speaking/Writing lessons need a grammar point.
- Practice links must be valid routes.
- `review.status` is required.
- No duplicate exercises across lessons.
- No reuse of mock-exam items.

**Limit:** validation proves structure and consistency, not teaching quality.

---

## 6. Learning engine rules (for verification)

### Grading (`shared/curriculum.ts`)

| Type | Rule |
|---|---|
| Choice | 1 or 0 |
| Exact text | Normalized match: ignores case, `.,!?;:"()`, curly quotes and dashes. Hyphens and straight apostrophes are kept. |
| Dictation | Word-level LCS. Words beyond the sentence length cost 0.5 each. **0.9 or above is correct.** |
| Order | Credit by position; full credit only for the exact order |
| Produce | Self-assessed checklist ratio; 0 if the response has fewer than 5 words; 0.75 or above counts as correct |

### Mastery

- The score is the mean of **independent** exercises; unanswered ones count as 0.
- When a lesson has production tasks, auto-graded items weigh 75% and production 25%.

| Score | Outcome |
|---|---|
| 0.8 or above | **advance** (mastered) |
| 0.6 or above | **review** |
| below 0.6 | **repeat** |

- Prerequisites unlock at "advance" or "review". They are advisory: locked lessons can still be opened.

### Spaced review

- Uses the existing SM-2 `reviewSrs`.
- Quality from score: ≥ 0.9 → 5, ≥ 0.8 → 4, ≥ 0.6 → 3, ≥ 0.4 → 2, otherwise 1.
- Intervals 1 → 3 → about 8 days; a failed review resets to 1.
- A review quiz has 5 exercises, previous errors first.
- Wrong lesson answers become mistake cards.

### Coach priorities (`server/coach.ts`)

| Priority | Rule |
|---|---|
| 100 | Resume an unfinished lesson |
| 90+ | Due lesson review |
| 85 | Repeat a failed lesson |
| 80+ | **Practice-driven remediation:** at least 5 items and under 65% accuracy in a competency → teach that competency's lesson before assigning more practice. If the lesson is already mastered, give an applied drill instead. |
| 78 | Trap-habit rule (word-match or partially-true distractors chosen 3+ times) |
| 40 + skill priority | Next lesson. Skill priority = gap × 8, + 4 for Reading/Listening, + 1.2 per day since that skill was last studied (capped at 7). |
| 35 | Applied practice after a mastered lesson |

### Daily plan (30/60/90/120 min)

Blocks are added in this order:
1. A lesson, split into learning and guided practice.
2. Due lesson reviews.
3. Vocabulary.
4. Applied practice (60 min or more).
5. Mistake review.
6. A second lesson in another skill (90 min or more).
7. Occasional full-length part (120 min, or weekly).

Remaining time is filled by practice blocks of at least 8 minutes. Phase-4 days include mock exams. Lesson blocks tick themselves when completed.

### Dates

Timestamps are stored in UTC. Everything that groups activity by day compares **local** days through `dayOf()` in `server/db.ts`. This covers:
- plan ticks;
- streak and weekly consistency;
- "mastered this week";
- recency in selection;
- weekly analytics.

Before this fix, the code compared UTC dates. Evening study in BC (UTC−7/−8) could then count as the next day, and the plan blocks did not tick. A unit test found it at an evening hour. Only the AI-usage-by-day table still groups by UTC date.

### Practice Mode

- Selection: weakest task, difficulty target, unused or least-recently-used sets, 7-day recency.
- Adaptive difficulty: range 5–10.
- Listening sets without audio are marked pending and excluded, never turned into text. Browser TTS is an explicit, labelled opt-in.

---

## 7. Audio

| | Practice sets | Lessons | Total |
|---|---|---|---|
| MP3 files | 30 (24 sets, 24/24 ready) | 83 (17 lessons) | **113** |
| Duration | ~59 min | ~64.7 min | ~124 min |
| Size | ~21 MB | ~23 MB | ~43 MB (bundled in `audio-assets/`) |

**Generation:**
- Provider: Edge TTS (`msedge-tts`), MP3 at 24 kHz / 48 kbps mono, parallel workers.
- Voices: en-CA Clara and Liam, plus en-US Jenny and Guy for extra speakers.
- One request per segment, joined with silent MPEG frames, so segment offsets are exact.
- File names include a hash of the script and voices, so editing a script marks that file for regeneration.
- Generation runs: practice sets 0 failures; lessons 83/83, 0 failures.

**Verification:**
1. All 30 practice MP3s were decoded in headless Edge. Decoded durations match the manifest within 0.05 s.
2. Fresh-deploy simulation (empty `DATA_DIR`): all 89 audio stimuli in lessons (83 new clips + 6 reused) resolve to a URL and are served from the bundled folder.

**Caveats:**
- Edge TTS is an unofficial service; generated files are unaffected if it changes.
- TTS prosody is neutral.
- No human has listened to the audio.
- The Gemini TTS path is untested.

---

## 8. Works offline vs needs Gemini

**Works without any API key:**
- **Practice Mode:** Reading, Listening (all sets have audio), Writing/Speaking (the response is saved and the model answer shown immediately), mock exams that start instantly.
- **Learn Mode:** all 60 lessons, local grading, explanations, mistake analysis, mastery, spaced review.
- **Coach:** recommendations and daily plan.
- **Review and data:** vocabulary (1,000 library entries, SM-2), mistake notebook, analytics, export/import.

**Needs Gemini** (only when the learner presses a button):

| Feature | Trigger |
|---|---|
| AI Tutor | Tutor button. In lessons, the tutor receives the lesson, the current exercise and the learner's answer. |
| Writing/Speaking evaluation | "Nhận xét bằng AI" |
| Vocabulary AI lookup | Explicit option |
| Admin content generation and AI review | Admin action |

**Cost controls:**
- Configurable model (default `gemini-2.5-flash`).
- Token usage log.
- 60-second back-off after a 429.
- Evaluation cache.
- Manual retry.
- Availability status shown in Settings and Admin.

---

## 9. Interface and mobile

The design guidance came from Anthropic's `frontend-design` skill and the open-source Impeccable skill (read as guidance only; its bundled binary was not run).

**Visual system:**
- Deep teal navigation rail on a cool off-white ground.
- **Be Vietnam Pro** for the interface; **Source Serif 4** for English study texts. Both are self-hosted in `public/fonts`, SIL Open Font License 1.1.
- Flat bordered panels.
- Themed focus rings, selection and scrollbars.
- Dark mode via `prefers-color-scheme`.

**Removed generated-UI patterns:**
- About 160 emoji used as icons, replaced by an inline Lucide icon set (ISC License).
- Uppercase eyebrow labels.
- Thick coloured left borders.
- Arrows appended to button text.
- "A — B" label strings in coach copy.
- Identical shadowed card stacks.

**Dashboard:** today's plan is drawn as a timetable with minute marks and one coloured line per skill. The next block is opened up with its reason and actions; the other blocks are compact, with a tick button.

**Mobile (≤ 760 px):**
- Bottom tab bar (Hôm nay, Lộ trình, Luyện thi, Từ vựng, Thêm) and a top bar with the tutor button.
- Hub pages for Practice and More.
- Touch targets of at least 44 px.
- Sticky Back / step / Next bar in lessons.
- Full-screen tutor sheet.
- Safe-area insets.

**Verified (Chrome DevTools protocol emulation at 375 px, headless Edge):** `document.scrollWidth` = 375 on `/`, `/learn`, `/learn/rd-08`, `/learn/sp-08`, `/analytics` and `/mistakes`. Screenshots were reviewed for the dashboard, lessons and Learn page on desktop and mobile.

**Not verified:**
- A real phone, iOS Safari.
- Touch gestures.
- The practice pages beyond the shared restyle; they were not individually redesigned.

---

## 10. Onboarding and guided navigation

**Goal:** a first-time learner knows what to do within seconds of opening the dashboard.

### Onboarding (`src/components/Guide.tsx`, `POST /api/onboarding`)

Three steps:
1. **Starting point:** scores pre-filled (L6 / R5 / W7 / S6, target 8), all editable. The learner is told that the two weakest skills get more time first. Saving the scores re-runs the existing `adjustedWeights`, so the weakest skills get a larger share.
2. **Study time:** 30 / 60 / 90 / 120 minutes, saved to `settings.dailyMinutes`.
3. **How learning works:** Học, Luyện thi, Ôn tập, Huấn luyện viên.

The final button **"Bắt đầu bài học đầu tiên"** opens the first lesson recommended by the coach (`/api/coach`). No lesson id is hard-coded.

**Behaviour:**
- Back and Skip work; Escape also skips.
- Each step is saved on the server (`settings.onboarding.step`).
- Finishing or skipping sets `completed: true`, after which the guide is never shown automatically again.
- It can be reopened from **Cài đặt** or **Bắt đầu từ đâu?**.

**Existing users:** `merge()` in `server/db.ts` marks the guide as done (`reason: "existing-user"`) for data saved before this feature when the learner already has attempts or lesson progress. A data file with no activity shows the guide. No learning data is changed.

**Mobile:** full-screen sheet, 2-column score inputs, buttons in thumb reach; the final button takes the full width.

### Dashboard: one primary action (`coach.primaryAction`)

The dashboard now has a single dominant panel at the top. It answers: what to do now, why, how long, and what happens next.

It is a view over the **existing** `recommendations()`, not a second engine.

| State | Headline |
|---|---|
| New learner | "Bắt đầu học {skill}" |
| Unfinished lesson | "Tiếp tục bài học đang dở" |
| Lesson review due | "Ôn tập kiến thức hôm nay" |
| Failed mastery check | "Học lại để nắm chắc kỹ thuật" |
| Practice shows a weakness | "Học kỹ thuật {skill} bạn đang yếu" |
| Just finished a lesson | "Chuyển sang bài học tiếp theo" |
| Curriculum finished | "Luyện dạng thi hôm nay" |

**Panel contents:**
- The title, skill and estimated time.
- A short reason, trimmed to about two sentences (`brief()`).
- One CTA button that goes straight to the activity.
- A "what happens next" line built from today's plan (`afterPrimaryVi`).

**Secondary content** (visually quieter):
- Today's plan as a timetable with tick buttons. It no longer contains competing primary buttons.
- Due reviews.
- Progress to Level 8 (score now / target, lessons mastered).
- For returning learners only: recent improvements and remaining weaknesses, with weekly goals inside a collapsed section.

**Removed from the dashboard:** charts and the weakness heatmap. They remain on the Analytics and Mistakes pages. New learners see one line instead of analytics.

### No dead ends (`coach.nextStepAfter`, `GET /api/next-step`, `components/NextStep.tsx`)

Every result screen ends with one primary next action and a secondary way home:

| After | Next step |
|---|---|
| Lesson result | The coach's next action, shown right under the score. The old competing "next" button became a quiet "Luyện thêm với bài này" card. |
| Spaced lesson review | The next action plus the next review date |
| Reading/Listening practice | If one question type was missed twice or more, the lesson that teaches it. If that lesson is already mastered, a drill. With 75% or more correct, the coach's next action. If errors are scattered, review of the questions just missed. |
| Writing/Speaking practice | Both before and after AI feedback: the coach's next action |
| Mistake review / vocabulary review | The next scheduled review date + the next action |

### Contextual help

Dismissible notes appear once, and the dismissal is saved in `settings.helpSeen`:
- **"learn":** the six lesson steps (Learn page and lesson page).
- **"practice":** how Practice differs from Learn (Practice hub, Reading, Listening, Writing, Speaking).
- **"review":** spaced repetition and the mistake notebook in simple Vietnamese (Mistakes, Vocabulary).

The **"Bắt đầu từ đâu?"** page:
- explains the workflow in five steps;
- can reopen the onboarding;
- can show the help notes again.

It is reachable from the sidebar, the mobile **Thêm** tab and **Cài đặt**.

### Verified

1. **Click-through on a fresh data directory** (Chrome DevTools protocol, 390 px, headless Edge):
   - the guide is shown;
   - Next, Back and Next again work;
   - 90 minutes is saved;
   - "Bắt đầu bài học đầu tiên" lands on `/learn/rd-01`, equal to the coach's first recommendation;
   - `completed: true, reason: "finished"`;
   - after a reload the guide is **not** shown again;
   - the dashboard shows "Bắt đầu học Reading" with its CTA visible on the first screen (49 px tall).
2. **Screenshots reviewed:** onboarding (desktop and mobile), new-learner dashboard (desktop and mobile).

---

## 11. Tests (latest run)

| Command | Result |
|---|---|
| `npm run typecheck` | ✅ 0 errors |
| `npm run test:learn` | ✅ **30 passed, 0 failed** (also run with `TZ=America/Vancouver`) |
| `npm run test:smoke` | ✅ **54 passed, 0 failed** |
| `npm run content:validate` | ✅ 0 errors, 0 warnings; 96 library items, 1,000 vocab, 2 mock packages, 60/60 lessons, lesson audio 83/83, practice audio 24/24 |
| `npm run build` | ✅ (single large JS chunk warning) |

**`test:learn` covers:**
- **Grading** of all exercise types and the outcome thresholds.
- **Mastery weighting.**
- **Lesson progression:**
  - start, steps, answers, resume, complete;
  - time tracking;
  - restart keeps history;
  - prerequisite unlocking.
- **Lesson mistakes** go into the notebook without duplicates.
- **SM-2** intervals, resets and due status, and review-quiz ordering.
- **Coach rules:**
  - no data → a Reading lesson first;
  - weak inference practice → the inference lesson before more practice;
  - lesson mastered but practice still weak → an applied drill;
  - resume ranks above a due review.
- **Daily plan** at all four lengths: totals are exact, it always contains learning, practice is under 70% of the time, and a second skill appears at 90 minutes or more.
- **Progress views** contain only real data.
- **Validator:** accepts a complete lesson, rejects thin lessons, enforces curriculum order.
- **Persistence:** lesson progress goes to `progress.json`, not `ai.json`.
- **Guided navigation:**
  - the primary action for a new learner, a resume, a due review and just after a lesson;
  - the "what happens next" line;
  - the next step after practice (weak type → lesson; clean result → coach);
  - the onboarding migration for existing vs empty data.
- **Local day:** a lesson finished at 23:30 local time counts for that local day, not the UTC date.

**`test:smoke` covers** (real server, no API key, temporary data directory seeded with a legacy `db.json`):
- **Migration and Practice Mode:** legacy-data migration, practice scoring and selection, pending-audio rules and the browser-voice opt-in, vocabulary without AI, offline Writing/Speaking submission, instant mock exams with answer keys stripped, admin endpoints.
- **Learn Mode:** a lesson opens without AI, guided grading, the plan resumes an unfinished lesson, **resume after a server restart**, a full mastery pass, lesson vocabulary into the SRS, the coach moving to a different lesson.
- **Errors:** the tutor fails cleanly without a key.
- **Onboarding and help:**
  - migrated learners are not shown the guide;
  - invalid scores are rejected;
  - saved scores rebalance weights toward the weak skills;
  - daily time is saved and the guide completes;
  - the dashboard has a primary action;
  - next-step endpoints work;
  - help dismissal is saved;
  - onboarding and help state survive a restart.

---

## 12. Known limitations and untested functionality

**Known limitations:**
1. All content is AI-written and AI-reviewed. No human teacher has checked answer keys or explanations.
2. Audio is TTS:
   - prosody is neutral;
   - 2 of 5 voices are US;
   - no human has listened to it.
3. Speaking feedback is transcript-only; pronunciation is not assessed. Speech recognition needs Chrome or Edge.
4. Production exercises in lessons are self-assessed; their weight is capped at 25%.
5. Text grading is strict about spelling, although variants were widened.
6. Scores and estimates:
   - lesson mastery is not a CELPIP score;
   - Reading/Listening practice estimates are heuristics;
   - the coach weights are hand-set, not tuned on data.
7. Content volume is still below the long-term targets (§3.1), though tripled in stage 5. Listening practice has 6 non-mock sets per part (4 full + 2 drill).
8. Lessons are authored as files; the admin generation pipeline produces practice items only.
9. Guided navigation is rule-based wording over the coach. The new-learner flow was checked by an automated click-through, not by a real first-time user.
10. The Mock exam report does not yet end with a "next step" card; it links back to the dashboard as before.
11. Security and scale:
   - Basic auth has no rate limiting;
   - storage is single-process JSON files;
   - answer keys are hidden only in exam mode.

**Untested (please audit):**
1. **Live Gemini behaviour:**
   - the tutor (does it withhold answers before the learner answers, ask follow-up questions, stay on the lesson?);
   - evaluation;
   - content generation and AI review;
   - Gemini TTS.
2. A **real browser session by a human**: microphone and speech recognition, a full mock exam, a full lesson pass by hand.
3. **A real phone**, especially iOS Safari, including the onboarding sheet and safe-area spacing.
4. **Railway deployment** of the current commit.
5. **Long-term behaviour** over weeks: review timing, skill rotation, and whether mastery predicts CELPIP improvement.

### Suggested spot checks

```
npm run content:validate
npm run test:learn && npm run test:smoke
```

Then:
- Open `/learn/rd-08`, `/learn/ls-07` and `/learn/sp-13` and complete a pass.
- Read the `review.notes` field of any content file.

---

## 13. Stage 5: tripled content, read-aloud and translations (2026-11-03)

**Content (all counts from `npm run content:validate`, 0 errors / 0 warnings):**

| | Before | After |
|---|---|---|
| Reading sets | 28 | 84 (716 questions) |
| Listening sets | 24 | 72 (436 questions) |
| Writing prompts | 12 | 36 |
| Speaking prompts | 32 | 96 (36 SVG scenes) |
| Mock-exam packages | 2 | 6 (all valid, all listening audio present) |

- Library difficulty is now 6: 29, 7: 94, 8: 125, 9: 40 items. New items target 8–9, the learner's new goal range.
- **Process:** 24 author agents (one per part) wrote drafts from `CONTENT_GUIDE.md`; a different agent reviewed every file, solving each question before reading the key, recomputing every number, checking facts about BC/Canada, SVGs against model answers, and word counts. Items were approved only after `content:validate` was clean.
- **What reviews caught:** distractors that were also defensible; dates on the wrong weekday; real organisations or places attached to invented events (renamed to fictional ones); legal/medical/financial claims stated as fact (hedged or removed, e.g. a BC Residential Tenancy Act conflict, a false graduation requirement); model answers describing details not drawn in the SVG; and listening questions naming speakers whose names were never spoken. That last issue also existed in 13 older listening sets, which were fixed the same way (names added to the dialogue).
- **Duplicates:** parallel authors picked the same scenario in a few places (e.g. R4 full vs R4 mock, R2 full vs R2 mock). The duplicates were rewritten and re-reviewed independently; a final scan of all 314 titles found no same-skill near-duplicates.
- **Answer keys:** no approved key was found wrong; reviewers changed keys only when re-ordering options or rewriting a whole set.

**Media:**
- Listening audio: 175 MP3 files in `audio-assets/` (practice sets 72/72 and lesson clips 83/83 complete; manifest and files match, no orphans).
- "Nghe bài đọc": 361 read-aloud MP3 files (`tts-<hash>.mp3`, en-CA Clara) for every reading passage, table and text lesson stimulus, bundled in `audio-assets/`.
- Vietnamese translations: 2,006/2,006 study texts in `content/translations/vi.json` (passages, transcripts, prompts, lesson stimuli; questions stay English).
- `audio-assets/` is now about 200 MB.

**Code in this stage:**
- AI prompts (evaluation and tutor) read the official scores and `targetLevel` from Settings instead of a fixed "Level 8".
- `content:validate` prints a "Generated media" section that flags listening sets without audio, passages without bundled read-aloud audio and texts without a translation.
- The mock-exam report ends with a "next step" card (`/api/next-step?after=mock&mockId=…`), chosen from the weakest question type across the whole mock.
- Paragraphs are no longer capped at 75ch; a "Cấu trúc bài thi" page explains the test format.

**Not yet verified:** no human has read the new items or listened to the new audio; the AI review is careful but not expert certification.

## 14. Notebook and AI Agents track (2026-11-10)

**What was added**
- **Vở ghi (notebook).** Every CELPIP lesson, every AI track item and two general pages have a ruled notebook page with autosave. Notes are stored in `progress.json` under `notebook` (`{ text, checks, title, updatedAt }` keyed by section id). While typing, a draft is also kept in `localStorage`. If the server cannot be reached, the draft survives and is pushed on the next save. `/notebook` lists every page, newest first, with search.
- **Lộ trình AI Agents (`/ai`).** An 8-week plan in `shared/ai-track.ts`.
  - Weeks 1–4 (track A, a team of agents that write software): Anthropic Academy (Claude Code in Action, Introduction to subagents, agent skills, MCP), plus hands-on practice on the learner's own system.
  - Weeks 5–8 (track B, agents that run business operations): the Hugging Face Agents and Context courses, Building with the Claude API, and a portfolio (C4, ADR, 30 test cases).
  - Each item has links, its certificate condition, a checklist (ticks saved in the notebook entry), self-check questions and a notebook page. Progress is derived from the ticks.
- **Navigation.** On desktop, the sidebar gains a "Vở ghi" link (under Ôn tập) and a new "AI" section. On mobile, the tab bar now has 6 tabs (AI added), and "Thêm" lists both new pages.

**API.**
- `GET /api/notebook` returns all pages.
- `PUT /api/notebook/:id` takes `{ text?, checks?, title? }` and only updates the fields sent.
- The id must match `^[a-z0-9][a-z0-9_-]{0,79}$`. Text is capped at 100,000 characters. `checks` is de-duplicated and limited to integers 0–99. A page with no text and no ticks is deleted.

**Verified.**
- Typecheck and build pass. `npm test` gives 30/30 learn and 60/60 smoke; the smoke run includes 5 new notebook checks.
- At 375 px in Chromium mobile emulation:
  - Ticking a checklist line and typing a note both save to the server.
  - Notes reload correctly when switching between AI items, lessons and `/notebook`.
  - There is no horizontal scroll.
- A bug that left the editor stuck on "Đang mở vở…" when the notebook was already cached was found and fixed during this check.

**Not verified.**
- Offline draft recovery was not tested by actually cutting the network.
- Course links and certificate rules were checked on 2026-11-10 and may change; the items say "kiểm tra lại" where the rules were not confirmed on the course page.
- There is no rich text, export or attachments in the notebook; it is plain text only.
