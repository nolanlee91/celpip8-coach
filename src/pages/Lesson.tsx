import { Icon } from "../components/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { LessonAnswer, LessonProgress, LessonResponse, LessonStep, LessonRun } from "../../shared/curriculum";
import { LESSON_STEPS } from "../../shared/curriculum";
import { SKILL_LABEL } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, Markdown, ProgressBar } from "../components/ui";
import { ExerciseCard, StimulusView, type Feedback, type PublicLesson } from "../components/LessonExercise";
import { useTutor, useTutorContext } from "../components/Tutor";

const STEP_LABEL: Record<LessonStep, string> = {
  objective: "1. Mục tiêu", concept: "2. Khái niệm", examples: "3. Ví dụ mẫu", guided: "4. Luyện có hướng dẫn", independent: "5. Tự luyện", result: "6. Kết quả",
};
const LEVEL_LABEL = { foundation: "Nền tảng", core: "Cốt lõi", target8: "Hướng Level 8" } as const;
const COMPARE_LABEL: Record<string, { text: string; tone: "bad" | "warn" | "good" | "info" }> = {
  weak: { text: "Yếu (~Level 5–6)", tone: "bad" }, acceptable: { text: "Tạm được (~Level 7)", tone: "warn" }, level8: { text: "Level 8+", tone: "good" },
  before: { text: "Trước khi sửa", tone: "bad" }, after: { text: "Sau khi sửa", tone: "good" },
};
export const STATUS_LABEL: Record<string, { text: string; tone: "neutral" | "info" | "warn" | "good" }> = {
  not_started: { text: "Chưa học", tone: "neutral" }, in_progress: { text: "Đang học", tone: "info" },
  needs_review: { text: "Cần ôn", tone: "warn" }, mastered: { text: "Đã nắm vững", tone: "good" },
};

interface LessonData {
  lesson: PublicLesson;
  progress: LessonProgress | null;
  status: string;
  missingPrerequisites: { id: string; title: string }[];
  categories: Record<string, string>;
}
interface ResultData {
  run: LessonRun;
  progress: LessonProgress;
  analysis: { key: string; count: number; label: string; explanationVi: string; fixVi: string; competency: string | null }[];
  nextReview: string | null;
  mistakesAdded: number;
}

/** Seconds of activity since the last report (sent with each save so lesson time is tracked). */
function useActiveTime() {
  const last = useRef(Date.now());
  return () => {
    const s = Math.min(900, (Date.now() - last.current) / 1000);
    last.current = Date.now();
    return Math.round(s);
  };
}

