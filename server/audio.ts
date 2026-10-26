// Layer D: pre-generated listening audio. Generated once (CLI `npm run audio:generate` or the
// admin page), stored under $DATA_DIR/audio-assets (not in git), and reused indefinitely.
// A listening set is "ready" only when every chunk has a WAV file whose hash matches its script.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AudioStatus } from "../shared/content";
import type { ListeningChunk, ListeningSet } from "../shared/types";
import { DATA_DIR } from "./db";
import { AiError, describeError, getClient, recordUsage, TTS_MODEL } from "./ai";

export const AUDIO_ASSETS_DIR = path.join(DATA_DIR, "audio-assets");
const MANIFEST = path.join(AUDIO_ASSETS_DIR, "manifest.json");

// Gemini prebuilt voices per role. Override with GEMINI_TTS_VOICES='{"female_a":"Kore",...}'.
const DEFAULT_VOICES: Record<string, string> = { female_a: "Kore", female_b: "Aoede", male_a: "Orus", male_b: "Puck", narrator: "Charon" };
export const VOICE_MAP: Record<string, string> = { ...DEFAULT_VOICES, ...safeJson(process.env.GEMINI_TTS_VOICES) };

function safeJson(s: string | undefined): Record<string, string> {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

export interface ManifestEntry {
  setId: string;
  chunk: number;
  hash: string;
  durationSec: number;
  model: string;
  voices: Record<string, string>;
  createdAt: string;
  segments: { start: number; end: number }[] | null; // exact offsets when generated per segment
}

let manifest: Record<string, ManifestEntry> | null = null;

function loadManifest(): Record<string, ManifestEntry> {
  if (manifest) return manifest;
  try { manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { manifest = {}; }
  return manifest!;
}

function saveManifest() {
  fs.mkdirSync(AUDIO_ASSETS_DIR, { recursive: true });
  const tmp = MANIFEST + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 1));
  fs.renameSync(tmp, MANIFEST);
}

export function chunkHash(chunk: ListeningChunk): string {
  const basis = JSON.stringify({ v: 1, voices: VOICE_MAP, segs: chunk.segments.map((s) => [s.speaker, s.voice, s.text]) });
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 12);
}

export const chunkFile = (setId: string, i: number, hash: string) => `${setId}-c${i}-${hash}.wav`;

export function audioStatus(set: ListeningSet): AudioStatus {
  const m = loadManifest();
  const chunks = set.chunks.map((c, i) => {
    const hash = chunkHash(c);
    const file = chunkFile(set.id, i, hash);
    const ok = Boolean(m[file]) && fs.existsSync(path.join(AUDIO_ASSETS_DIR, file));
    return { file: ok ? file : null, durationSec: ok ? m[file].durationSec : null, hash };
  });
  return { ready: chunks.every((c) => c.file), chunks };
}

export function manifestEntry(file: string): ManifestEntry | null {
  return loadManifest()[file] ?? null;
}

// ---------- WAV helpers (Gemini TTS returns 16-bit mono PCM) ----------

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function tts(text: string, speakers: { name: string; voice: string }[]): Promise<{ pcm: Buffer; rate: number }> {
  const speechConfig = speakers.length === 1
    ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: speakers[0].voice } } }
    : { multiSpeakerVoiceConfig: { speakerVoiceConfigs: speakers.map((s) => ({ speaker: s.name, voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } } })) } };
  try {
    const res = await getClient().models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: { responseModalities: ["AUDIO"], speechConfig },
    });
    recordUsage("tts", TTS_MODEL, true, res.usageMetadata, null);
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    const data = part?.inlineData?.data;
    if (!data) throw new AiError("Gemini TTS không trả về audio.", 502);
    const rate = Number(/rate=(\d+)/.exec(part?.inlineData?.mimeType ?? "")?.[1] ?? 24000);
    return { pcm: Buffer.from(data, "base64"), rate };
  } catch (e) {
    const err = describeError(e);
    recordUsage("tts", TTS_MODEL, false, undefined, err.message);
    throw err;
  }
}

const STYLE = "Read this aloud as a natural, unscripted-sounding everyday conversation in clear Canadian English, at a normal conversational pace.";

