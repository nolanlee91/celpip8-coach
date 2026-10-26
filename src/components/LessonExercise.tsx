import { Icon } from "./Icon";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Exercise, Lesson, LessonAnswer, LessonResponse, Stimulus, Misconception } from "../../shared/curriculum";
import { Badge, Markdown, TimerPill, useCountdown } from "./ui";
import { SceneImage } from "./SpeakingRunner";
import { startRecognition, sttSupported } from "../lib/speech";
import { wordCount } from "../api";

export type PublicStimulus = Stimulus & {
  audioUrl?: string | null;
  segmentsTiming?: { start: number; end: number }[] | null;
  svg?: string | null;
  transcript?: { speaker: string; text: string }[];
};
export type PublicLesson = Omit<Lesson, "stimuli"> & { stimuli: Record<string, PublicStimulus>; audioReady: boolean };

export interface Feedback { correct: boolean; score: number; misconception: string | null; detail?: string }

/** Passage / audio clip / scene image. The transcript appears only after answering (unless "always"). */
export function StimulusView({ stim, revealed }: { stim: PublicStimulus | undefined; revealed: boolean }) {
  const [showT, setShowT] = useState(false);
  if (!stim) return null;
  const hasAudio = Boolean(stim.audio?.length || stim.audioRef);
  const transcriptVisible = stim.showTranscript === "always" || (revealed && showT);
  return (
    <div className="stimulus">
      {stim.title && <div className="passage-label">{stim.title}</div>}
      {stim.text && <div className="passage lesson-text"><Markdown text={stim.text} /></div>}
      {stim.svg && <SceneImage svg={stim.svg} />}
      {hasAudio && (
        stim.audioUrl
          ? <audio className="audio" controls preload="none" src={stim.audioUrl} />
          : <div className="banner subtle small"><Icon name="volume-x" /> Audio của đoạn này chưa được tạo. Tạo bằng <code>npm run audio:generate</code> hoặc ở trang Quản trị, mục Audio.</div>
      )}
      {hasAudio && stim.transcript && stim.showTranscript !== "always" && revealed && (
        <button className="btn ghost small" onClick={() => setShowT((x) => !x)}>{showT ? "Ẩn transcript" : "Xem transcript"}</button>
      )}
      {hasAudio && transcriptVisible && stim.transcript && (
        <div className="transcript small">
          {stim.transcript.map((t, i) => <p key={i}><strong>{t.speaker}:</strong> {t.text}</p>)}
        </div>
      )}
    </div>
  );
}

function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 2246822507) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  // Never show the items already in the correct order.
  if (out.every((x, i) => x === items[i]) && out.length > 1) [out[0], out[1]] = [out[1], out[0]];
  return out;
}

const LETTER = (i: number) => String.fromCharCode(65 + i);

/**
 * One lesson exercise. guided: hint + immediate feedback. independent: answers are saved but feedback
 * is held back until the mastery check is submitted (showFeedback). review: like independent.
 */
