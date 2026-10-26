import { useEffect, useRef, useState } from "react";
import type { ListeningSegment } from "../../shared/types";
import { loadVoices, speak, splitSentences, stopSpeaking, type VoiceRole } from "../lib/speech";

/**
 * Plays a list of dialogue segments with synthesized voices.
 * exam = true: one play only, no pause/seek/speed (as in the real test).
 */
export function SegmentPlayer({
  segments, exam, onFinished, preferredVoice, autoStart,
}: {
  segments: ListeningSegment[];
  exam: boolean;
  onFinished: () => void;
  preferredVoice?: string | null;
  autoStart?: boolean;
}) {
  const [state, setState] = useState<"idle" | "playing" | "done">("idle");
  const [index, setIndex] = useState(0);
  const [rate, setRate] = useState(1);
  const token = useRef(0);
  const finished = useRef(false);

  useEffect(() => () => { token.current += 1; stopSpeaking(); }, []);

  const play = async (from = 0) => {
    await loadVoices();
    const my = ++token.current;
    stopSpeaking();
    setState("playing");
    for (let i = from; i < segments.length; i++) {
      if (token.current !== my) return;
      setIndex(i);
      await speak(segments[i].text, segments[i].voice as VoiceRole, { rate, preferred: preferredVoice });
      await new Promise((r) => setTimeout(r, 250)); // natural gap between turns
    }
    if (token.current !== my) return;
    setState("done");
    if (!finished.current) { finished.current = true; onFinished(); }
  };

  useEffect(() => {
    if (autoStart) void play(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stop = () => { token.current += 1; stopSpeaking(); setState("idle"); };
  const pct = segments.length ? ((index + (state === "done" ? 1 : 0)) / segments.length) * 100 : 0;

  return (
    <div className="player">
      <div className="player-bar"><div style={{ width: `${pct}%` }} /></div>
      <div className="row gap-s wrap">
        {exam ? (
          state === "idle" && !finished.current
            ? <button className="btn primary" onClick={() => play(0)}>▶ Phát (chỉ một lần)</button>
            : <span className="muted small">{state === "playing" ? "🔊 Đang phát… (không thể tạm dừng trong chế độ thi)" : "Đã phát xong."}</span>
        ) : (
          <>
            {state !== "playing"
              ? <button className="btn primary" onClick={() => play(state === "done" ? 0 : index)}>{state === "done" ? "↻ Nghe lại" : index > 0 ? "▶ Tiếp tục" : "▶ Phát"}</button>
              : <button className="btn" onClick={stop}>⏸ Dừng</button>}
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={state === "playing"} title="Tốc độ">
              {[0.75, 0.85, 1, 1.1, 1.25].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            {state !== "done" && !finished.current && <button className="btn ghost small" onClick={() => { stop(); finished.current = true; setState("done"); onFinished(); }}>Bỏ qua tới câu hỏi</button>}
          </>
        )}
        <span className="muted small">Đoạn {Math.min(index + 1, segments.length)}/{segments.length}</span>
      </div>
    </div>
  );
}

export interface ChunkAudio { url: string | null; durationSec: number | null; segments: { start: number; end: number }[] | null }

/**
 * Plays one pre-generated audio file.
 * exam = true: a single play, no controls, no pause/seek/speed (as in the real test).
 */
export function AudioChunkPlayer({ audio, exam, onFinished }: { audio: ChunkAudio; exam: boolean; onFinished: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<"idle" | "playing" | "done">("idle");
  const [rate, setRate] = useState(1);
  const [pos, setPos] = useState(0);
  const finished = useRef(false);
  const finish = () => { setState("done"); if (!finished.current) { finished.current = true; onFinished(); } };
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate]);
  const dur = audio.durationSec ?? 1;

  if (!audio.url) return <div className="error-box small">Thiếu file audio.</div>;
  return (
    <div className="player">
      <audio
        ref={ref}
        src={audio.url}
        preload="auto"
        controls={!exam}
        className={exam ? "hidden" : "audio"}
        onPlay={() => setState("playing")}
        onEnded={finish}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onSeeking={(e) => { if (exam && Math.abs(e.currentTarget.currentTime - pos) > 1) e.currentTarget.currentTime = pos; }}
        onPause={(e) => { if (exam && !e.currentTarget.ended) void e.currentTarget.play(); }}
      />
      <div className="player-bar"><div style={{ width: `${Math.min(100, (pos / dur) * 100)}%` }} /></div>
      <div className="row gap-s wrap">
        {exam ? (
          state === "idle"
            ? <button className="btn primary" onClick={() => void ref.current?.play()}>▶ Phát (chỉ một lần)</button>
            : <span className="muted small">{state === "playing" ? "🔊 Đang phát… (không thể tạm dừng trong chế độ thi)" : "Đã phát xong."}</span>
        ) : (
          <>
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Tốc độ">
              {[0.75, 0.85, 1, 1.1, 1.25].map((r) => <option key={r} value={r}>{r}×</option>)}
            </select>
            {state !== "done" && <button className="btn ghost small" onClick={() => { ref.current?.pause(); finish(); }}>Bỏ qua tới câu hỏi</button>}
          </>
        )}
        <span className="muted small">{Math.round(pos)}s / {Math.round(dur)}s</span>
      </div>
    </div>
  );
}

/**
 * Transcript with replay from the pre-generated audio. Offsets are exact when the audio was generated
 * per segment, otherwise estimated from text length (marked ≈).
 */
export function AudioTranscript({ segments, audio, evidence }: { segments: ListeningSegment[]; audio: ChunkAudio; evidence: string[] }) {
  const ref = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const isEvidence = (s: string) => evidence.some((e) => e && (s.toLowerCase().includes(e.toLowerCase().slice(0, 30)) || e.toLowerCase().includes(s.toLowerCase().slice(0, 30))));
  const dur = audio.durationSec ?? 0;
  const total = segments.reduce((n, s) => n + s.text.length, 0) || 1;
  let acc = 0;
  const timed = segments.map((seg, i) => {
    const segStart = audio.segments?.[i]?.start ?? (acc / total) * dur;
    const segEnd = audio.segments?.[i]?.end ?? ((acc + seg.text.length) / total) * dur;
    acc += seg.text.length;
    const sents = splitSentences(seg.text);
    const len = sents.reduce((n, s) => n + s.length, 0) || 1;
    let a = 0;
    return {
      seg,
      sents: sents.map((s) => {
        const st = segStart + (a / len) * (segEnd - segStart);
        a += s.length;
        return { text: s, start: Math.max(0, st - 0.3), end: segStart + (a / len) * (segEnd - segStart) + 0.3 };
      }),
    };
  });
  const play = (start: number, end: number) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = start;
    stopAt.current = end;
    void el.play();
  };
  return (
    <div className="transcript">
      <audio ref={ref} src={audio.url ?? undefined} controls className="audio" onTimeUpdate={(e) => { if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) { e.currentTarget.pause(); stopAt.current = null; } }} />
      {timed.map(({ seg, sents }, i) => (
        <div key={i} className="t-seg">
          <span className="speaker">{seg.speaker}:</span>{" "}
          {sents.map((s, j) => (
            <span key={j} className={`t-sent ${isEvidence(s.text) ? "evidence" : ""}`} onClick={() => play(s.start, s.end)} title="Bấm để nghe lại câu này">{s.text}{" "}</span>
          ))}
        </div>
      ))}
      <p className="muted tiny">Bấm vào một câu để nghe lại {audio.segments ? "" : "(vị trí ≈ ước lượng theo độ dài câu)"}. Câu tô vàng là bằng chứng cho đáp án.</p>
    </div>
  );
}

/** Transcript with sentence-level replay, shown only after answering. */
export function Transcript({ segments, evidence, preferredVoice }: { segments: ListeningSegment[]; evidence: string[]; preferredVoice?: string | null }) {
  const [rate, setRate] = useState(0.9);
  const isEvidence = (s: string) => evidence.some((e) => e && (s.toLowerCase().includes(e.toLowerCase().slice(0, 30)) || e.toLowerCase().includes(s.toLowerCase().slice(0, 30))));
  return (
    <div className="transcript">
      <div className="row gap-s small">
        Tốc độ nghe lại:
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>{[0.7, 0.8, 0.9, 1].map((r) => <option key={r} value={r}>{r}×</option>)}</select>
      </div>
      {segments.map((seg, i) => (
        <div key={i} className="t-seg">
          <span className="speaker">{seg.speaker}:</span>{" "}
          {splitSentences(seg.text).map((s, j) => (
            <span key={j} className={`t-sent ${isEvidence(s) ? "evidence" : ""}`} onClick={async () => { stopSpeaking(); await loadVoices(); void speak(s, seg.voice as VoiceRole, { rate, preferred: preferredVoice }); }} title="Bấm để nghe lại câu này">
              {s}{" "}
            </span>
          ))}
        </div>
      ))}
      <p className="muted tiny">Bấm vào bất kỳ câu nào để nghe lại. Câu tô vàng là bằng chứng cho đáp án.</p>
    </div>
  );
}
