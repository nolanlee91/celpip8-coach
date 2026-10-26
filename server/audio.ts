// Layer D: pre-generated listening audio. Generated once (CLI `npm run audio:generate` or the
// admin page), stored under $DATA_DIR/audio-assets (not in git), and reused indefinitely.
// A listening set is "ready" only when every chunk has a file whose hash matches its script.
//
// Providers (AUDIO_PROVIDER):
//   edge   (default) — Microsoft Edge "Read Aloud" neural voices via msedge-tts. No API key; en-CA voices.
//                      Unofficial service: availability and terms may change, so treat it as best effort.
//   gemini           — Gemini TTS (needs GEMINI_API_KEY); multi-speaker in one request.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import type { AudioStatus } from "../shared/content";
import type { ListeningChunk, ListeningSet } from "../shared/types";
import { DATA_DIR } from "./db";
import { AiError, describeError, getClient, recordUsage, TTS_MODEL } from "./ai";

/** Audio generated on this machine/server (persistent volume). */
export const AUDIO_ASSETS_DIR = path.join(DATA_DIR, "audio-assets");
const MANIFEST = path.join(AUDIO_ASSETS_DIR, "manifest.json");
/** Audio shipped with the code (committed to git) so a fresh deploy can play listening sets immediately. Read-only. */
export const BUNDLED_AUDIO_DIR = path.resolve(process.env.BUNDLED_AUDIO_DIR || "audio-assets");

export type AudioProvider = "edge" | "gemini";
export const AUDIO_PROVIDER: AudioProvider = process.env.AUDIO_PROVIDER === "gemini" ? "gemini" : "edge";

function safeJson(s: string | undefined): Record<string, string> {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

// Voice per script role. Only two Canadian neural voices exist in Edge, so the second pair uses US voices.
// Override with EDGE_TTS_VOICES / GEMINI_TTS_VOICES (JSON).
const EDGE_VOICES: Record<string, string> = {
  female_a: "en-CA-ClaraNeural", male_a: "en-CA-LiamNeural", narrator: "en-CA-LiamNeural",
  female_b: "en-US-JennyNeural", male_b: "en-US-GuyNeural",
  ...safeJson(process.env.EDGE_TTS_VOICES),
};
const GEMINI_VOICES: Record<string, string> = {
  female_a: "Kore", female_b: "Aoede", male_a: "Orus", male_b: "Puck", narrator: "Charon",
  ...safeJson(process.env.GEMINI_TTS_VOICES),
};
export const VOICE_MAP = AUDIO_PROVIDER === "edge" ? EDGE_VOICES : GEMINI_VOICES;
const EXT = AUDIO_PROVIDER === "edge" ? "mp3" : "wav";
const MODEL_LABEL = AUDIO_PROVIDER === "edge" ? "edge-tts:audio-24khz-48kbitrate-mono-mp3" : TTS_MODEL;

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

let bundled: Record<string, ManifestEntry> | null = null;
function loadBundled(): Record<string, ManifestEntry> {
  if (bundled) return bundled;
  if (path.resolve(BUNDLED_AUDIO_DIR) === path.resolve(AUDIO_ASSETS_DIR)) return (bundled = {});
  try { bundled = JSON.parse(fs.readFileSync(path.join(BUNDLED_AUDIO_DIR, "manifest.json"), "utf8")); } catch { bundled = {}; }
  return bundled!;
}

/** Full path of an audio file in the generated or bundled store (null if missing). */
export function audioFilePath(file: string): string | null {
  const name = path.basename(file);
  if (loadManifest()[name] && fs.existsSync(path.join(AUDIO_ASSETS_DIR, name))) return path.join(AUDIO_ASSETS_DIR, name);
  if (loadBundled()[name] && fs.existsSync(path.join(BUNDLED_AUDIO_DIR, name))) return path.join(BUNDLED_AUDIO_DIR, name);
  return null;
}

function saveManifest() {
  fs.mkdirSync(AUDIO_ASSETS_DIR, { recursive: true });
  const tmp = MANIFEST + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 1));
  fs.renameSync(tmp, MANIFEST);
}

/** Hash of the script + provider + voices: editing a script or switching voices regenerates that chunk. */
export function chunkHash(chunk: ListeningChunk): string {
  const basis = JSON.stringify({ v: 2, provider: AUDIO_PROVIDER, voices: VOICE_MAP, segs: chunk.segments.map((s) => [s.speaker, s.voice, s.text]) });
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 12);
}

export const chunkFile = (setId: string, i: number, hash: string) => `${setId}-c${i}-${hash}.${EXT}`;

export function audioStatus(set: ListeningSet): AudioStatus {
  const chunks = set.chunks.map((c, i) => {
    const hash = chunkHash(c);
    const file = chunkFile(set.id, i, hash);
    const ok = audioFilePath(file) !== null;
    return { file: ok ? file : null, durationSec: ok ? manifestEntry(file)!.durationSec : null, hash };
  });
  return { ready: chunks.every((c) => c.file), chunks };
}

