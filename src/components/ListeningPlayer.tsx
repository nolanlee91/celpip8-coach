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
