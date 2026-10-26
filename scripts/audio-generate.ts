// Pre-generates listening audio once (AUDIO_PROVIDER: edge by default, or gemini) and stores it in $DATA_DIR/audio-assets.
// Resumable: chunks that already have a file with a matching script hash are skipped.
//
//   npm run audio:generate                 # all approved listening sets missing audio
//   npm run audio:generate -- --limit 10   # at most 10 chunks this run (free-tier friendly)
//   npm run audio:generate -- --set l2-full-01
//   npm run audio:generate -- --status     # show readiness only
//   npm run audio:generate -- --lessons    # only Learn Mode lesson clips
//
// On Railway, run it from the Admin page instead so files land on the persistent volume.

import "dotenv/config";
import { library } from "../server/library";
import { audioStatus, generateAudioBatch, AUDIO_ASSETS_DIR, AUDIO_PROVIDER, audioProviderReady, VOICE_MAP, lessonAudioSet } from "../server/audio";
import { curriculum } from "../server/lessons";
import type { ListeningSet } from "../shared/types";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

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
