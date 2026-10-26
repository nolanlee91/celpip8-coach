# Learn Mode — lesson authoring guide

This guide is the source of truth for writing Learn Mode lessons. Lessons are **pre-written and stored**. The app never generates lesson content while the learner studies.

## Learner

- Vietnamese adult living in British Columbia.
- Official CELPIP-General scores: **Listening 6, Reading 5, Writing 7, Speaking 6**.
- Target: **Level 8 or higher in every skill**.
- Explanations (`*Vi` fields, concept bodies where helpful) are in **natural Vietnamese with full diacritics**.
- Lessons, examples, exercises and model answers are in **natural Canadian English**: Canadian spelling (colour, centre, cheque, neighbour), BC/Canadian everyday contexts.

## Files

- One lesson per file: `content/lessons/<skill>/<id>.json`, for example `content/lessons/reading/rd-08.json`.
- The schema is `Lesson` in `shared/curriculum.ts`. Read it first; every field is described there.
- Module membership and order come from `content/lessons/curriculum.json`. Do not edit it.
- Validate after every file:
  ```
  npx tsx scripts/content-validate.ts --filter rd-08
  ```
  This must report **0 errors**. Warnings must also be fixed unless there is a stated reason.
- `review`:
  - Authors set `{"status":"draft","reviewedBy":"author-agent","notes":""}`.
  - The independent reviewer sets `approved` after checking.
  - Set `"source": "curated"`.

## The teaching sequence (every lesson)

1. **`objectives` + `objectiveVi` + `whyItMattersVi`.**
   - 2–4 concrete "You will be able to…" statements.
   - Why this skill matters for a Level 8 score, tied to the learner's real gap. For example: "Reading 5 → 8 mostly depends on…".
2. **`concept`: 3–6 sections, 350–700 words in total.**
   - Teach the technique itself: what it is, how to do it step by step, signal words, typical traps, how it appears in CELPIP.
   - Explain in Vietnamese and keep English terms and examples in English. Short Markdown (bold, bullets) is allowed.
   - Not a one-paragraph summary.
3. **`examples`: 2–3 worked examples.** Each has a `stimulusId` where relevant, a `question`, ≥ 3 `steps` that think aloud through the technique, the `answer`, and a `takeawayVi`.
   - **Speaking:** at least one example has `comparisons` with **weak**, **acceptable** and **level8** versions of the same response. Each has a `commentVi` explaining exactly why it scores differently: structure, connectors, vocabulary, grammar, development, timing.
   - **Writing:** at least one example has **before** and **after** versions, with a `commentVi` naming each change.
4. **`guided`: 3–5 exercises.**
   - Each has a `hint` that points to the technique ("Look for the contrast word after the first sentence") and **never** gives the answer.
   - Each has an `explanationVi` shown right after answering.
5. **`independent`: 5–10 exercises** (aim for 8 in Reading/Listening, 6–8 in Speaking/Writing).
   - **No hints.**
   - Slightly harder than guided. The last 2–3 should be at Level 8 difficulty.
   - These form the mastery check.
6. **`misconceptions`: 3–5 per lesson.** This is the mistake-analysis vocabulary.
   - Every wrong choice option and every text/order/produce exercise points to one key.
   - `explanationVi` names the underlying skill gap, not just "you picked the wrong answer".
   - `fixVi` says what to do differently next time.
7. **`mastery`:** `{"advance":0.8,"review":0.6}` unless there is a reason to differ.
8. **Spaced review** is scheduled by the engine; nothing to author.

## Exercise types