export function ExerciseCard({
  ex, index, stim, section, answer, showFeedback, misconceptions, onSubmit, onAskTutor, onFocus,
}: {
  ex: Exercise;
  index: number;
  stim?: PublicStimulus;
  section: "guided" | "independent" | "review";
  answer: (LessonAnswer & { detail?: string }) | null;
  showFeedback: boolean;
  misconceptions: Record<string, Misconception>;
  onSubmit: (r: LessonResponse) => Promise<Feedback | void>;
  onAskTutor?: (question: string) => void;
  onFocus?: () => void;
}) {
  const [hint, setHint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<string | undefined>(answer?.detail);
  const answered = Boolean(answer);
  const reveal = answered && showFeedback;

  const submit = async (r: LessonResponse) => {
    setBusy(true);
    try { const f = await onSubmit(r); if (f && f.detail) setDetail(f.detail); } finally { setBusy(false); }
  };

  const mis = answer?.misconception ? misconceptions[answer.misconception] : null;
  return (
    <div className={`card lesson-ex ${reveal ? (answer!.correct ? "ok" : "notok") : ""}`} onFocusCapture={onFocus} onClick={onFocus}>
      <div className="row between wrap">
        <strong>{section === "guided" ? "Luyện có hướng dẫn" : section === "review" ? "Ôn tập" : "Tự luyện"} · Bài {index + 1}</strong>
        <div className="row gap-s">
          {reveal && <Badge tone={answer!.correct ? "good" : answer!.score >= 0.5 ? "warn" : "bad"}>{answer!.correct ? "Đúng" : ex.type === "choice" || ex.type === "text" && ex.mode === "exact" ? "✗ Chưa đúng" : `${Math.round(answer!.score * 100)}%`}</Badge>}
          {answered && !showFeedback && <Badge tone="info">Đã lưu</Badge>}
        </div>
      </div>
      <StimulusView stim={stim} revealed={reveal} />
      <div className="mcq-prompt"><Markdown text={ex.prompt} /></div>

      {ex.type === "choice" && <ChoiceInput ex={ex} answer={answer} reveal={reveal} busy={busy} onSubmit={submit} />}
      {ex.type === "text" && <TextInput ex={ex} answer={answer} reveal={reveal} busy={busy} onSubmit={submit} />}
      {ex.type === "order" && <OrderInput ex={ex} answer={answer} reveal={reveal} busy={busy} onSubmit={submit} />}
      {ex.type === "produce" && <ProduceInput ex={ex} answer={answer} reveal={reveal} busy={busy} onSubmit={submit} />}

      {section === "guided" && !answered && ex.hint && (
        <div className="row gap-s wrap" style={{ marginTop: 8 }}>
          {!hint ? <button className="btn ghost small" onClick={() => setHint(true)}><Icon name="lightbulb" /> Gợi ý</button> : <div className="hint">{ex.hint}</div>}
          {onAskTutor && <button className="btn ghost small" onClick={() => onAskTutor("Cho tôi một gợi ý nhỏ cho bài này, đừng nói đáp án.")}><Icon name="message-circle" /> Hỏi AI gợi ý</button>}
        </div>
      )}

      {reveal && (
        <div className="explain">
          {detail && <p className="muted small">{detail}</p>}
          <Markdown text={ex.explanationVi} />
          {mis && !answer!.correct && (
            <div className="misc">
              <strong>Lỗi tư duy: {mis.label}</strong>
              <p>{mis.explanationVi}</p>
              <p><strong>Cách sửa:</strong> {mis.fixVi}</p>
            </div>
          )}
          {onAskTutor && (
            <div className="row gap-s wrap">
              <button className="btn ghost small" onClick={() => onAskTutor(answer!.correct ? "Giải thích thêm vì sao đáp án này đúng và các đáp án khác sai." : "Vì sao câu trả lời của tôi sai? Giải thích theo kỹ thuật của bài học rồi hỏi tôi một câu để kiểm tra.")}><Icon name="message-circle" /> Hỏi AI tutor</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type InputProps<T extends Exercise> = { ex: T; answer: LessonAnswer | null; reveal: boolean; busy: boolean; onSubmit: (r: LessonResponse) => void };

function ChoiceInput({ ex, answer, reveal, busy, onSubmit }: InputProps<Extract<Exercise, { type: "choice" }>>) {
  const [chosen, setChosen] = useState<number | null>(typeof answer?.response === "number" ? answer.response : null);
  const locked = Boolean(answer) && reveal;
  return (
    <>
      <div className="options">
        {ex.options.map((o, i) => {
          const cls = reveal ? (i === ex.answerIndex ? "answer" : i === chosen ? "wrong" : "") : i === chosen ? "chosen" : "";
          return (
            <label key={i} className={`option ${cls}`}>
              <input type="radio" name={ex.id} checked={chosen === i} disabled={locked} onChange={() => setChosen(i)} />
              <span><strong>{LETTER(i)}.</strong> {o.text}{reveal && (i === chosen || i === ex.answerIndex) && <span className="why">{o.whyVi}</span>}</span>
            </label>
          );
        })}
      </div>
      {!locked && <button className="btn primary small" disabled={chosen === null || busy} onClick={() => chosen !== null && onSubmit(chosen)}>{answer ? "Cập nhật câu trả lời" : "Trả lời"}</button>}
      {reveal && ex.evidence && <p className="small muted">Bằng chứng: “{ex.evidence}”</p>}
    </>
  );
}

function TextInput({ ex, answer, reveal, busy, onSubmit }: InputProps<Extract<Exercise, { type: "text" }>>) {
  const [text, setText] = useState(typeof answer?.response === "string" ? answer.response : "");
  const locked = Boolean(answer) && reveal;
  return (
    <>
      {ex.mode === "dictation"
        ? <textarea className="editor short" value={text} disabled={locked} onChange={(e) => setText(e.target.value)} placeholder="Gõ lại chính xác những gì bạn nghe…" />
        : <input className="text-answer" value={text} disabled={locked} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) onSubmit(text); }} placeholder="Câu trả lời…" />}
      {!locked && <div><button className="btn primary small" disabled={!text.trim() || busy} onClick={() => onSubmit(text)}>{answer ? "Cập nhật" : "Trả lời"}</button></div>}
      {reveal && <p className="small">Đáp án{ex.answers.length > 1 ? " (chấp nhận)" : ""}: <strong>{ex.answers.join(" / ")}</strong></p>}
    </>
  );
}

function OrderInput({ ex, answer, reveal, busy, onSubmit }: InputProps<Extract<Exercise, { type: "order" }>>) {
  const initial = useMemo(() => (Array.isArray(answer?.response) ? answer!.response as string[] : seededShuffle(ex.items, ex.id)), [ex, answer]);
  const [list, setList] = useState<string[]>(initial);
  const locked = Boolean(answer) && reveal;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    setList(next);
  };
  return (
    <>
      <ol className="order-list">
        {list.map((it, i) => (
          <li key={it} className={reveal ? (ex.items[i] === it ? "ok" : "notok") : ""}>
            <span className="grow">{it}</span>
            {!locked && (
              <span className="row gap-s">
                <button className="icon-btn" aria-label="Lên" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                <button className="icon-btn" aria-label="Xuống" disabled={i === list.length - 1} onClick={() => move(i, 1)}>▼</button>
              </span>
            )}
          </li>
        ))}
      </ol>
      {!locked && <button className="btn primary small" disabled={busy} onClick={() => onSubmit(list)}>{answer ? "Cập nhật thứ tự" : "Xác nhận thứ tự"}</button>}
      {reveal && !answer!.correct && <div className="small"><strong>Thứ tự đúng:</strong><ol>{ex.items.map((it) => <li key={it}>{it}</li>)}</ol></div>}
    </>
  );
}

function ProduceInput({ ex, answer, reveal, busy, onSubmit }: InputProps<Extract<Exercise, { type: "produce" }>>) {
  const prev = answer?.response && typeof answer.response === "object" && !Array.isArray(answer.response) ? answer.response : null;
  const [text, setText] = useState(prev?.text ?? "");
  const [checked, setChecked] = useState<number[]>(prev?.checked ?? []);
  const [phase, setPhase] = useState<"write" | "prep" | "speak" | "check">(prev ? "check" : ex.medium === "speak" ? "prep" : "write");
  const [running, setRunning] = useState(false);
  const [interim, setInterim] = useState("");
  const stt = useRef<{ stop: () => string } | null>(null);
  const locked = Boolean(answer) && reveal;
  const prepLeft = useCountdown(ex.prepSec ?? 30, running && phase === "prep", () => startSpeaking());
  const speakLeft = useCountdown(ex.responseSec ?? 60, running && phase === "speak", () => stopSpeaking());

  useEffect(() => () => { stt.current?.stop(); }, []);

  function startSpeaking() {
    setPhase("speak");
    setRunning(true);
    if (sttSupported()) {
      stt.current = startRecognition((final, inter) => { setText(final); setInterim(inter); }, () => {});
    }
  }
  function stopSpeaking() {
    const t = stt.current?.stop();
    stt.current = null;
    if (t) setText(t);
    setInterim("");
    setRunning(false);
    setPhase("check");
  }

  return (
    <div className="produce">
      {ex.medium === "speak" && phase !== "check" && !locked && (
        <div className="row gap wrap">
          {phase === "prep" && !running && <button className="btn primary small" onClick={() => setRunning(true)}>▶ Bắt đầu chuẩn bị ({ex.prepSec ?? 30}s)</button>}
          {phase === "prep" && running && <><TimerPill seconds={prepLeft} warnAt={5} /><button className="btn small" onClick={startSpeaking}>Nói ngay</button></>}
          {phase === "speak" && <><TimerPill seconds={speakLeft} warnAt={10} /><span className="badge bad">● Đang nói</span><button className="btn small" onClick={stopSpeaking}>Dừng</button></>}
          <button className="btn ghost small" onClick={() => { setRunning(false); setPhase("check"); }}>Gõ câu trả lời thay vì nói</button>
        </div>
      )}
      {(phase === "write" || phase === "check" || phase === "speak") && (
        <>
          <textarea className="editor short" value={phase === "speak" ? `${text} ${interim}` : text} disabled={locked || phase === "speak"} onChange={(e) => setText(e.target.value)}
            placeholder={ex.medium === "speak" ? "Transcript câu trả lời (nhận dạng giọng nói hoặc tự gõ lại)…" : "Viết câu trả lời…"} />
          <div className="small muted">{wordCount(text)} từ{ex.minWords ? ` · tối thiểu ${ex.minWords}` : ""}{ex.medium === "speak" && !sttSupported() ? " · trình duyệt không hỗ trợ nhận dạng giọng nói (dùng Edge/Chrome) — hãy nói thành tiếng rồi gõ lại ý chính" : ""}</div>
        </>
      )}
      {phase !== "prep" && phase !== "speak" && (
        <div className="self-check">
          <strong>Tự đánh giá theo tiêu chí</strong> <span className="muted small">(trung thực — mỗi tiêu chí bạn chắc chắn đã làm được)</span>
          {ex.checklist.map((c, i) => (
            <label key={i} className="row gap-s">
              <input type="checkbox" disabled={locked} checked={checked.includes(i)} onChange={(e) => setChecked(e.target.checked ? [...checked, i] : checked.filter((x) => x !== i))} />
              <span>{c}</span>
            </label>
          ))}
          {!locked && <button className="btn primary small" disabled={busy || wordCount(text) < 5} onClick={() => onSubmit({ text, checked })}>{answer ? "Cập nhật" : "Nộp & tự chấm"}</button>}
        </div>
      )}
      {reveal && (
        <details open className="model">
          <summary><strong>Bài mẫu Level 8+</strong></summary>
          <p className="pre">{ex.modelAnswer}</p>
        </details>
      )}
    </div>
  );
}
