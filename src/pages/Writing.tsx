import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Attempt, Evaluation, WritingPrompt } from "../../shared/types";
import { WRITING_TASKS } from "../../shared/spec";
import { post, wordCount } from "../api";
import { Badge, Card, ErrorBox, TimerPill, Unofficial, useCountdown } from "../components/ui";
import { Generating, History } from "../components/Practice";
import { EvaluationView } from "../components/Results";
import { useTutorContext } from "../components/Tutor";

const draftKey = (id: string) => `celpip8-draft-${id}`;

function readDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
}

export function WritingPage() {
  const [params, setParams] = useSearchParams();
  const [prompt, setPrompt] = useState<WritingPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (taskType: string) => {
    setBusy(true); setError(null); setPrompt(null);
    try { setPrompt(await post<WritingPrompt>("/api/generate/writing", { taskType })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const started = useRef("");
  useEffect(() => {
    const t = params.get("task");
    if (!t || started.current === t) return;
    started.current = t;
    void generate(t);
  }, [params, generate]);

  if (busy) return <div className="page"><Generating what="đề Writing" /></div>;
  if (prompt) return <WritingSession key={prompt.id} prompt={prompt} onNext={() => generate(prompt.taskType)} onExit={() => { setPrompt(null); setParams({}); started.current = ""; }} />;

  return (
    <div className="page">
      <h1>✍️ Writing</h1>
      <p className="muted">Bạn đã đạt 7 — mục tiêu là <strong>ổn định ở Level 8</strong>: trả lời đủ mọi ý, giọng văn đúng, từ vựng chính xác hơn, 150–200 từ.</p>
      <ErrorBox error={error} />
      <div className="part-grid">
        {WRITING_TASKS.map((t) => (
          <Card key={t.id} title={`Task ${t.task}: ${t.name}`}>
            <p className="small muted">{t.minutes} phút · {t.minWords}–{t.maxWords} từ</p>
            <button className="btn primary small" onClick={() => generate(t.id)}>Đề mới</button>
          </Card>
        ))}
      </div>
      <History skill="writing" />
    </div>
  );
}

function WritingSession({ prompt, onNext, onExit }: { prompt: WritingPrompt; onNext: () => void; onExit: () => void }) {
  const spec = WRITING_TASKS.find((t) => t.id === prompt.taskType)!;
  const [text, setText] = useState(() => readDraft(prompt.id));
  const [choice, setChoice] = useState<"A" | "B" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [result, setResult] = useState<{ evaluation: Evaluation; attempt: Attempt; newDifficulty: number } | null>(null);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const startedAt = useRef(Date.now());

  // Autosave every change (debounced) to browser storage.
  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey(prompt.id), text); setSavedAt(new Date().toLocaleTimeString()); } catch { /* storage unavailable */ }
    }, 600);
    return () => clearTimeout(t);
  }, [text, prompt.id]);

  const left = useCountdown(spec.minutes * 60, !result && !grading, () => setTimeUp(true));
  const wc = wordCount(text);

  useTutorContext({
    exercise: `Writing ${prompt.taskType}: ${prompt.title}`, skill: "writing", situation: prompt.situation,
    instructions: prompt.instructions, draft: text.slice(0, 3000), evaluation: result?.evaluation ? { band: `${result.evaluation.bandLow}-${result.evaluation.bandHigh}`, weaknesses: result.evaluation.weaknesses } : null,
  }, [prompt.id, Boolean(result)]);

  const submit = async () => {
    setGrading(true); setError(null);
    try {
      const response = prompt.optionA && choice ? `[Chosen option: ${choice}]\n${text}` : text;
      const r = await post<{ evaluation: Evaluation; attempt: Attempt; newDifficulty: number }>("/api/evaluate/writing", {
        contentId: prompt.id, response, durationSec: (Date.now() - startedAt.current) / 1000, mode: "learn",
      });
      setResult(r);
      try { localStorage.removeItem(draftKey(prompt.id)); } catch { /* ignore */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setGrading(false); }
  };

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>Task {spec.task}: {spec.name}</h2>
          <div className="row gap-s"><Badge>Độ khó {prompt.difficulty}</Badge><span className="muted small">{prompt.title}</span></div>
        </div>
        <div className="row gap-s">
          {!result && <TimerPill seconds={left} warnAt={180} />}
          <button className="btn ghost" onClick={onExit}>Thoát</button>
        </div>
      </div>
      <Unofficial compact />
      <ErrorBox error={error} />

      {result ? (
        <>
          <EvaluationView ev={result.evaluation} newDifficulty={result.newDifficulty} onRepeat={onNext} />
          <div className="row gap-s"><button className="btn primary" onClick={onNext}>Đề mới cùng dạng</button><button className="btn" onClick={onExit}>Quay lại</button></div>
        </>
      ) : (
        <div className="split">
          <div className="split-left">
            <Card title="Đề bài">
              <p>{prompt.situation}</p>
              {prompt.optionA && (
                <div className="options">
                  {(["A", "B"] as const).map((k) => (
                    <label key={k} className={`option ${choice === k ? "chosen" : ""}`}>
                      <input type="radio" checked={choice === k} onChange={() => setChoice(k)} />
                      <span className="opt-letter">{k}</span><span>{k === "A" ? prompt.optionA : prompt.optionB}</span>
                    </label>
                  ))}
                </div>
              )}
              <ul>{prompt.instructions.map((x, i) => <li key={i}>{x}</li>)}</ul>
              <p className="muted small">Viết {spec.minWords}–{spec.maxWords} từ.</p>
            </Card>
          </div>
          <div className="split-right">
            {timeUp && <div className="error-box">Hết giờ! Trong bài thi thật bạn không thể viết thêm. Hãy nộp bài.</div>}
            <textarea
              className="editor"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder="Bắt đầu viết… (kiểm tra chính tả của trình duyệt đã tắt, giống bài thi)"
              disabled={grading}
            />
            <div className="row between">
              <span className={`wc ${wc < spec.minWords ? "low" : wc > spec.maxWords ? "high" : "ok"}`}>{wc} từ</span>
              <span className="muted tiny">{savedAt ? `Đã tự lưu lúc ${savedAt}` : ""}</span>
            </div>
            <button className="btn primary big full" disabled={grading || wc < 20 || (Boolean(prompt.optionA) && !choice)} onClick={submit}>
              {grading ? "AI đang chấm… (~30–60s)" : "Nộp & nhận phản hồi"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
