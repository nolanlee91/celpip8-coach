import { useEffect, useRef, useState } from "react";
import type { SpeakingPrompt } from "../../shared/types";
import { SPEAKING_TASKS } from "../../shared/spec";
import { startRecognition, startRecorder, sttSupported, uploadAudio } from "../lib/speech";
import { Card, TimerPill, useCountdown } from "./ui";

export interface SpeakingOutput {
  transcript: string;
  durationSec: number;
  transcriptSource: "speech-to-text" | "typed";
  audioFile: string | null;
  audioUrl: string | null;
  chosenOption: string | null;
}

type Phase = "ready" | "select" | "prep" | "speak" | "review";

export function SceneImage({ svg }: { svg: string }) {
  return <img className="scene" alt="Hình minh họa đề bài" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />;
}

/**
 * Runs one speaking task: (Task 5 option selection) → preparation → recording with live transcription.
 * exam = true starts automatically and skips the editable-transcript review step.
 */
export function SpeakingRunner({ prompt, exam, onComplete }: { prompt: SpeakingPrompt; exam: boolean; onComplete: (o: SpeakingOutput) => void }) {
  const spec = SPEAKING_TASKS.find((t) => t.id === prompt.taskType)!;
  const [phase, setPhase] = useState<Phase>(exam ? (spec.selectSec ? "select" : "prep") : "ready");
  const [chosen, setChosen] = useState<string | null>(null);
  const [finalText, setFinalText] = useState("");
  const [interim, setInterim] = useState("");
  const [typed, setTyped] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<string | null>(null);
  const [speakSec, setSpeakSec] = useState(0);
  const rec = useRef<{ stop: () => Promise<Blob> } | null>(null);
  const stt = useRef<{ stop: () => string } | null>(null);
  const speakStart = useRef(0);
  const canStt = sttSupported();

  const selectLeft = useCountdown(spec.selectSec ?? 0, phase === "select", () => setPhase("prep"));
  const prepLeft = useCountdown(spec.prepSec, phase === "prep", () => void beginSpeaking());
  const speakLeft = useCountdown(spec.speakSec, phase === "speak", () => void endSpeaking());

  useEffect(() => () => { void rec.current?.stop(); stt.current?.stop(); }, []);

  // Default the Task 5 choice so the timer never leaves it empty.
  useEffect(() => {
    if (phase === "prep" && prompt.options && !chosen) setChosen(prompt.options[0].title);
  }, [phase, prompt.options, chosen]);

  async function beginSpeaking() {
    setPhase("speak");
    speakStart.current = Date.now();
    try {
      rec.current = await startRecorder();
    } catch {
      setMicError("Không truy cập được micro. Hãy cho phép micro trong trình duyệt — bạn vẫn có thể gõ lại câu trả lời.");
    }
    if (canStt) {
      try {
        stt.current = startRecognition((f, i) => { setFinalText(f); setInterim(i); }, (err) => setMicError(`Nhận dạng giọng nói: ${err}`));
      } catch { /* fall back to typing */ }
    }
  }

  async function endSpeaking() {
    const dur = Math.round((Date.now() - speakStart.current) / 1000);
    setSpeakSec(dur);
    const text = stt.current?.stop() ?? finalText;
    stt.current = null;
    setFinalText((t) => (text || t).trim());
    setInterim("");
    let file: string | null = null;
    let url: string | null = null;
    if (rec.current) {
      const blob = await rec.current.stop();
      rec.current = null;
      url = URL.createObjectURL(blob);
      file = await uploadAudio(blob);
      setAudioUrl(url);
      setAudioFile(file);
    }
    if (exam) {
      onComplete({ transcript: (text || finalText).trim(), durationSec: dur, transcriptSource: "speech-to-text", audioFile: file, audioUrl: url, chosenOption: chosen });
    } else {
      setPhase("review");
    }
  }

  const transcript = (finalText || typed).trim();

  return (
    <div className="speaking">
      <Card title={`Task ${spec.task}: ${spec.name}`} actions={
        phase === "select" ? <TimerPill seconds={selectLeft} warnAt={10} /> :
        phase === "prep" ? <span className="row gap-s"><span className="badge info">Chuẩn bị</span><TimerPill seconds={prepLeft} warnAt={10} /></span> :
        phase === "speak" ? <span className="row gap-s"><span className="badge bad rec">● Đang ghi âm</span><TimerPill seconds={speakLeft} warnAt={10} /></span> : null
      }>
        <p className="prompt-text">{prompt.prompt}</p>
        {prompt.svg && <SceneImage svg={prompt.svg} />}
        {prompt.options && (
          <div className="opt-cards">
            {prompt.options.map((o) => (
              <button key={o.title} className={`opt-card ${chosen === o.title ? "chosen" : ""}`} disabled={phase !== "select" && phase !== "ready"} onClick={() => setChosen(o.title)}>
                <strong>{o.title}</strong>
                <ul>{o.details.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </button>
            ))}
            {chosen && phase !== "select" && phase !== "ready" && (
              <p className="small">Bạn chọn: <strong>{chosen}</strong>. Thuyết phục người nhà vì sao lựa chọn này tốt hơn phương án còn lại.</p>
            )}
          </div>
        )}

        {phase === "ready" && (
          <div className="row gap-s wrap">
            <button className="btn primary" onClick={() => setPhase(spec.selectSec ? "select" : "prep")}>
              ▶ Bắt đầu ({spec.selectSec ? `${spec.selectSec}s chọn · ` : ""}{spec.prepSec}s chuẩn bị · {spec.speakSec}s nói)
            </button>
            {!canStt && <span className="muted small">Trình duyệt này không hỗ trợ chuyển giọng nói thành chữ — dùng Chrome/Edge, hoặc gõ lại câu trả lời sau khi ghi âm.</span>}
          </div>
        )}
        {phase === "select" && <button className="btn" onClick={() => setPhase("prep")} disabled={!chosen}>Đã chọn → chuẩn bị</button>}
        {phase === "prep" && !exam && <button className="btn" onClick={() => void beginSpeaking()}>Bỏ qua chuẩn bị, nói ngay</button>}
        {phase === "speak" && (
          <div className="live">
            <div className="live-text">{finalText} <span className="muted">{interim}</span>{!finalText && !interim && <span className="muted">Hãy bắt đầu nói…</span>}</div>
            {!exam && <button className="btn" onClick={() => void endSpeaking()}>⏹ Dừng sớm</button>}
          </div>
        )}
        {micError && <div className="error-box small">{micError}</div>}
      </Card>

      {phase === "review" && (
        <Card title="Bản ghi & chép lời">
          {audioUrl && <audio controls src={audioUrl} className="audio" />}
          {finalText ? (
            <>
              <p className="muted small">Bản chép lời tự động (speech-to-text). Nhận dạng có thể sai vài từ — AI được dặn không trừ điểm lỗi nhận dạng hiển nhiên. Không chỉnh sửa để phản hồi trung thực.</p>
              <p className="original">{finalText}</p>
            </>
          ) : (
            <>
              <p className="muted small">Không có bản chép lời tự động. Hãy nghe lại bản ghi âm và gõ lại chính xác những gì bạn đã nói (kể cả “uh”, lặp từ).</p>
              <textarea className="editor short" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Gõ lại câu trả lời của bạn…" />
            </>
          )}
          <button className="btn primary" disabled={transcript.split(/\s+/).length < 8} onClick={() => onComplete({
            transcript, durationSec: speakSec, transcriptSource: finalText ? "speech-to-text" : "typed", audioFile, audioUrl, chosenOption: chosen,
          })}>Gửi để nhận phản hồi</button>
        </Card>
      )}
    </div>
  );
}
