# Content Library Guide

The content library is the **static, prebuilt learning material** for CELPIP 8 Coach (Layer A). The app never generates content during practice: it selects from this library.

- `content/` holds curated content that is committed to git.
- `$DATA_DIR/library/` holds content approved through the admin pipeline on the server. It uses the same layout.

Validate everything with:

```bash
npm run content:validate                 # whole library
npm run content:validate -- --filter r1- # only issues for matching files/ids
```

> Passing validation means the content is **well-formed and internally consistent**: fields present, counts right, evidence quoted verbatim, no duplicates. It does **not** prove exam quality. Every item also needs a careful human or independent AI review before `review.status` becomes `"approved"`.

## 1. Layout and IDs

```
content/
  reading/R1/r1-full-01.json        one practice set per file
  listening/L5/l5-mock-02.json
  writing/W2/w2-practice-03.json
  speaking/S3/s3-practice-01.json
  vocabulary/workplace.json         JSON array of entries
  mocks/mock-01.json                mock-exam package (references ids)
```

**ID format:** `<task>-<setType>-<nn>` in lowercase, for example `r1-full-01`, `r3-drill-02`, `l1-mock-01`, `w1-practice-04`, `s5-mock-01`. Vocabulary ids are `v-<topic>-<nnn>`.

**Question ids are derived, never authored.** The loader sets them to `<setId>-q<number>`. Questions must be numbered `1..n` in order.

**`setType`:**

| Kind | Allowed values |
|---|---|
| Reading / Listening | `full` (complete CELPIP part), `drill` (shorter targeted practice), `mock` (complete part reserved for mock-exam packages; never served in normal practice) |
| Writing / Speaking | `practice` or `mock` |

**Common metadata (all items):**

| Field | Rule |
|---|---|
| `difficulty` | integer 5–10 |
| `topic` | one of `workplace`, `housing`, `transportation`, `customer-service`, `community-services`, `education`, `healthcare`, `shopping`, `banking`, `social`, `environment`, `recreation`, `government` |
| `estimatedMinutes` | number |
| `source` | `"curated"` or `"ai-generated"` |
| `review` | `{ "status": "draft" \| "approved" \| "rejected", "reviewedBy": "...", "notes": "..." }`. Only `approved` items are used. |
| `createdAt` | ISO date |
| `focus` | `[]` for reading/listening |

## 2. Official format (verified October 2026)

The question counts come from the celpip.ca test-format page. The speaking timings come from the official 2026 Speaking study pack. Reading per-part times are approximate: sources differ, and the official overall range is about 55 minutes.

| Part | Questions | Layout enforced by the validator (complete parts) |
|---|---|---|
| R1 Reading Correspondence | 11 | `sections`: [text: letter/email 250–350 words, text: reply 120–180 words with blanks `[[7]]`…`[[11]]`]. Q1–6 about the letter, Q7–11 fill the blanks. |
| R2 Reading to Apply a Diagram | 8 | `sections`: [table (caption, headers, equal-width rows), text: email 150–200 words with blanks `[[1]]`…`[[5]]`]. Q1–5 fill the blanks by applying the diagram, Q6–8 about the email/diagram. |
| R3 Reading for Information | 9 | `sections`: 4 text sections labelled exactly `Paragraph A` … `Paragraph D` (90–130 words each). Options are exactly `A`, `B`, `C`, `D`, `E — Not given in any paragraph` (**5 options — the one official exception to the 4-option rule**). Use E for 1–2 statements; then the evidence is the sentence that comes closest but does **not** state it, and the explanation says why. |
| R4 Reading for Viewpoints | 10 | `sections`: [text: article 400–500 words with ≥ 2 viewpoints, text: reader comment 120–170 words with blanks `[[6]]`…`[[10]]`]. Q1–5 about the article, Q6–10 fill the blanks. |
| L1 Problem Solving | 8 | 3 chunks with 3 / 3 / 2 questions; 2 speakers (man + woman); each chunk 150–220 words |
| L2 Daily Life Conversation | 5 | 1 chunk, 250–350 words, 2 speakers |
| L3 Information | 6 | 1 chunk, 350–450 words, ≥ 2 speakers; one gives detailed information |
| L4 News Item | 5 | 1 chunk, 220–300 words, **exactly 1 speaker** (`voice: "narrator"`) |
| L5 Discussion | 8 | 1 chunk, 450–550 words, **≥ 3 speakers** |
| L6 Viewpoints | 6 | 1 chunk, 400–500 words, 1–2 speakers |
| W1 Email | — | 27 min, 150–200 words, exactly 3 bullet instructions, `optionA`/`optionB` = null |
| W2 Survey | — | 26 min, 150–200 words, `optionA` and `optionB` required |
| S1 Advice | — | 30 s prep / 90 s speak |
| S2 Personal Experience | — | 30 / 60 |
| S3 Describing a Scene | — | 30 / 60, **SVG scene required** |
| S4 Making Predictions | — | 30 / 60, **SVG scene required** |
| S5 Comparing & Persuading | — | 60 s choose + 60 prep / 60 speak, **2 option cards** (title + ≥ 3 details) |
| S6 Difficult Situation | — | 60 / 60 |
| S7 Opinions | — | 30 / 90 |
| S8 Unusual Situation | — | 30 / 60, **SVG of one unusual object required** |

