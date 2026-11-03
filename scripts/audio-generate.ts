// Pre-generates listening audio once (AUDIO_PROVIDER: edge by default, or gemini) and stores it in $DATA_DIR/audio-assets.
// Resumable: chunks that already have a file with a matching script hash are skipped.
//
//   npm run audio:generate                 # all approved listening sets missing audio
//   npm run audio:generate -- --limit 10   # at most 10 chunks this run (free-tier friendly)
//   npm run audio:generate -- --set l2-full-01
//   npm run audio:generate -- --status     # show readiness only
//   npm run audio:generate -- --lessons    # only Learn Mode lesson clips
//   npm run audio:generate -- --reading    # "Nghe bài đọc" files for every reading passage → audio-assets/ (commit them)
//
// On Railway, run it from the Admin page instead so files land on the persistent volume.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { library } from "../server/library";
import { audioStatus, generateAudioBatch, AUDIO_ASSETS_DIR, AUDIO_PROVIDER, audioProviderReady, VOICE_MAP, lessonAudioSet, BUNDLED_AUDIO_DIR, readAloud, readAloudName } from "../server/audio";
import { curriculum } from "../server/lessons";
import { speechText, tableSpeech } from "../shared/read-aloud";
import type { ListeningSet, ReadingSet } from "../shared/types";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes("--reading")) await generateReading();

/**
 * Every text the "Nghe bài đọc" button can send: library reading passages (also used by mocks and
 * review) and lesson stimuli that have text but no audio of their own. Same normalisation as the client.
 */
async function generateReading() {
  const texts = new Map<string, string>(); // file -> text
  const add = (raw: string) => { const t = speechText(raw); if (t) texts.set(readAloudName(t), t); };
  for (const item of library().items.values()) {
    if (item.kind !== "reading") continue;
    for (const sec of (item as ReadingSet).sections) add(sec.kind === "table" && sec.table ? tableSpeech(sec.table) : sec.text);
  }
  for (const l of curriculum().lessons.values())
    for (const st of Object.values(l.stimuli ?? {})) if (st.text && !st.audio?.length && !st.audioRef) add(st.text);

  const todo = [...texts].filter(([f]) => !fs.existsSync(path.join(BUNDLED_AUDIO_DIR, f)));
  console.log(`Reading read-aloud: ${texts.size} passage(s), ${todo.length} missing · output: ${BUNDLED_AUDIO_DIR}`);
  if (args.includes("--status")) process.exit(0);
  let next = 0, done = 0;
  const failed: string[] = [];
  const worker = async () => {
    while (next < todo.length) {
      const [file, text] = todo[next++];
      try { await readAloud(text, BUNDLED_AUDIO_DIR); done++; console.log(`  ✓ ${file} (${done}/${todo.length})`); }
      catch (e) { failed.push(file); console.log(`  ✗ ${file}: ${e instanceof Error ? e.message : e}`); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Number(opt("concurrency") ?? 4), 8)) }, worker));

  // Remove bundled files for passages that no longer exist (text edited or removed).
  let pruned = 0;
  if (!failed.length) for (const f of fs.readdirSync(BUNDLED_AUDIO_DIR))
    if (/^tts-[0-9a-f]+\.mp3$/.test(f) && !texts.has(f)) { fs.rmSync(path.join(BUNDLED_AUDIO_DIR, f)); pruned++; }
  console.log(`
Done: ${done} generated, ${failed.length} failed, ${pruned} stale file(s) removed.`);
  process.exit(failed.length ? 1 : 0);
}

// Library listening sets + Learn Mode lesson clips (one synthetic set per lesson; --lessons for lessons only).
const lessonSets = [...curriculum().lessons.values()].map(lessonAudioSet).filter((s) => s.chunks.length);
const sets = [...(args.includes("--lessons") ? [] : [...library().items.values()]), ...lessonSets]
  .filter((i): i is ListeningSet => i.kind === "listening" && (!opt("set") || i.id === opt("set")));

if (args.includes("--status")) {
  for (const s of sets) {
    const st = audioStatus(s);
    console.log(`${st.ready ? "✓" : "…"} ${s.id.padEnd(16)} ${st.chunks.filter((c) => c.file).length}/${st.chunks.length} chunk(s)`);
  }
  console.log(`\n${sets.filter((s) => audioStatus(s).ready).length}/${sets.length} listening sets ready · ${AUDIO_ASSETS_DIR}`);
  process.exit(0);
}

if (!audioProviderReady()) { console.error("AUDIO_PROVIDER=gemini needs GEMINI_API_KEY (.env). The default edge provider needs no key."); process.exit(1); }
console.log(`Provider: ${AUDIO_PROVIDER} · voices: ${JSON.stringify(VOICE_MAP)} · output: ${AUDIO_ASSETS_DIR}`);
generateAudioBatch(sets, { limit: opt("limit") ? Number(opt("limit")) : undefined, concurrency: opt("concurrency") ? Number(opt("concurrency")) : undefined, log: console.log })
  .then((job) => {
    console.log(`\nDone: ${job.done}/${job.total} generated, ${job.failed.length} failed${job.stoppedReason ? ` — stopped: ${job.stoppedReason}` : ""}.`);
    console.log(`${sets.filter((s) => audioStatus(s).ready).length}/${sets.length} listening sets now have complete audio.`);
    process.exit(job.failed.length && !job.done ? 1 : 0);
  })
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
