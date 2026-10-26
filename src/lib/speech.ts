// Browser speech: text-to-speech for listening audio and pronunciation,
// speech-to-text + MediaRecorder for speaking practice.

export type VoiceRole = "female_a" | "male_a" | "female_b" | "male_b" | "narrator";

const FEMALE = /(female|woman|clara|jenny|aria|sonia|libby|samantha|zira|susan|karen|moira|tessa|ava|emma|michelle|natasha|hazel|linda|heather)/i;
const MALE = /(male|man|liam|guy|davis|ryan|daniel|david|mark|george|alex|fred|tom|eric|christopher|william|brian|andrew|thomas)/i;

let voicesCache: SpeechSynthesisVoice[] = [];

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  const get = () => speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
  voicesCache = get();
  if (voicesCache.length) return Promise.resolve(voicesCache);
  return new Promise((resolve) => {
    const done = () => { voicesCache = get(); resolve(voicesCache); };
    speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1500);
  });
}

/** Prefer Canadian English, then natural/online voices, then US, then any English. */
function rank(v: SpeechSynthesisVoice): number {
  let s = 0;
  const lang = v.lang.toLowerCase();
  if (lang === "en-ca") s += 100;
  else if (lang === "en-us") s += 50;
  else if (lang === "en-gb") s += 20;
  if (/natural|online|neural|premium|enhanced/i.test(v.name)) s += 40;
  if (/google/i.test(v.name)) s += 10;
  return s;
}

export function voiceFor(role: VoiceRole, preferred?: string | null): { voice: SpeechSynthesisVoice | null; pitch: number; rate: number } {
  const voices = [...voicesCache].sort((a, b) => rank(b) - rank(a));
  const female = voices.filter((v) => FEMALE.test(v.name));
  const male = voices.filter((v) => MALE.test(v.name));
  const pref = preferred ? voices.find((v) => v.name === preferred) ?? null : null;
  const pick = (list: SpeechSynthesisVoice[], i: number) => list[i] ?? list[0] ?? voices[i] ?? voices[0] ?? null;
  switch (role) {
    case "narrator": return { voice: pref ?? pick(voices, 0), pitch: 1, rate: 1 };
    case "female_a": return { voice: pick(female, 0), pitch: 1.05, rate: 1 };
    case "female_b": return { voice: pick(female, 1), pitch: female.length > 1 ? 1 : 1.2, rate: 1.03 };
    case "male_a": return { voice: pick(male, 0), pitch: 0.95, rate: 1 };
    case "male_b": return { voice: pick(male, 1), pitch: male.length > 1 ? 1 : 0.8, rate: 0.97 };
  }
}

export function speak(text: string, role: VoiceRole = "narrator", opts: { rate?: number; preferred?: string | null } = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(role, opts.preferred);
    if (v.voice) { u.voice = v.voice; u.lang = v.voice.lang; } else u.lang = "en-CA";
    u.pitch = v.pitch;
    u.rate = v.rate * (opts.rate ?? 1);
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

export function splitSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [text];
}

// ---------------- Speech-to-text ----------------

type RecognitionCtor = new () => {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] & { length: number } }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
};

export const sttSupported = () =>
  Boolean((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

/** Continuous recognition that restarts itself when the browser ends a session early. */
export function startRecognition(onText: (finalText: string, interim: string) => void, onError: (msg: string) => void) {
  const Ctor = ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition)!;
  let finalText = "";
  let active = true;
  let rec = new Ctor();
  const setup = () => {
    rec.lang = "en-CA";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript.trim() + " ";
        else interim += r[0].transcript;
      }
      onText(finalText.trim(), interim);
    };
    rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") onError(e.error); };
    rec.onend = () => {
      if (!active) return;
      rec = new Ctor();
      setup();
      try { rec.start(); } catch { /* already started */ }
    };
  };
  setup();
  rec.start();
  return {
    stop: () => { active = false; try { rec.stop(); } catch { /* ignore */ } return finalText.trim(); },
  };
}

// ---------------- Recorder ----------------

export async function startRecorder() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.start(1000);
  return {
    stop: () => new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      };
      rec.stop();
    }),
  };
}

export async function uploadAudio(blob: Blob): Promise<string | null> {
  try {
    const res = await fetch("/api/audio", { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob });
    return (await res.json()).file ?? null;
  } catch {
    return null;
  }
}
