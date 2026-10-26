import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ListeningSet, Mode, Settings } from "../../shared/types";
import { CATEGORIES, LISTENING_PARTS } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, TimerPill, Unofficial, useCountdown } from "../components/ui";
import { DrillPicker, Generating, History } from "../components/Practice";
import { McqList } from "../components/Mcq";
import { SegmentPlayer, Transcript } from "../components/ListeningPlayer";
import { WeaknessReport, type ObjectiveResult } from "../components/Results";
import { useTutorContext } from "../components/Tutor";

export function ListeningPage() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [set, setSet] = useState<ListeningSet | null>(null);
  const [mode, setMode] = useState<Mode>("learn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [examLike, setExamLike] = useState(false);

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  const generate = useCallback(async (taskType: string | undefined, m: Mode, focus?: string) => {
    setBusy(true); setError(null); setSet(null); setMode(m);
    try { setSet(await post<ListeningSet>("/api/generate/listening", { taskType, mode: m, focus })); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const started = useRef("");
  useEffect(() => {
    const key = params.toString();
    if (!key || started.current === key) return;
    started.current = key;
    void generate(params.get("task") ?? undefined, (params.get("mode") as Mode) || "learn", params.get("focus") ?? undefined);
  }, [params, generate]);

  if (busy) return <div className="page"><Generating what="bài Listening" /></div>;
  if (set) return (
    <ListeningSession key={set.id} set={set} mode={mode} examLike={examLike || mode === "weekly"} preferredVoice={settings?.preferredVoice}
      onNext={() => generate(set.taskType, mode, set.focus[0])} onExit={() => { setSet(null); setParams({}); started.current = ""; }} />
  );

  return (
    <div className="page">
      <h1>🎧 Listening</h1>
      <p className="muted">Âm thanh được tổng hợp bằng giọng đọc của trình duyệt (ưu tiên giọng en-CA). Dùng <strong>Microsoft Edge</strong> để có giọng “Natural” tự nhiên nhất.</p>
      <ErrorBox error={error} />
      <Card>
        <label className="row gap-s"><input type="checkbox" checked={examLike} onChange={(e) => setExamLike(e.target.checked)} />
          <span><strong>Điều kiện thi thật:</strong> chỉ nghe một lần, không tạm dừng, không đổi tốc độ, không xem transcript trước khi nộp.</span>
        </label>
      </Card>
      <div className="part-grid">
        {LISTENING_PARTS.map((p) => (
          <Card key={p.id} title={`Part ${p.part}: ${p.name}`}>
            <p className="small muted">{p.description}</p>
            <div className="row between">
              <span className="small">{p.questions} câu · độ khó <strong>{settings?.difficulty[p.id] ?? "–"}</strong></span>
              <button className="btn primary small" onClick={() => generate(p.id, "learn")}>Bắt đầu</button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Drill theo loại lỗi">
        <DrillPicker skill="listening" onStart={(f) => generate(undefined, "drill", f)} />
      </Card>
      <History skill="listening" />
    </div>
  );
}

function ListeningSession({ set, mode, examLike, preferredVoice, onNext, onExit }: {
  set: ListeningSet; mode: Mode; examLike: boolean; preferredVoice?: string | null; onNext: () => void; onExit: () => void;
}) {
  const part = LISTENING_PARTS.find((p) => p.id === set.taskType)!;
  const [chunkIdx, setChunkIdx] = useState(0);
  const [heard, setHeard] = useState<boolean[]>(set.chunks.map(() => false));
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ObjectiveResult | null>(null);
  const [full, setFull] = useState(set);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const submitting = useRef(false);

  const chunk = set.chunks[chunkIdx];
  const allHeard = heard.every(Boolean);
  const answerSeconds = Math.max(60, chunk.questions.length * 40);

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const r = await post<ObjectiveResult & { content: ListeningSet }>("/api/attempts/objective", {
        contentId: set.id, mode, answers, durationSec: (Date.now() - startedAt.current) / 1000,
      });
      setFull(r.content); setResult(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); submitting.current = false; }
  }, [answers, mode, set.id]);

  const advance = () => {
    if (chunkIdx < set.chunks.length - 1) setChunkIdx(chunkIdx + 1);
    else void submit();
  };

  // Exam-like: each chunk's questions have their own answering timer, then move on automatically.
  const left = useCountdown(answerSeconds, examLike && heard[chunkIdx] && !result, () => advance());

  useTutorContext({
    exercise: `Listening ${set.taskType}: ${set.title}`, skill: "listening", difficulty: set.difficulty,
    transcript: result ? set.chunks.flatMap((c) => c.segments.map((s) => `${s.speaker}: ${s.text}`)).join("\n").slice(0, 6000) : "(hidden until submitted)",
    submitted: Boolean(result),
  }, [set.id, Boolean(result)]);

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>{part.name} — {set.title}</h2>
          <div className="row gap-s wrap">
            <Badge>{mode === "drill" ? `Drill: ${set.focus.map((f) => CATEGORIES.listening[f] ?? f).join(", ")}` : examLike ? "Điều kiện thi" : "Luyện tập"}</Badge>
            <Badge>Độ khó {set.difficulty}</Badge>
            {set.chunks.length > 1 && <span className="muted small">Phần {chunkIdx + 1}/{set.chunks.length}</span>}
          </div>
        </div>
        <div className="row gap-s">
          {examLike && heard[chunkIdx] && !result && <TimerPill seconds={left} warnAt={20} />}
          <button className="btn ghost" onClick={onExit}>Thoát</button>
        </div>
      </div>
      <Unofficial compact />
      <ErrorBox error={error} />
      {result && <WeaknessReport result={result} skill="listening" />}

      {!result ? (
        <div className="split">
          <div className="split-left">
            <Card title="Âm thanh">
              <p className="muted">{set.context}</p>
              <SegmentPlayer key={chunkIdx} segments={chunk.segments} exam={examLike} preferredVoice={preferredVoice}
                onFinished={() => setHeard((h) => h.map((v, i) => (i === chunkIdx ? true : v)))} />
            </Card>
            <Card title="Ghi chú khi nghe">
              <textarea className="notes-area" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ghi từ khóa, số liệu, ai nói gì…" rows={8} />
            </Card>
          </div>
          <div className="split-right">
            {!heard[chunkIdx] ? (
              <Card><p className="muted">Câu hỏi sẽ hiện sau khi nghe xong đoạn âm thanh (giống bài thi thật).</p></Card>
            ) : (
              <>
                <McqList questions={chunk.questions} answers={answers} onAnswer={(q, i) => setAnswers((a) => ({ ...a, [q]: i }))} reviewed={false} skill="listening" exerciseTitle={set.title} />
                <button className="btn primary big full" onClick={advance}>
                  {chunkIdx < set.chunks.length - 1 ? "Tiếp tục phần nghe tiếp theo →" : allHeard ? "Nộp bài" : "Nộp bài"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="split">
          <div className="split-left">
            <Card title="Transcript (nghe lại từng câu)">
              {full.chunks.map((c, i) => (
                <div key={i}>
                  {full.chunks.length > 1 && <h4>Phần {i + 1}</h4>}
                  <Transcript segments={c.segments} evidence={c.questions.map((q) => q.evidence)} preferredVoice={preferredVoice} />
                </div>
              ))}
            </Card>
            {notes && <Card title="Ghi chú của bạn"><pre className="pre">{notes}</pre></Card>}
            {full.vocabulary.length > 0 && (
              <Card title="Từ vựng của bài">
                <ul className="vocab-mini">{full.vocabulary.map((v) => <li key={v.term}><strong>{v.term}</strong> — {v.vi}<div className="muted small">{v.definition}</div></li>)}</ul>
              </Card>
            )}
          </div>
          <div className="split-right">
            <McqList questions={full.chunks.flatMap((c) => c.questions)} answers={answers} onAnswer={() => {}} reviewed skill="listening" exerciseTitle={set.title} />
            <div className="row gap-s">
              <button className="btn primary" onClick={onNext}>Bài tiếp theo (thích ứng)</button>
              <button className="btn" onClick={onExit}>Chọn dạng khác</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