**Drills** use the same section layout but have 4–7 questions (reading) or 1 chunk with 3–6 questions (listening). At least 70% of a drill's questions should test the drill's target category. Put that category in the title, e.g. "Inference drill: …".

## 3. Multiple-choice questions (reading & listening)

```json
{
  "number": 3,
  "prompt": "Why does Maria want to change her shift?",
  "options": [
    { "text": "She has started evening classes.", "trap": "none", "whyVi": "Đúng: Maria nói cô ấy vừa đăng ký lớp buổi tối ở BCIT." },
    { "text": "She wants to earn overtime pay.", "trap": "not_mentioned", "whyVi": "Bài không nhắc tới tiền làm thêm giờ." },
    { "text": "Her manager asked her to switch.", "trap": "wrong_speaker", "whyVi": "Người đề nghị đổi ca là Maria, không phải quản lý." },
    { "text": "Her evening shift was cancelled.", "trap": "word_match", "whyVi": "Bài có từ 'evening' và 'cancelled' nhưng nói về lớp học bị hủy năm ngoái." }
  ],
  "answerIndex": 0,
  "category": "detail",
  "evidence": "I've just signed up for evening classes at BCIT",
  "explanationVi": "Câu hỏi hỏi lý do. Bài nói 'signed up for evening classes', đáp án A diễn đạt lại thành 'started evening classes'.",
  "vocabulary": ["sign up for"]
}
```

| Field | Rule |
|---|---|
| `options` | Exactly 4 (R3: the fixed 5). Vary the position of the correct answer across a set. |
| `trap` | Exactly one option, the correct one, has `"none"`. Every wrong option has one of `word_match`, `opposite`, `not_mentioned`, `partially_true`, `too_broad`, `wrong_speaker`, `wrong_detail`. |
| `whyVi` | Required for every option, in Vietnamese. |
| `category` | Reading: `vocabulary`, `inference`, `paraphrase`, `main_idea`, `distractor`, `detail`, `grammar`. Listening: `missed_info`, `paraphrase`, `speaker_attitude`, `long_conversation`, `vocabulary`, `similar_choices`. |
| `evidence` | An **exact, contiguous quote** from the passage (reading) or from **the chunk the question follows** (listening). It is checked automatically. Copy and paste; do not paraphrase or use "…". |
| `explanationVi` | Says how to find the answer and names the paraphrase. |
| `vocabulary` | Optional; terms from the set's `vocabulary` list. |

**Quality rules (reviewers check these):**

- **Exactly one defensible answer.** Distractors must be clearly wrong *according to the text*, but plausible to a careless reader.
- **Correct answers paraphrase the text**, especially at difficulty ≥ 7. Do not copy the evidence sentence into the correct option.
- **Each wrong option is tempting for the reason its trap names.** For example, a `word_match` option really reuses words from the text.
- **Mix of question types** across a set: detail, inference, main idea, attitude (for viewpoints and discussions), paraphrase, vocabulary in context.
- **Original, realistic Canadian (ideally BC) contexts.** Use real-sounding but fictional organisations, CAD prices, Canadian spelling, varied names reflecting Canada's diversity, and a different scenario in every set. Avoid generic "AI essay" prose. Letters should sound like real people; news should sound like local radio.
- **No stage directions, brackets or speaker names inside listening `text`.** TTS reads every character aloud.

