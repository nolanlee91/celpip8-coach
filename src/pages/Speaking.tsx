import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Evaluation, Settings, SpeakingPrompt } from "../../shared/types";
import { SPEAKING_TASKS } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, Unofficial } from "../components/ui";
import { Generating, History } from "../components/Practice";
import { SpeakingRunner, type SpeakingOutput } from "../components/SpeakingRunner";
import { EvaluationView } from "../components/Results";
import { useTutorContext } from "../components/Tutor";

export function SpeakingPage() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [prompt, setPrompt] = useState<SpeakingPrompt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  const generate = useCallback(async (taskType: string) => {
    setBusy(true); setError(null); setPrompt(null);
    try { setPrompt(await post<SpeakingPrompt>("/api/generate/speaking", { taskType })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const started = useRef("");
  useEffect(() => {
    const t = params.get("task");
    if (!t || started.current === t) return;
    started.current = t;
    void generate(t);
  }, [params, generate]);

  if (busy) return <div className="page"><Generating what="đề Speaking" /></div>;
  if (prompt) return (
    <SpeakingSession key={prompt.id} prompt={prompt}
      onNext={() => { const i = SPEAKING_TASKS.findIndex((t) => t.id === prompt.taskType); void generate(SPEAKING_TASKS[(i + 1) % SPEAKING_TASKS.length].id); }}
      onSame={() => generate(prompt.taskType)}
      onExit={() => { setPrompt(null); setParams({}); started.current = ""; }} />
  );

  return (
    <div className="page">
      <h1>🎙 Speaking</h1>
      <p className="muted">Ghi âm bằng micro, chuyển thành chữ ngay trong trình duyệt (Chrome/Edge), rồi AI nhận xét theo 4 tiêu chí CELPIP. <strong>Phát âm không được AI đánh giá</strong> vì AI chỉ đọc bản chép lời — hãy tự nghe lại bản ghi.</p>
      <ErrorBox error={error} />
      <div className="part-grid">
        {SPEAKING_TASKS.map((t) => (
          <Card key={t.id} title={`Task ${t.task}: ${t.name}`}>
            <p className="small muted">{t.selectSec ? `${t.selectSec}s chọn · ` : ""}{t.prepSec}s chuẩn bị · {t.speakSec}s nói · độ khó {settings?.difficulty[t.id] ?? "–"}</p>
            <button className="btn primary small" onClick={() => generate(t.id)}>Luyện</button>
          </Card>
        ))}
      </div>
      <History skill="speaking" />
    </div>
  );
}

function SpeakingSession({ prompt, onNext, onSame, onExit }: { prompt: SpeakingPrompt; onNext: () => void; onSame: () => void; onExit: () => void }) {
  const [round, setRound] = useState(0);
  const [grading, setGrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ evaluation: Evaluation; newDifficulty: number; audioUrl: string | null } | null>(null);
  const [lastOutput, setLastOutput] = useState<SpeakingOutput | null>(null);

  useTutorContext({
    exercise: `Speaking ${prompt.taskType}: ${prompt.title}`, skill: "speaking", prompt: prompt.prompt,
    options: prompt.options, transcript: result?.evaluation.response ?? null,
    evaluation: result ? { band: `${result.evaluation.bandLow}-${result.evaluation.bandHigh}`, weaknesses: result.evaluation.weaknesses } : null,
    note: "Feedback is transcript-based; pronunciation not assessed.",
  }, [prompt.id, Boolean(result)]);

  const evaluate = async (o: SpeakingOutput) => {
    setLastOutput(o); setGrading(true); setError(null);
    try {
      const r = await post<{ evaluation: Evaluation; newDifficulty: number }>("/api/evaluate/speaking", {
        contentId: prompt.id, transcript: o.transcript, durationSec: o.durationSec, transcriptSource: o.transcriptSource,
        audioFile: o.audioFile, chosenOption: o.chosenOption, mode: "learn",
      });
      setResult({ ...r, audioUrl: o.audioUrl });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setGrading(false); }
  };

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>{prompt.title}</h2>
          <div className="row gap-s"><Badge>Độ khó {prompt.difficulty}</Badge>{round > 0 && <Badge tone="info">Lần {round + 1}</Badge>}</div>
        </div>
        <button className="btn ghost" onClick={onExit}>Thoát</button>
      </div>
      <Unofficial compact />
      <ErrorBox error={error} onRetry={lastOutput ? () => evaluate(lastOutput) : undefined} />
      {grading && <Loading text="AI đang phân tích câu trả lời… (~30–60s)" />}
      {result ? (
        <>
          <EvaluationView ev={result.evaluation} audioUrl={result.audioUrl} newDifficulty={result.newDifficulty}
            onRepeat={() => { setResult(null); setRound((r) => r + 1); }} />
          <div className="row gap-s">
            <button className="btn primary" onClick={() => { setResult(null); setRound((r) => r + 1); }}>🔁 Nói lại cùng đề (áp dụng góp ý)</button>
            <button className="btn" onClick={onSame}>Đề mới cùng task</button>
            <button className="btn" onClick={onNext}>Task tiếp theo →</button>
          </div>
        </>
      ) : !grading && (
        <SpeakingRunner key={round} prompt={prompt} exam={false} onComplete={evaluate} />
      )}
    </div>
  );
}