| type | Use for | Required |
|---|---|---|
| `choice` | MCQ (3–5 options; 4 is normal). | `answerIndex`; per option `misconception` (null for the correct one) and `whyVi`. `evidence` = verbatim quote from the stimulus when the answer is located in a text or transcript (strongly recommended for Reading/Listening). |
| `text` | Gap fill, one-word answer, error correction, dictation. | `answers`: all accepted variants, lower-case-insensitive and punctuation-insensitive. `mode`: `exact` or `dictation`. A dictation answer must be a **verbatim** sentence from the stimulus audio, 8–20 words. Keep exact answers short (1–4 words) so grading is fair. List every reasonable variant. |
| `order` | Put sentences, email parts or answer steps in order. | `items` in the **correct** order (the UI shuffles), 3–7 items. Only use when exactly one order is defensible. |
| `produce` | Write or say a response (Speaking/Writing only). | `medium` (`write`/`speak`), `checklist` (3–6 observable criteria, e.g. "States the choice in the first sentence", "Uses at least two contrast connectors"), `modelAnswer` (a strong Level 8–9 sample), `prepSec`/`responseSec` for speaking, `minWords` for writing. The learner self-checks against the checklist; AI feedback is optional. |

**Rules for every exercise:**
- Exactly one correct, defensible answer.
- Distractors must be plausible and each must map to a misconception or trap: word match, opposite, not mentioned, partially true, too broad, wrong speaker, wrong detail.
- Never copy official CELPIP material. All content is original.
- No duplicate exercises across lessons.
- `competency` must be one of the skill's categories:
  - **reading:** `vocabulary, inference, paraphrase, main_idea, distractor, detail, time_management, grammar`
  - **listening:** `missed_info, paraphrase, speaker_attitude, long_conversation, vocabulary, similar_choices`
  - **speaking:** `task_fulfillment, coherence, vocabulary_range, grammar, fluency_hesitation, timing`
  - **writing:** `task_fulfillment, coherence, vocabulary_range, grammar, tone_register`

**Reading/Listening:**
- All exercises are auto-graded: `choice`, `text` or `order`.
- Reading stimuli are short original passages (60–250 words): emails, notices, articles, comment threads, schedules written as text or Markdown lists.

**Speaking/Writing:**
- ≥ 3 auto-graded independent exercises. Examples: choose the best connector, spot the error, pick the best topic sentence, order the parts of an answer, identify the register.
- At least one `produce` exercise.

## Stimuli

`stimuli` is an object keyed by kebab-case id. Examples and exercises reference a stimulus with `stimulusId`, and several exercises may share one stimulus.

- `text`: passage shown on screen.
- `audio`: `[{ "speaker": "Maya", "voice": "female_a", "text": "…" }]`
  - Audio is generated once with Edge TTS. Voices:
    - `female_a` and `male_a` are Canadian.
    - `female_b` and `male_b` are US.
    - `narrator` is the Canadian male voice for announcements and news.
  - **Write natural spoken English:** contractions, the occasional "you know" or "actually", self-corrections where useful. Avoid stage directions.
  - **Length:** clips of 20–90 seconds (≈ 50–220 words). One segment is one speaker turn.
  - **Transcript:** shown after answering (`showTranscript: "after"`, the default). Use `"never"` for dictation stimuli until the answer is submitted, and `"always"` only for shadowing scripts.
- `audioRef`: `{ "setId": "l3-full-01", "chunk": 0 }` reuses audio already in the library. Allowed sets: the `*-full-01` and `*-drill-01` listening sets. **Never `*-mock-*`.** Use it only where the lesson really analyses that recording, such as Part-strategy lessons. Read the set file in `content/listening/` so your questions match the transcript.
- `imageRef`: id of a speaking prompt whose SVG scene is shown.
  - Allowed: `s3-practice-01`, `s3-practice-02`, `s4-practice-01`, `s4-practice-02`, `s8-practice-01`, `s8-practice-02`. **Never `*-mock-*`.**
  - Read the prompt file in `content/speaking/S3|S4|S8/` so your description matches the picture.

## Vocabulary and grammar integration

- `vocabulary`: 6–10 expressions **taught by this lesson**, each with Vietnamese and a Canadian-context example. Examples: inference phrases for inference lessons, formal email phrases for email lessons, connectors for opinion lessons, conversational expressions and paraphrase pairs for listening lessons. The learner can add them to the spaced-repetition notebook.
- `grammar`: 0–3 points that the lesson actually uses, each with `explanationVi` and English examples. **At least one** is required for Speaking/Writing.
- `practice`: 1–3 links into Practice Mode for applied practice after the lesson:
  - `/reading?task=R3`
  - `/reading?mode=drill&focus=inference`
  - `/listening?task=L2`
  - `/listening?mode=drill&focus=paraphrase`
  - `/speaking?task=S5`
  - `/writing?task=W1`
  - `/vocabulary`
  - `/mistakes`

