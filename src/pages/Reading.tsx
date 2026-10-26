import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { ReadingSet, Settings } from "../../shared/types";
import { CATEGORIES, READING_PARTS } from "../../shared/spec";
import { api, post } from "../api";
import { Card, ErrorBox, TimerPill, Unofficial, useCountdown, Badge } from "../components/ui";
import { DrillPicker, Generating, History } from "../components/Practice";
import { Passage } from "../components/Passage";
import { McqList } from "../components/Mcq";
import { WeaknessReport, type ObjectiveResult } from "../components/Results";
import { useTutorContext } from "../components/Tutor";
import type { Mode } from "../../shared/types";

export function ReadingPage() {
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [set, setSet] = useState<ReadingSet | null>(null);
  const [mode, setMode] = useState<Mode>("learn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  const generate = useCallback(async (taskType: string | undefined, m: Mode, focus?: string) => {
    setBusy(true); setError(null); setSet(null); setMode(m);
    try {
      setSet(await post<ReadingSet>("/api/generate/reading", { taskType, mode: m, focus }));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  // Deep links from the planner: ?task=R2, ?mode=drill&focus=inference, ?mode=weekly&task=R4
  const started = useRef("");
  useEffect(() => {
    const key = params.toString();
    if (!key || started.current === key) return;
    started.current = key;
    const m = (params.get("mode") as Mode) || "learn";
    void generate(params.get("task") ?? undefined, m, params.get("focus") ?? undefined);
  }, [params, generate]);

  if (busy) return <div className="page"><Generating what="bài Reading" /></div>;
  if (set) return <ReadingSession key={set.id} set={set} mode={mode} onNext={() => generate(set.taskType, mode, set.focus[0])} onExit={() => { setSet(null); setParams({}); started.current = ""; }} />;

  return (
    <div className="page">
      <h1>📖 Reading</h1>
      <p className="muted">Kỹ năng ưu tiên cao nhất (5 → 8). Mỗi bài được tạo theo lỗi bạn hay mắc và độ khó tự điều chỉnh.</p>
      <ErrorBox error={error} />
      <div className="part-grid">
        {READING_PARTS.map((p) => (
          <Card key={p.id} title={`Part ${p.part}: ${p.name}`}>
            <p className="small muted">{p.description}</p>
            <div className="row between">
              <span className="small">{p.questions} câu · {p.minutes} phút · độ khó <strong>{settings?.difficulty[p.id] ?? "–"}</strong></span>
              <button className="btn primary small" onClick={() => generate(p.id, "learn")}>Bắt đầu</button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Drill theo loại lỗi">
        <p className="small muted">Bài ngắn (~6 câu) trong đó ≥70% câu hỏi nhắm vào đúng loại lỗi bạn chọn.</p>
        <DrillPicker skill="reading" onStart={(f) => generate(undefined, "drill", f)} />
      </Card>
      <History skill="reading" />
    </div>
  );
}

function ReadingSession({ set, mode, onNext, onExit }: { set: ReadingSet; mode: Mode; onNext: () => void; onExit: () => void }) {
  const part = READING_PARTS.find((p) => p.id === set.taskType)!;
  const limit = (mode === "drill" ? Math.max(5, Math.round(part.minutes * 0.6)) : part.minutes) * 60;
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [result, setResult] = useState<ObjectiveResult | null>(null);
  const [full, setFull] = useState<ReadingSet>(set);
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [strict, setStrict] = useState(true);
  const startedAt = useRef(Date.now());
  const submitting = useRef(false);

  const submit = useCallback(async (timedOut = false) => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const r = await post<ObjectiveResult & { content: ReadingSet }>("/api/attempts/objective", {
        contentId: set.id, mode, answers, durationSec: (Date.now() - startedAt.current) / 1000, timedOut,
      });
      setFull(r.content);
      setResult(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); submitting.current = false; }
  }, [answers, mode, set.id]);

  const left = useCountdown(limit, !result, () => { if (strict) void submit(true); });

  useTutorContext({
    exercise: `Reading ${set.taskType}: ${set.title}`, skill: "reading", difficulty: set.difficulty,
    passage: set.sections.map((s) => s.text || JSON.stringify(s.table)).join("\n\n").slice(0, 6000),
    submitted: Boolean(result),
  }, [set.id, Boolean(result)]);

  const blankAnswers: Record<number, string> = {};
  for (const q of full.questions) {
    const a = answers[q.id];
    if (a !== undefined && a !== null) blankAnswers[q.number] = q.options[a].text;
  }
  const answered = Object.values(answers).filter((v) => v !== null && v !== undefined).length;

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>{part.name} — {set.title}</h2>
          <div className="row gap-s wrap">
            <Badge>{mode === "drill" ? `Drill: ${set.focus.map((f) => CATEGORIES.reading[f] ?? f).join(", ")}` : mode === "weekly" ? "Kiểm tra tuần" : "Luyện tập"}</Badge>
            <Badge>Độ khó {set.difficulty}</Badge>
            <span className="muted small">{answered}/{set.questions.length} đã trả lời</span>
          </div>
        </div>
        <div className="row gap-s">
          {!result && <TimerPill seconds={left} />}
          {!result && <label className="small row gap-s"><input type="checkbox" checked={strict} onChange={(e) => setStrict(e.target.checked)} />Tự nộp khi hết giờ</label>}
          <button className="btn ghost" onClick={onExit}>Thoát</button>
        </div>
      </div>
      <Unofficial compact />
      <ErrorBox error={error} />
      {result && <WeaknessReport result={result} skill="reading" />}

      <div className="split">
        <div className="split-left">
          {full.sections.map((s, i) => (
            <Passage key={i} section={s} evidence={result ? full.questions.map((q) => q.evidence) : []} activeEvidence={activeEvidence} answers={blankAnswers} sourceLabel={`reading:${set.taskType}`} />
          ))}
          {result && full.vocabulary.length > 0 && (
            <Card title="Từ vựng của bài">
              <ul className="vocab-mini">
                {full.vocabulary.map((v) => <li key={v.term}><strong>{v.term}</strong> — {v.vi}<div className="muted small">{v.definition} · <em>{v.example}</em></div></li>)}
              </ul>
            </Card>
          )}
        </div>
        <div className="split-right">
          <McqList
            questions={full.questions}
            answers={answers}
            onAnswer={(qid, idx) => setAnswers((a) => ({ ...a, [qid]: idx }))}
            reviewed={Boolean(result)}
            skill="reading"
            exerciseTitle={set.title}
            onEvidence={(q) => {
              setActiveEvidence(q);
              document.querySelector(".evidence.active")?.scrollIntoView({ behavior: "smooth", block: "center" });
              setTimeout(() => document.querySelector(".evidence.active")?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
            }}
          />
          {!result ? (
            <button className="btn primary big full" onClick={() => submit(false)}>Nộp bài</button>
          ) : (
            <div className="row gap-s">
              <button className="btn primary" onClick={onNext}>Bài tiếp theo (thích ứng)</button>
              <button className="btn" onClick={onExit}>Chọn dạng khác</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
