import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ListeningSet, MockExam, ReadingSet, Settings, SpeakingPrompt, WritingPrompt } from "../../shared/types";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SKILL_LABEL, SPEAKING_TASKS, WRITING_TASKS, taskName, type Skill } from "../../shared/spec";
import { api, post, wordCount } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, ProgressBar, TimerPill, Unofficial, useCountdown } from "../components/ui";
import { Passage } from "../components/Passage";
import { McqList } from "../components/Mcq";
import { SegmentPlayer } from "../components/ListeningPlayer";
import { SpeakingRunner } from "../components/SpeakingRunner";
import { sttSupported } from "../lib/speech";

type Step = { section: Skill; id: string; index: number };

const stepKey = (id: string) => `celpip8-mock-step-${id}`;
const readStep = (id: string) => { try { return Number(localStorage.getItem(stepKey(id)) ?? 0); } catch { return 0; } };
const writeStep = (id: string, n: number) => { try { localStorage.setItem(stepKey(id), String(n)); } catch { /* ignore */ } };

export function MockPage() {
  const [list, setList] = useState<MockExam[] | null>(null);
  const [active, setActive] = useState<MockExam | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api<MockExam[]>("/api/mock").then(setList).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);

  // Poll while something is being prepared or graded.
  useEffect(() => {
    const busy = list?.some((m) => m.status === "preparing" || m.status === "grading");
    if (!busy) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [list, load]);

  if (active) return <ExamRunner mock={active} onExit={() => { setActive(null); void load(); }} />;

  return (
    <div className="page">
      <h1>📝 Thi thử (Mock Exam)</h1>
      <Unofficial />
      <Card title="Cấu trúc bài thi thử">
        <div className="grid-4">
          <div><strong>Listening</strong><p className="small muted">6 part · 38 câu · nghe 1 lần</p></div>
          <div><strong>Reading</strong><p className="small muted">4 part · 38 câu · ~55 phút</p></div>
          <div><strong>Writing</strong><p className="small muted">2 task · 27 + 26 phút</p></div>
          <div><strong>Speaking</strong><p className="small muted">8 task · ~20 phút</p></div>
        </div>
        <p className="small muted">Không có phản hồi trong khi thi. Không quay lại part trước. Writing & Speaking được AI chấm sau khi kết thúc. Ước tính Listening/Reading dùng quy tắc kinh nghiệm trên đề độ khó 8 — <strong>không phải bảng quy đổi điểm chính thức</strong>. Đặc tả thời gian theo cấu trúc CELPIP-General công bố; hãy đối chiếu celpip.ca trước ngày thi.</p>
        {!sttSupported() && <div className="error-box small">Trình duyệt này không hỗ trợ chuyển giọng nói thành chữ — phần Speaking của bài thi thử cần Chrome hoặc Edge.</div>}
        <button className="btn primary" onClick={async () => { try { await post("/api/mock"); void load(); } catch (e) { setError((e as Error).message); } }}>
          + Chuẩn bị đề thi thử mới (~2–4 phút, 20 phần)
        </button>
      </Card>
      <ErrorBox error={error} />
      {!list ? <Loading /> : list.length === 0 ? <Empty>Chưa có bài thi thử nào.</Empty> : list.map((m) => (
        <Card key={m.id} title={`Bài thi thử ${m.createdAt.slice(0, 10)}`} actions={<Badge tone={m.status === "done" ? "good" : m.status === "failed" ? "bad" : "info"}>{m.status}</Badge>}>
          {m.status === "preparing" && <><p className="small">Đang tạo đề: {m.progress.done}/{m.progress.total}</p><ProgressBar value={m.progress.done} max={m.progress.total} /></>}
          {m.status === "failed" && <ErrorBox error={m.progress.error} />}
          {(m.status === "ready" || m.status === "in_progress") && (
            <button className="btn primary" onClick={async () => { if (m.status === "ready") await post(`/api/mock/${m.id}/start`); setActive({ ...m, status: "in_progress" }); }}>
              {m.status === "ready" ? "▶ Bắt đầu thi" : `▶ Tiếp tục (phần ${readStep(m.id) + 1}/20)`}
            </button>
          )}
          {m.status === "grading" && <Loading text="AI đang chấm Writing & Speaking…" />}
          {m.status === "done" && <MockReport id={m.id} />}
        </Card>
      ))}
    </div>
  );
}