/** Generates one chunk. ≤ 2 speakers → a single TTS request; 3+ speakers → per-segment requests joined with short pauses. */
async function generateChunk(set: ListeningSet, i: number): Promise<{ file: string; entry: ManifestEntry }> {
  const chunk = set.chunks[i];
  const hash = chunkHash(chunk);
  const file = chunkFile(set.id, i, hash);
  const names = [...new Set(chunk.segments.map((s) => s.speaker))];
  const voiceOf = (name: string) => VOICE_MAP[chunk.segments.find((s) => s.speaker === name)!.voice] ?? VOICE_MAP.narrator;
  let pcm: Buffer;
  let rate = 24000;
  let segments: ManifestEntry["segments"] = null;

  if (names.length === 1) {
    const out = await tts(`${set.taskType === "L4" ? "Read this local news report in a clear, professional Canadian English newscaster voice." : STYLE}\n\n${chunk.segments.map((s) => s.text).join(" ")}`, [{ name: names[0], voice: voiceOf(names[0]) }]);
    pcm = out.pcm; rate = out.rate;
  } else if (names.length === 2) {
    // Speaker labels must be simple tokens for multi-speaker TTS.
    const label = new Map(names.map((n, k) => [n, k === 0 ? "SpeakerA" : "SpeakerB"]));
    const script = chunk.segments.map((s) => `${label.get(s.speaker)}: ${s.text}`).join("\n");
    const out = await tts(`${STYLE}\n\n${script}`, names.map((n) => ({ name: label.get(n)!, voice: voiceOf(n) })));
    pcm = out.pcm; rate = out.rate;
  } else {
    const parts: Buffer[] = [];
    segments = [];
    let offset = 0;
    for (const s of chunk.segments) {
      const out = await tts(`${STYLE} You are one participant in a meeting.\n\n${s.text}`, [{ name: s.speaker, voice: voiceOf(s.speaker) }]);
      rate = out.rate;
      const gap = Buffer.alloc(Math.round(rate * 0.35) * 2);
      segments.push({ start: offset / (rate * 2), end: (offset + out.pcm.length) / (rate * 2) });
      parts.push(out.pcm, gap);
      offset += out.pcm.length + gap.length;
    }
    pcm = Buffer.concat(parts);
  }

  fs.mkdirSync(AUDIO_ASSETS_DIR, { recursive: true });
  const tmp = path.join(AUDIO_ASSETS_DIR, file + ".tmp");
  fs.writeFileSync(tmp, wav(pcm, rate));
  fs.renameSync(tmp, path.join(AUDIO_ASSETS_DIR, file));
  const entry: ManifestEntry = {
    setId: set.id, chunk: i, hash, durationSec: Math.round((pcm.length / (rate * 2)) * 10) / 10, model: TTS_MODEL,
    voices: Object.fromEntries(names.map((n) => [n, voiceOf(n)])), createdAt: new Date().toISOString(), segments,
  };
  return { file, entry };
}

export interface AudioJob {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  total: number; // chunks needing audio when the job started
  done: number;
  failed: { file: string; error: string }[];
  stoppedReason: string | null;
  current: string | null;
}

export const audioJob: AudioJob = { running: false, startedAt: null, finishedAt: null, total: 0, done: 0, failed: [], stoppedReason: null, current: null };
let stopRequested = false;
export const stopAudioJob = () => { stopRequested = true; };

/**
 * Resumable batch: skips chunks whose file already exists with a matching hash, writes each
 * file atomically and updates the manifest after every success. Stops on rate limits.
 */
export async function generateAudioBatch(sets: ListeningSet[], opts: { limit?: number; log?: (s: string) => void } = {}): Promise<AudioJob> {
  if (audioJob.running) throw new AiError("Một lượt tạo audio đang chạy.", 409);
  const log = opts.log ?? (() => {});
  const todo: { set: ListeningSet; i: number }[] = [];
  for (const set of sets) {
    const st = audioStatus(set);
    st.chunks.forEach((c, i) => { if (!c.file) todo.push({ set, i }); });
  }
  const queue = todo.slice(0, opts.limit ?? todo.length);
  Object.assign(audioJob, { running: true, startedAt: new Date().toISOString(), finishedAt: null, total: queue.length, done: 0, failed: [], stoppedReason: null, current: null });
  stopRequested = false;
  log(`Audio: ${todo.length} chunk(s) missing, generating ${queue.length}.`);
  try {
    for (const { set, i } of queue) {
      if (stopRequested) { audioJob.stoppedReason = "Đã dừng theo yêu cầu."; break; }
      audioJob.current = `${set.id} chunk ${i + 1}/${set.chunks.length}`;
      try {
        const { file, entry } = await generateChunk(set, i);
        loadManifest()[file] = entry;
        // Drop manifest entries of older versions of this chunk.
        for (const [k, v] of Object.entries(loadManifest())) {
          if (v.setId === set.id && v.chunk === i && k !== file) {
            delete manifest![k];
            fs.rmSync(path.join(AUDIO_ASSETS_DIR, k), { force: true });
          }
        }
        saveManifest();
        audioJob.done += 1;
        log(`  ✓ ${file} (${entry.durationSec}s)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        audioJob.failed.push({ file: `${set.id}-c${i}`, error: msg });
        log(`  ✗ ${set.id} chunk ${i}: ${msg}`);
        if (e instanceof AiError && (e.status === 429 || e.status === 401 || e.status === 503)) {
          audioJob.stoppedReason = msg;
          break;
        }
      }
    }
  } finally {
    audioJob.running = false;
    audioJob.current = null;
    audioJob.finishedAt = new Date().toISOString();
  }
  return audioJob;
}
