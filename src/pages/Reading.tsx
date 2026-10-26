import { Icon } from "../components/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReadingSet, Settings } from "../../shared/types";
import { CATEGORIES, READING_PARTS } from "../../shared/spec";
import { api, post } from "../api";
import { Card, ErrorBox, Loading, TimerPill, Unofficial, useCountdown, Badge } from "../components/ui";
import { DrillPicker, History } from "../components/Practice";
import { LibraryBrowser, PickReason, useLibraryPick } from "../components/Library";
import { Passage } from "../components/Passage";
import { McqList } from "../components/Mcq";
import { WeaknessReport, type ObjectiveResult } from "../components/Results";
import { useTutorContext } from "../components/Tutor";
import type { Mode } from "../../shared/types";

export function ReadingPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { picked, busy, error, next, open, exit } = useLibraryPick<ReadingSet>("reading");

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  if (busy) return <div className="page"><Loading text="Đang mở bài từ thư viện…" /></div>;
  if (picked) {
    const set = picked.item;
    return (
      <ReadingSession key={set.id + picked.mode} set={set} mode={picked.mode}
        banner={<PickReason reason={picked.reason} repeated={picked.repeated} />}
        onNext={() => next({ mode: picked.mode, taskType: picked.mode === "drill" ? undefined : set.taskType, focus: picked.mode === "drill" ? set.questions.map((q) => q.category).sort((a, b) => set.questions.filter((q) => q.category === b).length - set.questions.filter((q) => q.category === a).length)[0] : undefined })}
        onExit={exit} />
    );
  }

  return (
    <div className="page">
      <h1>Reading</h1>
      <p className="muted">Kỹ năng ưu tiên cao nhất (5 → 8). Bài được chọn ngay từ thư viện đã kiểm duyệt — theo part yếu nhất, độ khó hiện tại và lịch sử làm bài. Không cần AI.</p>
      <ErrorBox error={error} />
      <div className="row gap-s wrap">
        <button className="btn primary big" onClick={() => next({ mode: "learn" })}><Icon name="play" /> Bài đề xuất cho tôi</button>
      </div>
      <div className="part-grid">
        {READING_PARTS.map((p) => (
          <Card key={p.id} title={`Part ${p.part}: ${p.name}`}>
            <p className="small muted">{p.description}</p>
            <div className="row between">
              <span className="small">{p.questions} câu · ~{p.minutes} phút · độ khó <strong>{settings?.difficulty[p.id] ?? "–"}</strong></span>
              <button className="btn primary small" onClick={() => next({ mode: "learn", taskType: p.id })}>Bắt đầu</button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Drill theo loại lỗi">
        <p className="small muted">Bài ngắn (4–7 câu) tập trung vào đúng loại lỗi bạn chọn.</p>
        <DrillPicker skill="reading" onStart={(f) => next({ mode: "drill", focus: f })} />
      </Card>
      <LibraryBrowser skill="reading" tasks={READING_PARTS.map((p) => p.id)} onOpen={(id) => open(id)} />
      <History skill="reading" />
    </div>
  );
}

function ReadingSession({ set, mode, banner, onNext, onExit }: { set: ReadingSet; mode: Mode; banner: React.ReactNode; onNext: () => void; onExit: () => void }) {
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
      {!result && banner}
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
              <button className="btn primary" onClick={onNext}>Bài tiếp theo (từ thư viện)</button>
              <button className="btn" onClick={onExit}>Chọn dạng khác</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