## Real CELPIP-General format (for strategy content)

**Reading (≈ 55 min):**
- P1: Reading Correspondence (11 questions).
- P2: Applying a Diagram (8).
- P3: Reading for Information (9; match statements to paragraphs A–D or E = not given).
- P4: Reading for Viewpoints (10).

**Listening (≈ 47 min):**
- P1: Problem Solving (8, three sections).
- P2: Daily Life Conversation (5).
- P3: Information (6).
- P4: News Item (5).
- P5: Discussion (8, video with several speakers).
- P6: Viewpoints (6).
- Audio plays **once**.

**Writing:**
- T1: Email, 27 min, 150–200 words, 3 bullet points.
- T2: Survey, 26 min, 150–200 words, choose option A or B.

**Speaking** (prep / speak):
- T1: Giving Advice, 30 s / 90 s.
- T2: Personal Experience, 30 / 60.
- T3: Describing a Scene, 30 / 60.
- T4: Predictions, 30 / 60.
- T5: Comparing & Persuading, 60 s choose + 60 prep / 60.
- T6: Difficult Situation, 60 / 60.
- T7: Opinions, 30 / 90.
- T8: Unusual Situation, 30 / 60.

Only claim what is consistent with this. Do not invent official scoring rules; describe performance features (task fulfilment, coherence, vocabulary, listenability/grammar) in general terms.

## Curriculum outline

`prereq` must come earlier in the same skill. `comp` = competencies. Minutes = realistic time for the whole lesson (concept → independent practice), typically 20–35.

### Reading

| id | module | level / diff | title (EN) | comp | tasks | prereq | must teach |
|---|---|---|---|---|---|---|---|
| rd-01 | reading-foundations | foundation / 6 | Skimming for gist and structure | main_idea, time_management | R1–R4 | – | Read title, first and last lines, topic sentences. Predict text type and purpose in 30–60 s. |
| rd-02 | reading-foundations | foundation / 6 | Scanning for specific details | detail | R1–R4 | rd-01 | Keywords and their likely paraphrases; scanning names, numbers, dates; when not to read word by word. |
| rd-03 | reading-foundations | foundation / 6 | Vocabulary in context | vocabulary | R1–R4 | – | Context clues (definition, contrast, example, cause), word parts, tone words, collocations. |
| rd-04 | reading-foundations | foundation / 7 | Reading complex sentences | grammar | R1–R4 | rd-03 | Find the main clause; relative and reduced clauses; reference words (this, which, the latter); concession (although, while); passive voice. |
| rd-05 | reading-foundations | core / 7 | Main idea vs supporting detail | main_idea | R1, R4 | rd-01 | Topic → claim → support; too-broad and too-narrow options; paragraph purpose. |
| rd-06 | reading-techniques | core / 7 | Recognizing paraphrase | paraphrase | R1–R4 | rd-03 | Synonyms, word-form changes, active ↔ passive, negation flips, general ↔ specific; why exact word match is often a trap. |
| rd-07 | reading-techniques | core / 7 | Locating evidence before you choose | detail, paraphrase | R1–R4 | rd-02, rd-06 | Question → locate → read the sentence before and after → match meaning; prove each option true, false or not stated. |
| rd-08 | reading-techniques | core / 8 | Making inferences | inference | R1, R4 | rd-07 | What is implied vs stated; inference must be supported by the text; signal phrases; over-inference trap. |
| rd-09 | reading-techniques | core / 8 | Fact, opinion and assumption | inference, distractor | R4 | rd-08 | Hedging and stance language (arguably, it seems, clearly); writer's vs other people's views; claims vs evidence. |
| rd-10 | reading-techniques | target8 / 8 | Eliminating distractors | distractor | R1–R4 | rd-07 | The 7 trap types with an example each; elimination order; handling two "almost right" options. |
| rd-11 | reading-parts | target8 / 8 | Part 1 strategy: Correspondence | detail, inference | R1 | rd-07, rd-08 | Who wants what and why; tracking the reply email (blanks 7–11) against the first message; tone and relationship. |
| rd-12 | reading-parts | target8 / 8 | Part 2 strategy: Applying a diagram | detail, paraphrase | R2 | rd-02, rd-06 | Reading tables and schedules as text; matching conditions such as budget, time and eligibility; elimination with constraints. |
| rd-13 | reading-parts | target8 / 8 | Part 3 strategy: Reading for information | paraphrase, detail | R3 | rd-06, rd-07 | Match statements to paragraphs; paraphrase hunting; when E ("not given") is right; partial matches. |
| rd-14 | reading-parts | target8 / 9 | Part 4 strategy: Viewpoints | inference, main_idea | R4 | rd-09 | Article vs comment; tracking positions; author's purpose; agreement and disagreement signals. |
| rd-15 | reading-parts | target8 / 8 | Reading time management | time_management | R1–R4 | rd-10 | 55-minute budget per part; when to skip and return; triage; never leaving blanks. Use timed mini-exercises (choice questions about strategy decisions plus short passages). |