**Difficulty calibration:**

| Level | What it looks like |
|---|---|
| 5–6 | Everyday vocabulary, mostly explicit answers, light paraphrase |
| 7–8 | Moderately complex, most answers paraphrased, several inference/attitude items, plausible distractors |
| 9–10 | Dense, nuanced, idiomatic, implied attitudes, subtle distinctions |

The learner is at Reading 5 / Listening 6 and aims for 8, so most sets should be 6–8.

**Set-level fields:**

| Field | Rule |
|---|---|
| `vocabulary` | 6–10 useful items `{ term, vi, definition, example }` drawn from the text |
| `estimatedMinutes` | Reading: about the part time. Listening: audio + answering time. |
| `context` (listening only) | One sentence shown before the audio |
| `voice` per segment | `female_a`, `male_a`, `female_b`, `male_b`, `narrator`. A speaker always keeps the same voice. |

## 4. Writing prompts

```json
{
  "id": "w1-practice-01", "kind": "writing", "taskType": "W1", "setType": "practice", "difficulty": 7, "topic": "housing",
  "title": "...", "situation": "...", "instructions": ["...", "...", "..."], "optionA": null, "optionB": null,
  "structure": ["Greeting + purpose (1–2 sentences)", "..."],
  "modelResponse": "150–200 words, Level 8+ style, follows the instructions exactly",
  "usefulExpressions": [{ "expression": "I would appreciate it if…", "usageVi": "Yêu cầu lịch sự trong thư trang trọng" }],
  "commonMistakes": ["Vietnamese: lỗi hay gặp ở dạng đề này"],
  "estimatedMinutes": 27, "source": "curated", "review": { ... }, "createdAt": "..."
}
```

- **W2:** `instructions` = `["Choose the option you prefer. Explain the reasons for your choice.", ...]`. The `modelResponse` picks one option and briefly addresses the other.
- **Minimums:** `structure` ≥ 3 steps, `usefulExpressions` ≥ 4, `commonMistakes` ≥ 2.

## 5. Speaking prompts

**Fields:** `prompt` (exactly as the test would show it), `svg` (S3/S4/S8, otherwise `null`), `options` (S5 only, otherwise `null`), `structure` (≥ 3), `modelAnswer`, `usefulExpressions` (≥ 3), `commonMistakes` (optional), `estimatedMinutes`.

**`modelAnswer` length:**

| Speaking time | Words |
|---|---|
| 60 s tasks | 100–190 |
| 90 s tasks | 150–270 |

**SVG rules:**

- `viewBox="0 0 800 500"`, flat colours, simple shapes.
- **S3/S4:** at least 6 clearly distinguishable people/objects doing different things. **S4:** visible clues about what will happen next.
- **S8:** one unusual object, centred, with clear details (shape, colours, parts).
- No `<script>`, no event handlers, no external `href`, no `<foreignObject>`. Text only for short signs. Keep under ~20 KB.

## 6. Vocabulary entries

```json
{ "id": "v-housing-001", "term": "security deposit", "definition": "...", "vi": "...", "example": "...",
  "collocations": ["pay a security deposit", "..."], "synonyms": ["damage deposit"], "topic": "housing",
  "difficulty": 6, "tasks": ["R1", "W1"] }
```

- Choose **exam-relevant, high-frequency** words and phrases, including the paraphrase pairs CELPIP answers rely on. Avoid rare words.
- `example` must contain the term.

## 7. Mock packages

```json
{ "id": "mock-01", "title": "Mock Exam 1",
  "listening": ["l1-mock-01", "l2-mock-01", "l3-mock-01", "l4-mock-01", "l5-mock-01", "l6-mock-01"],
  "reading": ["r1-mock-01", "r2-mock-01", "r3-mock-01", "r4-mock-01"],
  "writing": ["w1-mock-01", "w2-mock-01"],
  "speaking": ["s1-mock-01", "s2-mock-01", "s3-mock-01", "s4-mock-01", "s5-mock-01", "s6-mock-01", "s7-mock-01", "s8-mock-01"] }
```

A package is available only when every referenced item is approved and valid and every listening part has generated audio.
