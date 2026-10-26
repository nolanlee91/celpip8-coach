# CELPIP 8 Coach

A personal web app for studying CELPIP-General, built to take one learner from L6 / R5 / W7 / S6 to **Level 8 in every skill**.

> This is an **unofficial** practice tool. It is not affiliated with CELPIP or Paragon Testing. All practice content is original, and every score the app shows is a **practice estimate**, not an official result.

## Two modes: Learn and Practice

**Learn Mode (`/learn`)** is a structured, four-skill curriculum. It has 60 lessons in 13 modules: 15 each for Reading, Listening, Speaking and Writing. Every lesson follows the same teaching sequence:

1. **Objective:** what you will be able to do, and why it matters for Level 8.
2. **Concept:** the technique, explained in Vietnamese with English examples.
3. **Worked examples:** step by step. Speaking lessons show weak, acceptable and Level 8 answers; Writing lessons show before and after.
4. **Guided practice:** 3–5 exercises with hints and an explanation right after each answer.
5. **Independent practice:** 5–10 exercises with no hints. This is the mastery check.
6. **Mistake analysis:** each wrong choice is linked to a named misconception that explains the underlying skill gap.
7. **Mastery decision:** at 80% or above you advance; at 60–79% you review soon; below 60% you repeat the lesson.
8. **Spaced review:** SM-2 schedules short review quizzes, with earlier mistakes first.

Wrong answers go into the mistake notebook, and lesson expressions can be added to the vocabulary SRS.

**The coach** is rule-based and needs no AI. It picks what to learn next and explains why:
- It resumes an unfinished lesson first.
- Then it gives the lesson reviews that are due.
- Then it repeats a failed lesson.
- If Practice accuracy in a competency is weak (for example inference at 2/8), it assigns the matching lesson **before** more questions of that type.
- Otherwise it picks the next lesson by skill gap. Reading and Listening come first, and Writing/Speaking are rotated in so they are maintained.

**The daily plan** (30/60/90/120 min) mixes learning, guided practice, vocabulary and mistake review, applied practice, and occasional exam practice.

**Practice Mode** is everything from before: Reading/Listening/Writing/Speaking practice, mock exams, the question bank, vocabulary, the mistake notebook, analytics and AI evaluation.

> Lesson mastery measures how well you know a technique. It is **not** a CELPIP score.

The optional AI Tutor (💬) is context-aware inside lessons. It receives:
- the lesson,
- the current exercise,
- your actual answer and misconceptions.

If you have not answered yet, it gives hints without revealing the answer.

## Architecture: content first, AI optional

| Layer | What it does | Needs AI? |
|---|---|---|
| **A. Content library** | `content/` holds prebuilt Reading/Listening sets, Writing/Speaking prompts with Level 8 model answers, vocabulary, and mock-exam packages. It is validated automatically and checked by an independent review before use. | No |
| **B. Learning engine** | Exercise selection, local scoring, explanations, mistake tracking, SM-2 spaced repetition, adaptive difficulty, daily plan, analytics, vocabulary review, mock exams | No |
| C. AI assistance | Writing/Speaking evaluation (**only when the learner presses the button**), AI Tutor, and the admin tools for generating content | Gemini |
| **A2. Curriculum** | `content/lessons/` — `curriculum.json` (modules and order) plus one JSON file per lesson. Validated by `shared/validate-lesson.ts`. Only lessons that are approved and error-free are shown. | No |
| **D. Listening audio** | 30 MP3 files (24 sets) + 83 lesson clips (17 lessons) generated once with Edge TTS neural voices (en-CA Clara/Liam + en-US Jenny/Guy) and **committed in `audio-assets/`**, so a fresh deploy plays immediately | No |

**Without a Gemini key** you can still practise Reading, Listening (all 24 sets ship with audio), vocabulary, the mistake notebook, the study plan and the prebuilt mock exams. Writing and Speaking work too: the learner sees the model answer straight away, and AI evaluation can be requested later.

### Storage

| Data | Location | In git? |
|---|---|---|
| Static content (A) | `content/` (curated) + `$DATA_DIR/library/` (approved through the admin page) | `content/` yes |
| Learning progress (B), including Learn Mode lesson progress (`lessons`) | `$DATA_DIR/progress.json` | no |
| AI results, pending submissions, usage log, cache (C) | `$DATA_DIR/ai.json` | no |
| Listening audio (D) | `audio-assets/` (bundled, read-only) + `$DATA_DIR/audio-assets/` (generated later on the server) | bundled: yes (~45 MB: 30 practice + 83 lesson clips) |
| Speaking recordings | `$DATA_DIR/audio/` | no |
| Generation drafts | `$DATA_DIR/content-drafts/<job>/` | no |

