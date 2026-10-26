# CELPIP 8 Coach

A personal web app for studying CELPIP-General, built to take one learner from L6 / R5 / W7 / S6 to **Level 8 in every skill**.

> This is an **unofficial** practice tool. It is not affiliated with CELPIP or Paragon Testing. All practice content is original, and every score the app shows is a **practice estimate**, not an official result.

## Architecture: content first, AI optional

| Layer | What it does | Needs AI? |
|---|---|---|
| **A. Content library** | `content/` holds prebuilt Reading/Listening sets, Writing/Speaking prompts with Level 8 model answers, vocabulary, and mock-exam packages. It is validated automatically and checked by an independent review before use. | No |
| **B. Learning engine** | Exercise selection, local scoring, explanations, mistake tracking, SM-2 spaced repetition, adaptive difficulty, daily plan, analytics, vocabulary review, mock exams | No |
| C. AI assistance | Writing/Speaking evaluation (**only when the learner presses the button**), AI Tutor, and the admin tools for generating content | Gemini |
| **D. Listening audio** | 30 MP3 files (24 sets) generated once with Edge TTS neural voices (en-CA Clara/Liam + en-US Jenny/Guy) and **committed in `audio-assets/`**, so a fresh deploy plays immediately | No |

**Without a Gemini key** you can still practise Reading, Listening (all 24 sets ship with audio), vocabulary, the mistake notebook, the study plan and the prebuilt mock exams. Writing and Speaking work too: the learner sees the model answer straight away, and AI evaluation can be requested later.

### Storage

| Data | Location | In git? |
|---|---|---|
| Static content (A) | `content/` (curated) + `$DATA_DIR/library/` (approved through the admin page) | `content/` yes |
| Learning progress (B) | `$DATA_DIR/progress.json` | no |
| AI results, pending submissions, usage log, cache (C) | `$DATA_DIR/ai.json` | no |
| Listening audio (D) | `audio-assets/` (bundled, read-only) + `$DATA_DIR/audio-assets/` (generated later on the server) | bundled: yes (~21 MB) |
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
| `npm run audio:generate [-- --concurrency 6] [-- --limit 10] [-- --status]` | Generates each listening clip **once**. Default `AUDIO_PROVIDER=edge` (no key, parallel); `gemini` is optional. Can be resumed and skips finished clips. Copy new files into `audio-assets/` and commit them to ship them. |
| `npm run test:smoke` | End-to-end test **without an API key** in a temporary data directory. |
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