### Listening

| id | module | level / diff | title | comp | tasks | prereq | must teach |
|---|---|---|---|---|---|---|---|
| ls-01 | listening-foundations | foundation / 6 | Listening for the main idea | missed_info | L1–L6 | – | Gist from the opening, purpose of the speaker, ignoring unknown words. |
| ls-02 | listening-foundations | foundation / 6 | Numbers, dates, times and instructions | missed_info, similar_choices | L1–L3 | – | 13 vs 30, prices, times, dates said in many ways; corrections ("actually, make that…"); multi-step instructions. |
| ls-03 | listening-foundations | foundation / 7 | Dictation: hearing every word | vocabulary | L1–L6 | ls-01 | Connected speech (gonna, wanna, linking, weak forms, dropped sounds). Mostly `text` dictation exercises (`mode: dictation`). |
| ls-04 | listening-foundations | core / 7 | Canadian everyday English | vocabulary | L1, L2, L5 | ls-03 | Canadian expressions (double-double, toque, loonie, washroom, parkade, eh, "for sure"), indirect politeness, phrasal verbs. |
| ls-05 | listening-foundations | core / 7 | Shadowing for listening fluency | vocabulary, missed_info | L1–L6 | ls-03 | How to shadow (listen → repeat → overlap), chunking, stress and intonation; exercises on stress, chunk boundaries, dictation of shadowed lines. Use `showTranscript: "always"` for shadowing scripts. |
| ls-06 | listening-comprehension | core / 7 | Paraphrase in listening | paraphrase | L1–L6 | ls-01 | The answer options rarely repeat the speaker's words; paraphrase pairs; word-match traps. |
| ls-07 | listening-comprehension | core / 8 | Speaker attitude and intention | speaker_attitude | L2, L5, L6 | ls-06 | Hedging, polite refusal, sarcasm, reluctant agreement, intonation cues ("I suppose…", "That's one way to put it"). |
| ls-08 | listening-comprehension | core / 8 | Following longer conversations | long_conversation | L1, L5 | ls-06 | Who said what, changes of plan, final decisions vs suggestions, 3 speakers. |
| ls-09 | listening-comprehension | core / 7 | Predicting answers before you listen | similar_choices | L1–L6 | ls-02 | Use the context line and options to predict; distinguishing near-identical choices. |
| ls-10 | listening-comprehension | target8 / 8 | Note-taking for CELPIP | long_conversation, missed_info | L3–L6 | ls-08 | What to note (who, decision, numbers, reasons), symbols and abbreviations, two-column notes. |
| ls-11 | listening-parts | target8 / 8 | Parts 1–2: Problem solving & daily life | missed_info, speaker_attitude | L1, L2 | ls-08, ls-09 | Problem → options → decision structure; questions in 3 sections; daily-life tone. |
| ls-12 | listening-parts | target8 / 8 | Part 3: Listening for information | missed_info, paraphrase | L3 | ls-10 | Explanatory monologue or interview; sequence, reasons, conditions. |
| ls-13 | listening-parts | target8 / 8 | Part 4: News items | missed_info, paraphrase | L4 | ls-10 | News structure (headline → details → quotes → next steps); who said what in a report. |
| ls-14 | listening-parts | target8 / 9 | Part 5: Discussion | long_conversation, speaker_attitude | L5 | ls-08, ls-07 | Several speakers with different positions; agreement and disagreement; final outcome. Voices: give each speaker a distinct voice. |
| ls-15 | listening-parts | target8 / 9 | Part 6: Viewpoints | speaker_attitude, paraphrase | L6 | ls-07, ls-10 | Argument structure; the speaker's view vs views reported; concessions. |