export function LessonPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<LessonData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResultData | null>(null);
  const [focusEx, setFocusEx] = useState<string | null>(null);
  const tick = useActiveTime();
  const tutor = useTutor();
  const nav = useNavigate();

  const load = useCallback(() => api<LessonData>(`/api/lessons/${id}`).then(setData).catch((e) => setError(e.message)), [id]);
  useEffect(() => { setData(null); setResult(null); void load(); }, [load]);

  useTutorContext(data ? { lessonId: id, exerciseId: focusEx, exercise: `Bài học: ${data.lesson.titleVi}`, step: data.progress?.step ?? "objective" } : null, [id, focusEx, data?.progress?.step]);

  // ?step=… deep links from the daily plan.
  const wantedStep = params.get("step") as LessonStep | null;
  useEffect(() => {
    if (!data || !wantedStep || !LESSON_STEPS.includes(wantedStep) || wantedStep === "result") return;
    if (data.progress?.step === wantedStep) return;
    void goStep(wantedStep);
    params.delete("step");
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, wantedStep]);

  if (error) return <ErrorBox error={error} onRetry={() => { setError(null); void load(); }} />;
  if (!data) return <Loading />;
  if (params.get("review")) return <ReviewSession data={data} onDone={() => { params.delete("review"); setParams(params); void load(); }} />;

  const { lesson, progress } = data;
  const step: LessonStep = progress?.step ?? "objective";
  const answers = progress?.answers ?? {};

  async function goStep(s: LessonStep) {
    const p = data!.progress ?? await post<LessonProgress>(`/api/lessons/${id}/start`);
    const next = s === "result" ? p : await post<LessonProgress>(`/api/lessons/${id}/step`, { step: s, timeSec: tick() });
    setData((d) => d && { ...d, progress: next, status: d.status === "not_started" ? "in_progress" : d.status });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function restart() {
    const p = await post<LessonProgress>(`/api/lessons/${id}/start`, { restart: true });
    setResult(null);
    setData((d) => d && { ...d, progress: p });
  }
  async function answer(exerciseId: string, response: LessonResponse): Promise<Feedback> {
    if (!data!.progress) await post(`/api/lessons/${id}/start`);
    const g = await post<Feedback & { section: string }>(`/api/lessons/${id}/answer`, { exerciseId, response, timeSec: tick() });
    setData((d) => {
      if (!d) return d;
      const p = d.progress ?? ({ answers: {} } as LessonProgress);
      const a: LessonAnswer & { detail?: string } = { section: g.section as LessonAnswer["section"], response, correct: g.correct, score: g.score, misconception: g.misconception, at: new Date().toISOString(), detail: g.detail };
      return { ...d, progress: { ...p, step: p.step === "objective" || p.step === "concept" || p.step === "examples" ? (g.section as LessonStep) : p.step, answers: { ...p.answers, [exerciseId]: a } } };
    });
    return g;
  }
  async function complete() {
    const unanswered = lesson.independent.filter((e) => !answers[e.id]).length;
    if (unanswered && !confirm(`Còn ${unanswered} bài chưa làm (sẽ tính 0 điểm). Vẫn nộp?`)) return;
    await post(`/api/lessons/${id}/step`, { step: "independent", timeSec: tick() });
    const r = await post<ResultData>(`/api/lessons/${id}/complete`);
    setResult(r);
    setData((d) => d && { ...d, progress: r.progress, status: r.progress.status });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const askTutor = (exerciseId: string | null) => (q: string) => tutor.ask(q, { lessonId: id, exerciseId, exercise: `Bài học: ${lesson.titleVi}` });

  const stepIndex = LESSON_STEPS.indexOf(step);
  const guidedDone = lesson.guided.filter((e) => answers[e.id]).length;
  const indDone = lesson.independent.filter((e) => answers[e.id]?.section === "independent").length;
  const lastRun = progress?.runs.at(-1) ?? null;

  return (
    <div className="page lesson-page">
      <div className="row between wrap">
        <div>
          <div className="muted small"><Link to="/learn" className="row gap-s" style={{ display: "inline-flex" }}><Icon name="chevron-left" size={16} />Lộ trình học</Link></div>
          <div className="muted small">{SKILL_LABEL[lesson.skill]}, {LEVEL_LABEL[lesson.level].toLowerCase()}, khoảng {lesson.estimatedMinutes} phút. Dùng cho {lesson.tasks.join(", ")}.</div>
          <h1>{lesson.titleVi}</h1>
          <div className="muted">{lesson.title}</div>
        </div>
        <Badge tone={STATUS_LABEL[data.status]?.tone ?? "neutral"}>{STATUS_LABEL[data.status]?.text ?? data.status}</Badge>
      </div>

      <nav className="steps">
        {LESSON_STEPS.map((s, i) => (
          <button key={s} className={`step ${s === step ? "active" : ""} ${i < stepIndex ? "done" : ""}`} disabled={s === "result" && !lastRun} onClick={() => void goStep(s)}>
            {STEP_LABEL[s]}
            {s === "guided" && <span className="muted tiny"> {guidedDone}/{lesson.guided.length}</span>}
            {s === "independent" && <span className="muted tiny"> {indDone}/{lesson.independent.length}</span>}
          </button>
        ))}
      </nav>

      {step === "objective" && (
        <Card title="Mục tiêu bài học">
          <p>{lesson.objectiveVi}</p>
          <ul>{lesson.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
          <div className="recommend"><strong>Vì sao quan trọng với Level 8.</strong> {lesson.whyItMattersVi}</div>
          <div className="row gap-s wrap" style={{ margin: "10px 0" }}>{lesson.competencies.map((c) => <Badge key={c} tone="info">{data.categories[c] ?? c}</Badge>)}</div>
          {data.missingPrerequisites.length > 0 && (
            <div className="banner subtle">Nên học trước: {data.missingPrerequisites.map((p, i) => <span key={p.id}>{i ? ", " : ""}<Link to={`/learn/${p.id}`}>{p.title}</Link></span>)}. Bạn vẫn có thể học bài này ngay.</div>
          )}
          {lesson.skill === "listening" && !lesson.audioReady && <div className="banner subtle">Một số đoạn audio của bài chưa được tạo — các bài tập đó sẽ hiện thông báo "đang chờ".</div>}
          <div className="row gap-s wrap" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => void goStep("concept")}>{progress ? "Tiếp tục" : "▶ Bắt đầu học"}</button>
            {lastRun && <button className="btn ghost" onClick={() => void restart()}><Icon name="rotate-ccw" /> Học lại từ đầu</button>}
          </div>
          <p className="muted tiny">Bài học dùng nội dung soạn sẵn, không cần AI. AI Tutor là tùy chọn.</p>
        </Card>
      )}

      {step === "concept" && (
        <>
          {lesson.concept.map((c) => (
            <Card key={c.heading} title={c.heading}><Markdown text={c.body} /></Card>
          ))}
          <LessonLanguage lesson={lesson} />
          <div className="row gap-s"><button className="btn primary" onClick={() => void goStep("examples")}>Xem ví dụ mẫu</button></div>
        </>
      )}

      {step === "examples" && (
        <>
          {lesson.examples.map((ex, i) => <WorkedExampleCard key={ex.id} ex={ex} index={i} lesson={lesson} />)}
          <div className="row gap-s"><button className="btn primary" onClick={() => void goStep("guided")}>Luyện có hướng dẫn</button></div>
        </>
      )}

      {step === "guided" && (
        <>
          <p className="muted">Có gợi ý và giải thích ngay sau mỗi câu. Sai cũng không sao — đây là lúc học.</p>
          {lesson.guided.map((ex, i) => (
            <ExerciseCard key={ex.id} ex={ex} index={i} stim={ex.stimulusId ? lesson.stimuli[ex.stimulusId] : undefined} section="guided" answer={answers[ex.id] ?? null}
              showFeedback misconceptions={lesson.misconceptions} onSubmit={(r) => answer(ex.id, r)} onAskTutor={askTutor(ex.id)} onFocus={() => setFocusEx(ex.id)} />
          ))}
          <div className="row gap-s"><button className="btn primary" onClick={() => void goStep("independent")}>Sang phần tự luyện</button></div>
        </>
      )}

      {step === "independent" && (
        <>
          <div className="banner subtle">Không có gợi ý. Đáp án và giải thích hiện sau khi bạn nộp. Đạt ≥ {Math.round(lesson.mastery.advance * 100)}% là nắm vững; {Math.round(lesson.mastery.review * 100)}–{Math.round(lesson.mastery.advance * 100) - 1}% cần ôn sớm; dưới {Math.round(lesson.mastery.review * 100)}% nên học lại.</div>
          {lesson.independent.map((ex, i) => (
            <ExerciseCard key={ex.id} ex={ex} index={i} stim={ex.stimulusId ? lesson.stimuli[ex.stimulusId] : undefined} section="independent"
              answer={answers[ex.id]?.section === "independent" ? answers[ex.id] : null} showFeedback={false} misconceptions={lesson.misconceptions}
              onSubmit={(r) => answer(ex.id, r).then(() => undefined)} onFocus={() => setFocusEx(ex.id)} />
          ))}
          <div className="row gap-s wrap">
            <ProgressBar value={indDone} max={lesson.independent.length} />
            <button className="btn primary" onClick={() => void complete()}><Icon name="check" /> Nộp bài kiểm tra ({indDone}/{lesson.independent.length})</button>
          </div>
        </>
      )}

      {step === "result" && lastRun && (
        <LessonResultView lesson={lesson} run={lastRun} progress={progress!} analysis={result?.analysis} mistakesAdded={result?.mistakesAdded}
          onRestart={() => void restart()} onAskTutor={askTutor(null)} onNext={(to) => nav(to)} />
      )}

      {/* Mobile: step navigation within thumb reach (the step pills are hidden on small screens). */}
      <div className="lesson-nav">
        <button className="btn" disabled={stepIndex === 0} onClick={() => void goStep(LESSON_STEPS[stepIndex - 1])} aria-label="Bước trước"><Icon name="chevron-left" /></button>
        <span className="where">Bước {stepIndex + 1}/6: {STEP_LABEL[step].replace(/^\d\. /, "")}</span>
        {step === "independent"
          ? <button className="btn primary" onClick={() => void complete()}>Nộp bài</button>
          : <button className="btn primary" disabled={stepIndex >= 4 || (step === "result")} onClick={() => void goStep(LESSON_STEPS[stepIndex + 1])} aria-label="Bước sau"><Icon name="chevron-right" /></button>}
      </div>
    </div>
  );
}

function WorkedExampleCard({ ex, index, lesson }: { ex: PublicLesson["examples"][number]; index: number; lesson: PublicLesson }) {
  const [shown, setShown] = useState(1);
  const all = shown >= ex.steps.length;
  return (
    <Card title={`Ví dụ ${index + 1}: ${ex.title}`}>
      <StimulusView stim={ex.stimulusId ? lesson.stimuli[ex.stimulusId] : undefined} revealed />
      {ex.question && <div className="mcq-prompt"><Markdown text={ex.question} /></div>}
      <ol className="steps-list">
        {ex.steps.slice(0, shown).map((s, i) => <li key={i}><Markdown text={s} /></li>)}
      </ol>
      {!all ? <button className="btn small" onClick={() => setShown((n) => n + 1)}>Bước tiếp theo ({shown}/{ex.steps.length})</button> : (
        <>
          {ex.answer && <div className="ok-msg"><strong>Đáp án:</strong> {ex.answer}</div>}
          {ex.comparisons?.map((c, i) => (
            <div key={i} className={`compare ${c.label}`}>
              <Badge tone={COMPARE_LABEL[c.label].tone}>{COMPARE_LABEL[c.label].text}</Badge>
              <p className="pre">{c.text}</p>
              <p className="small"><Markdown text={c.commentVi} /></p>
            </div>
          ))}
          <div className="recommend"><strong>Điều cần nhớ.</strong> {ex.takeawayVi}</div>
        </>
      )}
      {!all && <button className="btn ghost small" onClick={() => setShown(ex.steps.length)}>Hiện tất cả</button>}
    </Card>
  );
}

function LessonLanguage({ lesson }: { lesson: PublicLesson }) {
  const [msg, setMsg] = useState<string | null>(null);
  const add = async () => {
    const r = await post<{ added: number; total: number }>(`/api/lessons/${lesson.id}/vocab`);
    setMsg(r.added ? `Đã thêm ${r.added} cụm từ vào sổ từ vựng (ôn ngắt quãng).` : "Các cụm từ này đã có trong sổ từ vựng.");
  };
  return (
    <div className="grid-2">
      <Card title="Từ vựng và cụm từ của bài" actions={<button className="btn small" onClick={() => void add()}><Icon name="plus" /> Thêm vào ôn tập</button>}>
        {msg && <p className="ok-msg small">{msg}</p>}
        <ul className="vocab-mini">
          {lesson.vocabulary.map((v) => <li key={v.term}><strong>{v.term}</strong> — {v.vi}<div className="muted small">“{v.example}”</div></li>)}
        </ul>
      </Card>
      {lesson.grammar.length > 0 && (
        <Card title="Ngữ pháp và cấu trúc">
          {lesson.grammar.map((g) => (
            <div key={g.point} style={{ marginBottom: 10 }}>
              <strong>{g.point}</strong>
              <Markdown text={g.explanationVi} />
              <ul className="small">{g.examples.map((e) => <li key={e}>{e}</li>)}</ul>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function LessonResultView({ lesson, run, progress, analysis, mistakesAdded, onRestart, onAskTutor, onNext }: {
  lesson: PublicLesson; run: LessonRun; progress: LessonProgress; analysis?: ResultData["analysis"]; mistakesAdded?: number;
  onRestart: () => void; onAskTutor: (q: string) => void; onNext: (to: string) => void;
}) {
  const [next, setNext] = useState<{ title: string; reasonVi: string; route: string } | null>(null);
  useEffect(() => { void api<{ next: { title: string; reasonVi: string; route: string } | null }>("/api/coach").then((c) => setNext(c.next)).catch(() => {}); }, [run.at]);
  const items = analysis ?? Object.entries(run.misconceptions).sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count, ...(lesson.misconceptions[key] ?? { label: key, explanationVi: "", fixVi: "" }), competency: null }));
  const outcome = {
    advance: { tone: "good" as const, title: "Đã nắm vững", text: "Bạn có thể sang bài tiếp theo. Hệ thống sẽ nhắc ôn lại theo lịch lặp lại ngắt quãng." },
    review: { tone: "warn" as const, title: "Gần đạt — cần ôn sớm", text: "Bạn hiểu phần lớn kỹ thuật. Ôn lại các lỗi bên dưới; bài sẽ được nhắc ôn trong 1 ngày." },
    repeat: { tone: "bad" as const, title: "Nên học lại", text: "Hãy đọc lại phần khái niệm và ví dụ mẫu, rồi làm lại bài tập. Đây là bình thường với kỹ năng mới." },
  }[run.outcome];
  return (
    <>
      <Card title="Kết quả kiểm tra mức độ nắm vững">
        <div className="row gap wrap">
          <div className={`ring ${run.outcome === "advance" ? "good" : ""}`} style={{ ["--p" as string]: Math.round(run.score * 100) }}><span>{Math.round(run.score * 100)}%</span></div>
          <div className="grow">
            <h3><Badge tone={outcome.tone}>{outcome.title}</Badge></h3>
            <p>{outcome.text}</p>
            <p className="muted small">
              Luyện có hướng dẫn: {run.guidedScore === null ? "–" : `${Math.round(run.guidedScore * 100)}%`} · Thời gian: {Math.max(1, Math.round(run.timeSec / 60))} phút ·
              Ôn lại vào: <strong>{progress.srs?.due ?? "–"}</strong>{mistakesAdded ? ` · ${mistakesAdded} câu sai đã vào Sổ lỗi` : ""}
            </p>
            <p className="muted tiny">Điểm mastery đo mức nắm kỹ thuật của bài học — KHÔNG phải điểm CELPIP.</p>
          </div>
        </div>
      </Card>

      <Card title="Phân tích lỗi">
        {items.length === 0 ? <p className="ok-msg">Không mắc lỗi tư duy nào trong lần này.</p> : items.map((m) => (
          <div key={m.key} className="misc">
            <strong>{m.label}</strong> <Badge tone="warn">×{m.count}</Badge>
            <p>{m.explanationVi}</p>
            <p><strong>Cách sửa:</strong> {m.fixVi}</p>
          </div>
        ))}
        {items.length > 0 && <button className="btn ghost small" onClick={() => onAskTutor("Dựa trên các lỗi của tôi trong bài này, giải thích lỗ hổng kỹ năng chính và cho tôi 2 câu luyện ngắn (có đáp án ở cuối).")}><Icon name="message-circle" /> Hỏi AI tutor về lỗi của tôi</button>}
      </Card>

      <Card title="Xem lại bài tự luyện">
        {lesson.independent.map((ex, i) => (
          <ExerciseCard key={ex.id} ex={ex} index={i} stim={ex.stimulusId ? lesson.stimuli[ex.stimulusId] : undefined} section="independent"
            answer={progress.answers[ex.id]?.section === "independent" ? progress.answers[ex.id] : null} showFeedback misconceptions={lesson.misconceptions}
            onSubmit={async () => undefined} onAskTutor={(q) => onAskTutor(`${q} (bài ${i + 1}: ${ex.prompt.slice(0, 120)})`)} />
        ))}
      </Card>

      <LessonLanguage lesson={lesson} />

      <Card title="Tiếp theo">
        <div className="row gap-s wrap">
          {lesson.practice.map((p) => <Link key={p.route} className="btn" to={p.route}><Icon name="dumbbell" /> {p.label}</Link>)}
          <button className="btn ghost" onClick={onRestart}><Icon name="rotate-ccw" /> Làm lại bài học</button>
        </div>
        {next && (
          <div className="recommend" style={{ marginTop: 10 }}>
            <strong>Huấn luyện viên gợi ý: {next.title}</strong>
            <div className="small">{next.reasonVi}</div>
            <button className="btn primary small" style={{ marginTop: 6 }} onClick={() => onNext(next.route)}>Bắt đầu</button>
          </div>
        )}
      </Card>
    </>
  );
}

/** Spaced review: a short quiz from the lesson's independent exercises (previous errors first). */
function ReviewSession({ data, onDone }: { data: LessonData; onDone: () => void }) {
  const { lesson } = data;
  const [ids, setIds] = useState<string[] | null>(null);
  const [responses, setResponses] = useState<Record<string, LessonResponse>>({});
  const [result, setResult] = useState<{ score: number; status: string; nextReview: string; results: { id: string; correct: boolean; score: number; misconception: string | null }[] } | null>(null);
  const tick = useActiveTime();
  useEffect(() => { void api<{ exerciseIds: string[] }>(`/api/lessons/${lesson.id}/review`).then((r) => setIds(r.exerciseIds)); }, [lesson.id]);
  if (!ids) return <Loading />;
  const exs = ids.map((id) => lesson.independent.find((e) => e.id === id)!).filter(Boolean);
  const submit = async () => {
    const r = await post<NonNullable<typeof result>>(`/api/lessons/${lesson.id}/review`, { responses, timeSec: tick() });
    setResult(r);
  };
  const answerOf = (id: string): LessonAnswer | null => {
    if (!(id in responses)) return null;
    const g = result?.results.find((x) => x.id === id);
    return { section: "review", response: responses[id], correct: g?.correct ?? false, score: g?.score ?? 0, misconception: g?.misconception ?? null, at: "" };
  };
  return (
    <div className="page">
      <div className="muted small"><Link to="/learn" className="row gap-s" style={{ display: "inline-flex" }}><Icon name="chevron-left" size={16} />Lộ trình học</Link></div>
      <h1>Ôn lại: {lesson.titleVi}</h1>
      <p className="muted">Ôn ngắt quãng — {exs.length} câu. Nhớ lại kỹ thuật trước khi trả lời: <em>{lesson.objectives[0]}</em></p>
      {result && (
        <Card>
          <div className="row gap wrap">
            <div className={`ring ${result.score >= lesson.mastery.advance ? "good" : ""}`} style={{ ["--p" as string]: Math.round(result.score * 100) }}><span>{Math.round(result.score * 100)}%</span></div>
            <div>
              <p>{result.score >= lesson.mastery.advance ? "Bạn vẫn nhớ tốt kỹ thuật này. Lần ôn tiếp theo sẽ cách xa hơn." : "Bạn đã quên một phần — lịch ôn được rút ngắn. Nên xem lại phần khái niệm."}</p>
              <p className="small">Lần ôn tiếp theo: <strong>{result.nextReview}</strong></p>
              <div className="row gap-s"><Link className="btn small" to={`/learn/${lesson.id}?step=concept`}>Xem lại khái niệm</Link><button className="btn small primary" onClick={onDone}>Xong</button></div>
            </div>
          </div>
        </Card>
      )}
      {exs.map((ex, i) => (
        <ExerciseCard key={ex.id} ex={ex} index={i} stim={ex.stimulusId ? lesson.stimuli[ex.stimulusId] : undefined} section="review" answer={answerOf(ex.id)}
          showFeedback={Boolean(result)} misconceptions={lesson.misconceptions} onSubmit={async (r) => { setResponses((x) => ({ ...x, [ex.id]: r })); }} />
      ))}
      {!result && <button className="btn primary" disabled={Object.keys(responses).length < exs.length} onClick={() => void submit()}>Nộp bài ôn ({Object.keys(responses).length}/{exs.length})</button>}
    </div>
  );
}