function MockReport({ id }: { id: string }) {
  const [data, setData] = useState<{ mock: MockExam; attempts: { id: string; skill: Skill; taskType: string; correct: number; total: number; estimatedBand: [number, number] | null; evaluationId: string | null; title: string; categories: Record<string, { correct: number; total: number }> }[] } | null>(null);
  useEffect(() => { api<typeof data>(`/api/mock/${id}/report`).then(setData); }, [id]);
  if (!data) return <Loading />;
  const r = data.mock.results ?? {};
  const cat = new Map<string, { skill: Skill; correct: number; total: number }>();
  for (const a of data.attempts) for (const [k, v] of Object.entries(a.categories)) {
    const key = `${a.skill}:${k}`;
    const x = cat.get(key) ?? { skill: a.skill, correct: 0, total: 0 };
    x.correct += v.correct; x.total += v.total;
    cat.set(key, x);
  }
  const weak = [...cat.entries()].filter(([, v]) => v.total >= 2).sort((a, b) => a[1].correct / a[1].total - b[1].correct / b[1].total).slice(0, 4);
  return (
    <div>
      <div className="grid-4">
        {(["listening", "reading", "writing", "speaking"] as Skill[]).map((s) => (
          <div key={s} className="mock-score">
            <span>{SKILL_LABEL[s]}</span>
            <strong>{r[s]?.estimate ?? "–"}</strong>
            <small className="muted">{r[s]?.total ? `${r[s]!.correct}/${r[s]!.total} câu` : "AI ước tính"}</small>
          </div>
        ))}
      </div>
      <p className="muted tiny">Ước tính không chính thức. Không tương đương điểm CELPIP chính thức.</p>
      {weak.length > 0 && (
        <>
          <h4>Điểm yếu lộ ra trong bài thi</h4>
          <ul>{weak.map(([k, v]) => <li key={k}>{SKILL_LABEL[v.skill]} — {CATEGORIES[v.skill][k.split(":")[1]] ?? k}: {v.correct}/{v.total}</li>)}</ul>
        </>
      )}
      <h4>Xem lại từng phần</h4>
      <table className="table">
        <tbody>
          {data.attempts.map((a) => (
            <tr key={a.id}>
              <td>{SKILL_LABEL[a.skill]}</td><td>{taskName(a.taskType)}</td>
              <td>{a.total ? `${a.correct}/${a.total}` : a.estimatedBand ? `~${a.estimatedBand[0]}–${a.estimatedBand[1]}` : "–"}</td>
              <td>{a.evaluationId ? <Link to={`/evaluation/${a.evaluationId}`}>Phản hồi chi tiết</Link> : <Link to={`/review/${a.id}`}>Đáp án & giải thích</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExamRunner({ mock, onExit }: { mock: MockExam; onExit: () => void }) {
  const steps: Step[] = [
    ...mock.listening.map((id, index) => ({ section: "listening" as Skill, id, index })),
    ...mock.reading.map((id, index) => ({ section: "reading" as Skill, id, index })),
    ...mock.writing.map((id, index) => ({ section: "writing" as Skill, id, index })),
    ...mock.speaking.map((id, index) => ({ section: "speaking" as Skill, id, index })),
  ];
  const [n, setN] = useState(() => readStep(mock.id));
  const [intro, setIntro] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = async () => {
    const k = n + 1;
    writeStep(mock.id, k);
    if (k >= steps.length) {
      setFinishing(true);
      try { await post(`/api/mock/${mock.id}/finish`); onExit(); } catch (e) { setError((e as Error).message); }
      return;
    }
    if (steps[k].section !== steps[n].section) setIntro(true);
    setN(k);
  };

  if (finishing) return <div className="page"><Loading text="Đang nộp bài thi…" /><ErrorBox error={error} /></div>;
  const step = steps[n];
  if (!step) return <div className="page"><button className="btn" onClick={next}>Nộp bài thi</button></div>;

  const header = (
    <div className="exam-head">
      <strong>CELPIP-General · Thi thử (không chính thức)</strong>
      <span>{SKILL_LABEL[step.section]} — phần {n + 1}/{steps.length}</span>
      <button className="btn small ghost" onClick={() => { if (confirm("Tạm dừng bài thi? Tiến độ được lưu, bạn có thể tiếp tục sau.")) onExit(); }}>Tạm dừng</button>
    </div>
  );

  if (intro) {
    const info: Record<Skill, string> = {
      listening: "Listening: 6 part. Âm thanh chỉ phát MỘT lần, không tạm dừng. Câu hỏi hiện sau khi nghe. Mỗi nhóm câu có thời gian trả lời riêng.",
      reading: "Reading: 4 part, mỗi part có thời gian riêng. Hết giờ sẽ tự chuyển. Không quay lại part trước.",
      writing: "Writing: Task 1 (27 phút) và Task 2 (26 phút), 150–200 từ. Kiểm tra chính tả bị tắt.",
      speaking: "Speaking: 8 task. Thời gian chuẩn bị và nói tự động chạy. Hãy cho phép micro. Nói rõ ràng để bản chép lời chính xác.",
    };
    return (
      <div className="page exam">
        {header}
        <Card title={`Phần ${SKILL_LABEL[step.section]}`}>
          <p>{info[step.section]}</p>
          <button className="btn primary" onClick={() => setIntro(false)}>Bắt đầu phần {SKILL_LABEL[step.section]}</button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page exam">
      {header}
      <ErrorBox error={error} />
      {step.section === "listening" && <ExamListening key={step.id} mockId={mock.id} contentId={step.id} onDone={next} />}
      {step.section === "reading" && <ExamReading key={step.id} mockId={mock.id} contentId={step.id} onDone={next} />}
      {step.section === "writing" && <ExamWriting key={step.id} mockId={mock.id} contentId={step.id} onDone={next} />}
      {step.section === "speaking" && <ExamSpeaking key={step.id} mockId={mock.id} contentId={step.id} onDone={next} />}
    </div>
  );
}

function useExamContent<T>(id: string) {
  const [c, setC] = useState<T | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<T>(`/api/content/${id}?mode=exam`).then(setC).catch((e) => setErr(e.message)); }, [id]);
  return [c, err] as const;
}

function ExamListening({ mockId, contentId, onDone }: { mockId: string; contentId: string; onDone: () => void }) {
  const [set, err] = useExamContent<ListeningSet>(contentId);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [chunk, setChunk] = useState(0);
  const [heard, setHeard] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const started = useRef(Date.now());
  const sent = useRef(false);
  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  const finishChunk = async () => {
    if (!set) return;
    if (chunk < set.chunks.length - 1) { setChunk(chunk + 1); setHeard(false); return; }
    if (sent.current) return;
    sent.current = true;
    await post(`/api/mock/${mockId}/objective`, { contentId, answers, durationSec: (Date.now() - started.current) / 1000 });
    onDone();
  };
  const qCount = set?.chunks[chunk].questions.length ?? 1;
  const left = useCountdown(Math.max(45, qCount * 35), heard, () => void finishChunk());

  if (err) return <ErrorBox error={err} />;
  if (!set) return <Loading />;
  const part = LISTENING_PARTS.find((p) => p.id === set.taskType)!;
  return (
    <div className="split">
      <div className="split-left">
        <Card title={`Listening Part ${part.part}: ${part.name}`}>
          <p className="muted">{set.context}</p>
          <SegmentPlayer key={chunk} segments={set.chunks[chunk].segments} exam preferredVoice={settings?.preferredVoice} onFinished={() => setHeard(true)} />
        </Card>
        <Card title="Giấy nháp"><textarea className="notes-area" rows={8} placeholder="Ghi chú…" /></Card>
      </div>
      <div className="split-right">
        {!heard ? <Card><p className="muted">Câu hỏi sẽ hiện sau khi âm thanh kết thúc.</p></Card> : (
          <>
            <div className="row between"><span className="muted small">Trả lời trước khi hết giờ</span><TimerPill seconds={left} warnAt={15} /></div>
            <McqList questions={set.chunks[chunk].questions} answers={answers} onAnswer={(q, i) => setAnswers((a) => ({ ...a, [q]: i }))} reviewed={false} skill="listening" exerciseTitle={set.title} />
            <button className="btn primary full" onClick={() => void finishChunk()}>Tiếp →</button>
          </>
        )}
      </div>
    </div>
  );
}

function ExamReading({ mockId, contentId, onDone }: { mockId: string; contentId: string; onDone: () => void }) {
  const [set, err] = useExamContent<ReadingSet>(contentId);
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const started = useRef(Date.now());
  const sent = useRef(false);
  const part = set ? READING_PARTS.find((p) => p.id === set.taskType)! : null;
  const submit = async (timedOut: boolean) => {
    if (sent.current) return;
    sent.current = true;
    await post(`/api/mock/${mockId}/objective`, { contentId, answers, timedOut, durationSec: (Date.now() - started.current) / 1000 });
    onDone();
  };
  const left = useCountdown((part?.minutes ?? 10) * 60, Boolean(set), () => void submit(true));
  if (err) return <ErrorBox error={err} />;
  if (!set || !part) return <Loading />;
  const blanks: Record<number, string> = {};
  for (const q of set.questions) { const a = answers[q.id]; if (a != null) blanks[q.number] = q.options[a].text; }
  return (
    <>
      <div className="row between"><h3>Reading Part {part.part}: {part.name}</h3><TimerPill seconds={left} /></div>
      <div className="split">
        <div className="split-left">{set.sections.map((s, i) => <Passage key={i} section={s} answers={blanks} sourceLabel={`mock:${set.taskType}`} />)}</div>
        <div className="split-right">
          <McqList questions={set.questions} answers={answers} onAnswer={(q, i) => setAnswers((a) => ({ ...a, [q]: i }))} reviewed={false} skill="reading" exerciseTitle={set.title} />
          <button className="btn primary full" onClick={() => { if (confirm("Chuyển sang part tiếp theo? Bạn sẽ không quay lại được.")) void submit(false); }}>Tiếp →</button>
        </div>
      </div>
    </>
  );
}

function ExamWriting({ mockId, contentId, onDone }: { mockId: string; contentId: string; onDone: () => void }) {
  const [p, err] = useExamContent<WritingPrompt>(contentId);
  const [text, setText] = useState("");
  const [choice, setChoice] = useState<"A" | "B" | null>(null);
  const started = useRef(Date.now());
  const sent = useRef(false);
  const spec = p ? WRITING_TASKS.find((t) => t.id === p.taskType)! : null;
  const submit = async () => {
    if (sent.current) return;
    sent.current = true;
    await post(`/api/mock/${mockId}/submission`, {
      skill: "writing", contentId, response: p?.optionA && choice ? `[Chosen option: ${choice}]\n${text}` : text,
      durationSec: (Date.now() - started.current) / 1000, transcriptSource: null, audioFile: null, chosenOption: choice,
    });
    onDone();
  };
  const left = useCountdown((spec?.minutes ?? 27) * 60, Boolean(p), () => void submit());
  if (err) return <ErrorBox error={err} />;
  if (!p || !spec) return <Loading />;
  const wc = wordCount(text);
  return (
    <div className="split">
      <div className="split-left">
        <Card title={`Writing Task ${spec.task}: ${spec.name}`} actions={<TimerPill seconds={left} warnAt={180} />}>
          <p>{p.situation}</p>
          {p.optionA && (["A", "B"] as const).map((k) => (
            <label key={k} className={`option ${choice === k ? "chosen" : ""}`}>
              <input type="radio" checked={choice === k} onChange={() => setChoice(k)} /><span className="opt-letter">{k}</span><span>{k === "A" ? p.optionA : p.optionB}</span>
            </label>
          ))}
          <ul>{p.instructions.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Card>
      </div>
      <div className="split-right">
        <textarea className="editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="row between"><span className={`wc ${wc < spec.minWords ? "low" : wc > spec.maxWords ? "high" : "ok"}`}>{wc} từ</span></div>
        <button className="btn primary full" onClick={() => { if (confirm("Nộp task này và chuyển tiếp?")) void submit(); }}>Tiếp →</button>
      </div>
    </div>
  );
}

function ExamSpeaking({ mockId, contentId, onDone }: { mockId: string; contentId: string; onDone: () => void }) {
  const [p, err] = useExamContent<SpeakingPrompt>(contentId);
  if (err) return <ErrorBox error={err} />;
  if (!p) return <Loading />;
  const spec = SPEAKING_TASKS.find((t) => t.id === p.taskType)!;
  return (
    <>
      <p className="muted small">Speaking Task {spec.task}/8 — bắt đầu tự động.</p>
      <SpeakingRunner prompt={p} exam onComplete={async (o) => {
        await post(`/api/mock/${mockId}/submission`, {
          skill: "speaking", contentId, response: o.transcript, durationSec: o.durationSec,
          transcriptSource: o.transcriptSource, audioFile: o.audioFile, chosenOption: o.chosenOption,
        });
        onDone();
      }} />
    </>
  );
}
