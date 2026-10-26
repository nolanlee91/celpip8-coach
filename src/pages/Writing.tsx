import { useEffect, useRef, useState } from "react";
import type { Submission, WritingPrompt } from "../../shared/types";
import { WRITING_TASKS } from "../../shared/spec";
import { post, wordCount } from "../api";
import { Badge, Card, ErrorBox, Loading, TimerPill, Unofficial, useCountdown } from "../components/ui";
import { History } from "../components/Practice";
import { LibraryBrowser, PickReason, useLibraryPick } from "../components/Library";
import { SubmissionPanel } from "../components/Productive";
import { useTutorContext } from "../components/Tutor";

const draftKey = (id: string) => `celpip8-draft-${id}`;

function readDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
}

export function WritingPage() {
  const { picked, busy, error, next, open, exit } = useLibraryPick<WritingPrompt>("writing");
  const [round, setRound] = useState(0);

  if (busy) return <div className="page"><Loading text="Đang mở đề từ thư viện…" /></div>;
  if (picked) return (
    <WritingSession key={picked.item.id + round} prompt={picked.item} banner={<PickReason reason={picked.reason} repeated={picked.repeated} />}
      onNext={() => next({ taskType: picked.item.taskType })} onRepeat={() => setRound((r) => r + 1)} onExit={exit} />
  );

  return (
    <div className="page">
      <h1>Writing</h1>
      <p className="muted">Bạn đã đạt 7 — mục tiêu là <strong>ổn định ở Level 8</strong>. Đề lấy ngay từ ngân hàng đề; sau khi nộp bạn xem bài mẫu Level 8 ngay lập tức, và chỉ gọi AI khi muốn nhận xét chi tiết.</p>
      <ErrorBox error={error} />
      <div className="part-grid">
        {WRITING_TASKS.map((t) => (
          <Card key={t.id} title={`Task ${t.task}: ${t.name}`}>
            <p className="small muted">{t.minutes} phút · {t.minWords}–{t.maxWords} từ</p>
            <button className="btn primary small" onClick={() => next({ taskType: t.id })}>Đề đề xuất</button>
          </Card>
        ))}
      </div>
      <LibraryBrowser skill="writing" tasks={WRITING_TASKS.map((t) => t.id)} onOpen={(id) => open(id)} />
      <History skill="writing" />
    </div>
  );
}

function WritingSession({ prompt, banner, onNext, onRepeat, onExit }: { prompt: WritingPrompt; banner: React.ReactNode; onNext: () => void; onRepeat: () => void; onExit: () => void }) {
  const spec = WRITING_TASKS.find((t) => t.id === prompt.taskType)!;
  const [text, setText] = useState(() => readDraft(prompt.id));
  const [choice, setChoice] = useState<"A" | "B" | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [hints, setHints] = useState(false);
  const startedAt = useRef(Date.now());

  // Autosave every change (debounced) to browser storage.
  useEffect(() => {
    if (submission) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey(prompt.id), text); setSavedAt(new Date().toLocaleTimeString()); } catch { /* storage unavailable */ }
    }, 600);
    return () => clearTimeout(t);
  }, [text, prompt.id, submission]);

  const left = useCountdown(spec.minutes * 60, !submission && !saving, () => setTimeUp(true));
  const wc = wordCount(text);

  useTutorContext({
    exercise: `Writing ${prompt.taskType}: ${prompt.title}`, skill: "writing", situation: prompt.situation,
    instructions: prompt.instructions, draft: text.slice(0, 3000), submitted: Boolean(submission),
  }, [prompt.id, Boolean(submission)]);

  const submit = async () => {
    setSaving(true); setError(null);
    try {
      const r = await post<{ submission: Submission }>("/api/submissions", {
        skill: "writing", contentId: prompt.id, response: text, chosenOption: prompt.optionA && choice ? `Option ${choice}` : null,
        durationSec: (Date.now() - startedAt.current) / 1000, mode: "learn",
      });
      setSubmission(r.submission);
      try { localStorage.removeItem(draftKey(prompt.id)); } catch { /* ignore */ }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>Task {spec.task}: {spec.name}</h2>
          <div className="row gap-s"><Badge>Độ khó {prompt.difficulty}</Badge><span className="muted small">{prompt.title}</span></div>
        </div>
        <div className="row gap-s">
          {!submission && <TimerPill seconds={left} warnAt={180} />}
          <button className="btn ghost" onClick={onExit}>Thoát</button>
        </div>
      </div>
      <Unofficial compact />
      {!submission && banner}
      <ErrorBox error={error} />

      {submission ? (
        <>
          <SubmissionPanel submission={submission} prompt={prompt} onRepeat={onRepeat} />
          <div className="row gap-s"><button className="btn primary" onClick={onNext}>Đề tiếp theo cùng dạng</button><button className="btn" onClick={onExit}>Quay lại</button></div>
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
            {prompt.structure?.length ? (
              <Card title="Gợi ý (không có trong bài thi thật)" actions={<button className="btn small ghost" onClick={() => setHints(!hints)}>{hints ? "Ẩn" : "Hiện dàn ý"}</button>}>
                {hints ? <ol className="small">{prompt.structure.map((s, i) => <li key={i}>{s}</li>)}</ol> : <p className="muted small">Thử tự lập dàn ý trước — chỉ mở gợi ý khi bí.</p>}
              </Card>
            ) : null}
          </div>
          <div className="split-right">
            {timeUp && <div className="error-box">Hết giờ! Trong bài thi thật bạn không thể viết thêm. Hãy nộp bài.</div>}
            <textarea className="editor" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
              placeholder="Bắt đầu viết… (kiểm tra chính tả của trình duyệt đã tắt, giống bài thi)" disabled={saving} />
            <div className="row between">
              <span className={`wc ${wc < spec.minWords ? "low" : wc > spec.maxWords ? "high" : "ok"}`}>{wc} từ</span>
              <span className="muted tiny">{savedAt ? `Đã tự lưu lúc ${savedAt}` : ""}</span>
            </div>
            <button className="btn primary big full" disabled={saving || wc < 20 || (Boolean(prompt.optionA) && !choice)} onClick={submit}>
              {saving ? "Đang lưu…" : "Nộp bài (xem bài mẫu ngay)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