### Speaking

| id | module | level / diff | title | comp | tasks | prereq | must teach |
|---|---|---|---|---|---|---|---|
| sp-01 | speaking-foundations | foundation / 6 | Building a structured answer | coherence, task_fulfillment | S1–S8 | – | Opening → 2–3 points with support → wrap-up; signposting. |
| sp-02 | speaking-foundations | foundation / 6 | Generating ideas quickly | task_fulfillment | S1, S2, S7 | sp-01 | 30-second prep method: WHO/WHAT/WHY lists, reasons + example + result, note keywords only. |
| sp-03 | speaking-foundations | foundation / 7 | Connectors for coherence | coherence | S1–S8 | sp-01 | Adding, contrasting, cause and effect, sequencing, giving examples; natural spoken connectors vs written ones. |
| sp-04 | speaking-foundations | core / 7 | Fluency without hesitation | fluency_hesitation | S1–S8 | sp-03 | Fillers that sound natural vs harmful ones; self-correction; chunking; pace; recovering when stuck. |
| sp-05 | speaking-foundations | core / 7 | Using the time well | timing | S1–S8 | sp-01 | Pacing 60 / 90 seconds; how much content fills the time; ending cleanly. |
| sp-06 | speaking-tasks | core / 7 | Task 1: Giving advice | task_fulfillment, vocabulary_range | S1 | sp-01, sp-03 | Advice language (I'd recommend…, you might want to…, if I were you…), 2–3 options with reasons. |
| sp-07 | speaking-tasks | core / 7 | Task 2: Personal experience | grammar, coherence | S2 | sp-01 | Narrative order, past tenses, time markers, feelings and what you learned. |
| sp-08 | speaking-tasks | core / 8 | Task 3: Describing a scene | vocabulary_range, coherence | S3 | sp-03 | Spatial language, present continuous, describing people, overall → details, organizing by area. Use `imageRef` s3-practice-01/02. |
| sp-09 | speaking-tasks | core / 8 | Task 4: Making predictions | grammar, task_fulfillment | S4 | sp-08 | will, be going to, probably, might, is likely to; cause → result; several people. Use `imageRef` s4-practice-01/02. |
| sp-10 | speaking-tasks | target8 / 8 | Task 5: Comparing and persuading | task_fulfillment, coherence | S5 | sp-06 | Compare criteria, comparatives, persuading language, addressing the other person's preference. |
| sp-11 | speaking-level8 | target8 / 8 | Task 6: Difficult situations | task_fulfillment, vocabulary_range | S6 | sp-06 | Tactful, diplomatic language; softening; explaining and proposing a solution; choosing a side. |
| sp-12 | speaking-level8 | target8 / 8 | Task 7: Opinions with reasons | coherence, task_fulfillment | S7 | sp-03, sp-05 | Clear position; reason → explanation → example; concession and rebuttal. |
| sp-13 | speaking-level8 | target8 / 8 | Task 8: Unusual situations | vocabulary_range, task_fulfillment | S8 | sp-08 | Describing an unfamiliar object to someone who can't see it: shape, size, material, purpose, comparisons. Use `imageRef` s8-practice-01/02. |
| sp-14 | speaking-level8 | target8 / 9 | Upgrading vocabulary range | vocabulary_range | S1–S8 | sp-04 | Replacing good, bad, very, a lot, thing; collocations; precise verbs; idiomatic but natural. |
| sp-15 | speaking-level8 | target8 / 9 | Accurate complex sentences in speech | grammar | S1–S8 | sp-07 | Conditionals, relative clauses, modals; common Vietnamese-speaker errors (articles, plurals, tense consistency, third person -s). |

### Writing

| id | module | level / diff | title | comp | tasks | prereq | must teach |
|---|---|---|---|---|---|---|---|
| wr-01 | writing-foundations | foundation / 7 | Sentence construction | grammar | W1, W2 | – | Complete sentences, run-ons and fragments, combining with subordination, sentence variety. |
| wr-02 | writing-foundations | foundation / 7 | Common grammar errors | grammar | W1, W2 | wr-01 | Errors typical of Vietnamese speakers: articles, plurals, countable/uncountable, verb tense and agreement, prepositions. |
| wr-03 | writing-foundations | foundation / 7 | Paragraph organization | coherence | W1, W2 | wr-01 | Topic sentence → support → example → link; one idea per paragraph. |
| wr-04 | writing-foundations | core / 7 | Cohesion: linking and reference | coherence | W1, W2 | wr-03 | Linking words by function; pronouns and reference; avoiding repetition; overusing "Firstly/Secondly". |
| wr-05 | writing-foundations | core / 7 | Tone and register | tone_register | W1, W2 | wr-01 | Formal, semi-formal and informal; contractions; directness vs politeness; register mismatches. |
| wr-06 | writing-email | core / 7 | Email structure and covering every point | task_fulfillment, coherence | W1 | wr-03 | Greeting → purpose → one paragraph per bullet → closing; addressing all 3 bullets fully; word budget. |
| wr-07 | writing-email | core / 8 | Formal emails: complaints and requests | tone_register, task_fulfillment | W1 | wr-05, wr-06 | Polite but firm complaints, requesting action, giving details, proposing a resolution. |
| wr-08 | writing-email | core / 8 | Informal and semi-formal emails | tone_register | W1 | wr-05, wr-06 | Writing to friends, neighbours and colleagues; warmth without slang; apologies, invitations, thanks. |
| wr-09 | writing-email | target8 / 8 | Vocabulary upgrade for emails | vocabulary_range | W1 | wr-07 | Precise verbs, collocations, avoiding repetition; phrases for requesting, explaining, apologising and suggesting. |
| wr-10 | writing-survey | core / 8 | Survey response structure | task_fulfillment, coherence | W2 | wr-03 | Choose clearly → 2 reasons with development → (optional) other option → conclusion. |
| wr-11 | writing-survey | target8 / 8 | Developing arguments | task_fulfillment, vocabulary_range | W2 | wr-10 | Reason → explanation → example → consequence; specific Canadian examples; avoiding vague claims. |
| wr-12 | writing-survey | target8 / 8 | Addressing the other option | coherence, tone_register | W2 | wr-11 | Concession (While option B…, admittedly…), rebuttal, balance without changing sides. |
| wr-13 | writing-polish | target8 / 8 | Coherence across the whole response | coherence | W1, W2 | wr-04, wr-10 | Progression, paragraph linking, consistent viewpoint, referencing back. |
| wr-14 | writing-polish | target8 / 8 | Editing and proofreading | grammar, vocabulary_range | W1, W2 | wr-02 | A 3-minute proofreading routine; personal error checklist; spotting your own errors. |
| wr-15 | writing-polish | target8 / 9 | Timed strategy for Tasks 1–2 | task_fulfillment, coherence | W1, W2 | wr-06, wr-10 | 27/26-minute plan (read → plan → write → check); word count; Level 8 checklist. |

## Quality bar (the reviewer will check these)

- It teaches. A learner who reads the concept and examples can do the exercises **because of the lesson**, not just general English.
- Exercises practise the lesson's technique. They are not random CELPIP questions.
- Answers are unambiguous:
  - Distractors are wrong for a clear, stated reason.
  - `evidence` is quoted verbatim from the stimulus.
  - Dictation answers are verbatim from the audio.
- The Vietnamese is natural. The English is natural and Canadian. Model answers are genuinely Level 8+.
- There are no factual errors about CELPIP or Canada/BC.
- The difficulty rises from guided to the end of independent practice.