export function manifestEntry(file: string): ManifestEntry | null {
  return loadManifest()[file] ?? loadBundled()[file] ?? null;
}

// ---------- Edge TTS (MP3, 24 kHz 48 kbps mono = constant 6000 bytes/s) ----------

const MP3_BYTES_PER_SEC = 48000 / 8;
// One silent MPEG-2 Layer III frame matching Edge's output (48 kbps, 24 kHz, mono): 144 bytes = 24 ms.
const SILENT_FRAME = Buffer.concat([Buffer.from([0xff, 0xf3, 0x64, 0xc4]), Buffer.alloc(140)]);
const silence = (sec: number) => Buffer.concat(Array(Math.round(sec / 0.024)).fill(SILENT_FRAME));

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** One Edge connection per worker so several chunks can be synthesized in parallel. */
class EdgeClient {
  private tts: MsEdgeTTS | null = null;
  private voice = "";
  close() { try { this.tts?.close(); } catch { /* ignore */ } this.tts = null; }
  async synth(text: string, voice: string): Promise<Buffer> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!this.tts) { this.tts = new MsEdgeTTS({ synthesisTimeoutMs: 60000 }); this.voice = ""; }
        if (this.voice !== voice) {
          await this.tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
          this.voice = voice;
        }
        const { audioStream } = this.tts.toStream(xmlEscape(text));
        const parts: Buffer[] = [];
        for await (const c of audioStream) parts.push(c as Buffer);
        const buf = Buffer.concat(parts);
        if (buf.length < 1000) throw new Error("audio quá ngắn hoặc rỗng");
        return buf;
      } catch (e) {
        lastErr = e;
        this.close();
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw new AiError(`Edge TTS lỗi: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, 502);
  }
}

// ---------- Gemini TTS (16-bit mono PCM → WAV) ----------

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function geminiTts(text: string, speakers: { name: string; voice: string }[]): Promise<{ pcm: Buffer; rate: number }> {
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

async function generateChunk(set: ListeningSet, i: number, edge: EdgeClient): Promise<{ file: string; entry: ManifestEntry }> {
  const chunk = set.chunks[i];
  const hash = chunkHash(chunk);
  const file = chunkFile(set.id, i, hash);
  const names = [...new Set(chunk.segments.map((s) => s.speaker))];
  const voiceOf = (name: string) => VOICE_MAP[chunk.segments.find((s) => s.speaker === name)!.voice] ?? VOICE_MAP.narrator;
  let data: Buffer;
  let durationSec: number;
  let segments: ManifestEntry["segments"] = null;

  if (AUDIO_PROVIDER === "edge") {
    // One request per segment; offsets are exact because the MP3 is constant bitrate.
    const parts: Buffer[] = [];
    segments = [];
    let bytes = 0;
    for (const s of chunk.segments) {
      const buf = await edge.synth(s.text, VOICE_MAP[s.voice] ?? VOICE_MAP.narrator);
      segments.push({ start: bytes / MP3_BYTES_PER_SEC, end: (bytes + buf.length) / MP3_BYTES_PER_SEC });
      const gap = silence(names.length === 1 ? 0.25 : 0.4);
      parts.push(buf, gap);
      bytes += buf.length + gap.length;
    }
    data = Buffer.concat(parts);
    durationSec = data.length / MP3_BYTES_PER_SEC;
  } else {
    let pcm: Buffer;
    let rate = 24000;
    if (names.length === 1) {
      const out = await geminiTts(`${set.taskType === "L4" ? "Read this local news report in a clear, professional Canadian English newscaster voice." : STYLE}\n\n${chunk.segments.map((s) => s.text).join(" ")}`, [{ name: names[0], voice: voiceOf(names[0]) }]);
      pcm = out.pcm; rate = out.rate;
    } else if (names.length === 2) {
      // Speaker labels must be simple tokens for multi-speaker TTS.
      const label = new Map(names.map((n, k) => [n, k === 0 ? "SpeakerA" : "SpeakerB"]));
      const script = chunk.segments.map((s) => `${label.get(s.speaker)}: ${s.text}`).join("\n");
      const out = await geminiTts(`${STYLE}\n\n${script}`, names.map((n) => ({ name: label.get(n)!, voice: voiceOf(n) })));
      pcm = out.pcm; rate = out.rate;
    } else {
      const parts: Buffer[] = [];
      segments = [];
      let offset = 0;
      for (const s of chunk.segments) {
        const out = await geminiTts(`${STYLE} You are one participant in a meeting.\n\n${s.text}`, [{ name: s.speaker, voice: voiceOf(s.speaker) }]);
        rate = out.rate;
        const gap = Buffer.alloc(Math.round(rate * 0.35) * 2);
        segments.push({ start: offset / (rate * 2), end: (offset + out.pcm.length) / (rate * 2) });
        parts.push(out.pcm, gap);
        offset += out.pcm.length + gap.length;
      }
      pcm = Buffer.concat(parts);
    }
    data = wav(pcm, rate);
    durationSec = pcm.length / (rate * 2);
  }

  fs.mkdirSync(AUDIO_ASSETS_DIR, { recursive: true });
  const tmp = path.join(AUDIO_ASSETS_DIR, file + ".tmp");
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, path.join(AUDIO_ASSETS_DIR, file));
  const entry: ManifestEntry = {
    setId: set.id, chunk: i, hash, durationSec: Math.round(durationSec * 10) / 10, model: MODEL_LABEL,
    voices: Object.fromEntries(names.map((n) => [n, voiceOf(n)])), createdAt: new Date().toISOString(),
    segments: segments?.map((s) => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100 })) ?? null,
  };
  return { file, entry };
}

export interface AudioJob {
  running: boolean;
  provider: AudioProvider;
  startedAt: string | null;
  finishedAt: string | null;
  total: number; // chunks needing audio when the job started
  done: number;
  failed: { file: string; error: string }[];
  stoppedReason: string | null;
  current: string | null;
}

export const audioJob: AudioJob = { running: false, provider: AUDIO_PROVIDER, startedAt: null, finishedAt: null, total: 0, done: 0, failed: [], stoppedReason: null, current: null };
let stopRequested = false;
export const stopAudioJob = () => { stopRequested = true; };

/** True when the configured provider can run here (Edge needs no key; Gemini needs GEMINI_API_KEY). */
export const audioProviderReady = () => AUDIO_PROVIDER === "edge" || Boolean(process.env.GEMINI_API_KEY);

/**
 * Resumable batch: skips chunks whose file already exists with a matching hash, writes each
 * file atomically and updates the manifest after every success. Stops on rate limits / auth errors,
 * or after 3 consecutive failures.
 */
export async function generateAudioBatch(sets: ListeningSet[], opts: { limit?: number; concurrency?: number; log?: (s: string) => void } = {}): Promise<AudioJob> {
  if (audioJob.running) throw new AiError("Một lượt tạo audio đang chạy.", 409);
  const log = opts.log ?? (() => {});
  const todo: { set: ListeningSet; i: number }[] = [];
  for (const set of sets) {
    const st = audioStatus(set);
    st.chunks.forEach((c, i) => { if (!c.file) todo.push({ set, i }); });
  }
  const queue = todo.slice(0, opts.limit ?? todo.length);
  // Edge: several chunks in parallel. Gemini: sequential to stay inside free-tier rate limits.
  const workers = AUDIO_PROVIDER === "edge" ? Math.max(1, Math.min(opts.concurrency ?? 4, 8)) : 1;
  Object.assign(audioJob, { running: true, provider: AUDIO_PROVIDER, startedAt: new Date().toISOString(), finishedAt: null, total: queue.length, done: 0, failed: [], stoppedReason: null, current: null });
  stopRequested = false;
  log(`Audio (${AUDIO_PROVIDER}): ${todo.length} chunk(s) missing, generating ${queue.length} with ${workers} worker(s).`);
  let consecutiveFailures = 0;
  let next = 0;
  const inFlight = new Set<string>();

  const worker = async () => {
    const edge = new EdgeClient();
    try {
      while (next < queue.length && !audioJob.stoppedReason) {
        if (stopRequested) { audioJob.stoppedReason = "Đã dừng theo yêu cầu."; break; }
        const { set, i } = queue[next++];
        const label = `${set.id} chunk ${i + 1}/${set.chunks.length}`;
        inFlight.add(label);
        audioJob.current = [...inFlight].join(", ");
        try {
          const { file, entry } = await generateChunk(set, i, edge);
          // Manifest updates are synchronous, so parallel workers cannot interleave them.
          loadManifest()[file] = entry;
          for (const [k, v] of Object.entries(loadManifest())) {
            if (v.setId === set.id && v.chunk === i && k !== file) {
              delete manifest![k];
              fs.rmSync(path.join(AUDIO_ASSETS_DIR, k), { force: true });
            }
          }
          saveManifest();
          audioJob.done += 1;
          consecutiveFailures = 0;
          log(`  ✓ ${file} (${entry.durationSec}s)`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          audioJob.failed.push({ file: `${set.id}-c${i}`, error: msg });
          consecutiveFailures += 1;
          log(`  ✗ ${set.id} chunk ${i}: ${msg}`);
          if ((e instanceof AiError && [429, 401, 503].includes(e.status)) || consecutiveFailures >= 3) audioJob.stoppedReason = msg;
        } finally {
          inFlight.delete(label);
          audioJob.current = [...inFlight].join(", ") || null;
        }
      }
    } finally {
      edge.close();
    }
  };

  try {
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    audioJob.running = false;
    audioJob.current = null;
    audioJob.finishedAt = new Date().toISOString();
  }
  return audioJob;
}