**Migrating from the old version:** on first start, the old `db.json` is split into `progress.json` + `ai.json`. A backup is kept as `db.json.migrated-<time>`. Old AI-generated exercises are kept so the history can still be reviewed.

## Running locally

```bash
cd celpip8-coach
npm install
copy .env.example .env      # GEMINI_API_KEY is optional (see above)
npm run dev                 # http://localhost:5173 — use Edge/Chrome
```

## Commands

| Command | Purpose |
|---|---|
| `npm run content:validate` | Checks the whole library: required fields, unique IDs, 4 options (R3: A–E), valid answer key, evidence quoted verbatim, correct part format, no duplicate questions/passages. Add `-- --filter r1-` to narrow the scope. |
| `npm run content:generate -- --skill reading --task R4 --count 3 [--set-type full\|drill\|mock] [--focus inference] [--topic housing]` | Generates **drafts** in small batches (≤ 25), validates them automatically, then runs an independent AI review. Resume an interrupted job with `-- --resume <jobId>`. Track tokens per job with `-- --list`. |
| `npm run content:review -- --job <id> [--show/--approve/--reject <draftId>]` | Human review. A draft with errors cannot be approved. |
| `npm run content:import [-- --target library]` | Imports approved drafts into `content/` (to commit) or into `$DATA_DIR/library`. |
| `npm run audio:generate [-- --lessons]`, `[-- --concurrency 6] [-- --limit 10] [-- --status]` | Generates each listening clip **once**. Default `AUDIO_PROVIDER=edge` (no key, parallel); `gemini` is optional. Can be resumed and skips finished clips. Copy new files into `audio-assets/` and commit them to ship them. |
| `npm run test:learn` | Unit tests for Learn Mode: grading, mastery, progression, spaced review, coach rules, daily plan and persistence. |
| `npm run test:smoke` | End-to-end test **without an API key** in a temporary data directory, including a full lesson pass and resume after restart. |
| `npm test` | Both. |
| `npm run typecheck` / `npm run build` | |

The same actions (validation, audio, generation, approval, AI usage) are on the **Admin** page (`/admin`).

> **Listening needs audio.** All 24 current sets ship with audio. Any future set without audio is marked "pending audio" and excluded from practice and mock exams. It is **never** silently turned into a text exercise. The learner can turn on *browser voice* in Settings, and any set using it is clearly labelled.
>
> Edge TTS is an unofficial Microsoft service, so it may change or stop working. The files already generated keep working because they are stored in the repo.

## Deploying to Railway

1. **New Project → Deploy from GitHub repo.** `railway.json` already sets build = `npm run build` and start = `npm start`.
2. **Variables:**

   | Variable | Value |
   |---|---|
   | `APP_PASSWORD` | **Required** |
   | `DATA_DIR` | `/data` |
   | `GEMINI_API_KEY` | Optional |
   | `GEMINI_MODEL` / `GEMINI_TTS_MODEL` | Optional |

3. **Attach Volume** with mount path `/data`. Progress, AI results and audio live there and survive redeploys.
4. **Generate Domain** to get HTTPS (needed for the microphone).
5. Nothing else is needed for audio: the 30 bundled MP3 files play straight away. Only listening sets added later need audio, which you can generate from `/admin` → *Audio Listening*; it is stored on the volume.

## Limitations

- **Speaking** is evaluated from the transcript only. Pronunciation and audio fluency are **not** assessed.
- **Reading/Listening estimates** are a rough rule, not the official score conversion.
- **Validation is not proof of quality.** It checks structure and consistency. Every item also needs a careful review (independent AI review + `review.status`). See `content/CONTENT_GUIDE.md` and `AUDIT.md`.

## Interface

- **Look:** deep sea-teal navigation rail and a cool off-white ground. Be Vietnam Pro (drawn for Vietnamese) is used for the interface, and Source Serif 4 for the English texts you study. The design guidance came from Anthropic's `frontend-design` skill and the open-source Impeccable skill.
- **Today's plan:** drawn as a timetable with minute marks and one coloured line per skill. The next block is opened up; finished blocks can be ticked off.
- **Mobile:**
  - a bottom tab bar (Hôm nay, Lộ trình, Luyện thi, Từ vựng, Thêm) and a top bar with the tutor button;
  - touch targets of at least 44 px;
  - Back/Next for lesson steps, within thumb reach;
  - no horizontal page scroll at 375 px.
- **Licences:**
  - Fonts are self-hosted in `public/fonts` (SIL Open Font License 1.1).
  - Icons are Lucide (ISC License), inlined in `src/components/Icon.tsx`.
