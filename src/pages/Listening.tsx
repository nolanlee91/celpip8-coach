import { Icon } from "../components/Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ListeningSet, Mode, Settings } from "../../shared/types";
import { LISTENING_PARTS } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, TimerPill, Unofficial, useCountdown } from "../components/ui";
import { DrillPicker, History } from "../components/Practice";
import { LibraryBrowser, PickReason, useLibraryPick } from "../components/Library";
import { McqList } from "../components/Mcq";
import { AudioChunkPlayer, AudioTranscript, SegmentPlayer, Transcript, type ChunkAudio } from "../components/ListeningPlayer";
import { WeaknessReport, type ObjectiveResult } from "../components/Results";
import { useTutorContext } from "../components/Tutor";

export type ListeningWithAudio = ListeningSet & { audio?: { ready: boolean; chunks: ChunkAudio[] } | null };

export function ListeningPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [examLike, setExamLike] = useState(false);
  const { picked, busy, error, next, open, exit } = useLibraryPick<ListeningWithAudio>("listening");

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  if (busy) return <div className="page"><Loading text="Đang mở bài từ thư viện…" /></div>;
  if (picked) {
    const set = picked.item;
    const noAudio = !set.audio?.ready && !picked.browserVoice;
    if (noAudio) return (
      <div className="page">
        <ErrorBox error="Bài này chưa có audio dựng sẵn nên không thể luyện (không thay thế bằng bài đọc chữ). Hãy tạo audio ở trang Quản trị, hoặc bật giọng đọc trình duyệt trong Cài đặt." />
        <button className="btn" onClick={exit}>Quay lại</button>
      </div>
    );
    return (
      <ListeningSession key={set.id + picked.mode} set={set} mode={picked.mode} examLike={examLike || picked.mode === "weekly"} browserVoice={picked.browserVoice}
        preferredVoice={settings?.preferredVoice} banner={<PickReason reason={picked.reason} repeated={picked.repeated} browserVoice={picked.browserVoice} />}
        onNext={() => next({ mode: picked.mode, taskType: picked.mode === "drill" ? undefined : set.taskType })} onExit={exit} />
    );
  }

  return (
    <div className="page">
      <h1>Listening</h1>
      <p className="muted">Bài được chọn từ thư viện; audio được tạo sẵn một lần (Gemini TTS, nhiều giọng) và lưu lại — không gọi API khi bạn luyện. Bài chưa có audio sẽ không được dùng{settings?.allowBrowserVoice ? ", trừ khi dùng giọng đọc trình duyệt (bạn đã bật trong Cài đặt)" : ""}.</p>
      <ErrorBox error={error} />
      <Card>
        <label className="row gap-s"><input type="checkbox" checked={examLike} onChange={(e) => setExamLike(e.target.checked)} />
          <span><strong>Điều kiện thi thật:</strong> chỉ nghe một lần, không tạm dừng, không đổi tốc độ, không xem transcript trước khi nộp.</span>
        </label>
      </Card>
      <div className="row gap-s wrap"><button className="btn primary big" onClick={() => next({ mode: "learn" })}><Icon name="play" /> Bài đề xuất cho tôi</button></div>
      <div className="part-grid">
        {LISTENING_PARTS.map((p) => (
          <Card key={p.id} title={`Part ${p.part}: ${p.name}`}>
            <p className="small muted">{p.description}</p>
            <div className="row between">
              <span className="small">{p.questions} câu · độ khó <strong>{settings?.difficulty[p.id] ?? "–"}</strong></span>
              <button className="btn primary small" onClick={() => next({ mode: "learn", taskType: p.id })}>Bắt đầu</button>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Drill theo loại lỗi">
        <DrillPicker skill="listening" onStart={(f) => next({ mode: "drill", focus: f })} />
      </Card>
      <LibraryBrowser skill="listening" tasks={LISTENING_PARTS.map((p) => p.id)} onOpen={(id) => open(id)} />
      <History skill="listening" />
    </div>
  );
}

function ListeningSession({ set, mode, examLike, browserVoice, preferredVoice, banner, onNext, onExit }: {
  set: ListeningWithAudio; mode: Mode; examLike: boolean; browserVoice: boolean; preferredVoice?: string | null; banner: React.ReactNode; onNext: () => void; onExit: () => void;
}) {
  const part = LISTENING_PARTS.find((p) => p.id === set.taskType)!;
  const [chunkIdx, setChunkIdx] = useState(0);
  const [heard, setHeard] = useState<boolean[]>(set.chunks.map(() => false));
  const [answers, setAnswers] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ObjectiveResult | null>(null);
  const [full, setFull] = useState<ListeningWithAudio>(set);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(Date.now());
  const submitting = useRef(false);

  const chunk = set.chunks[chunkIdx];
  const answerSeconds = Math.max(60, chunk.questions.length * 40);
  const audio = set.audio?.ready ? set.audio.chunks[chunkIdx] : null;

  const submit = useCallback(async () => {
    if (submitting.current) return;
    submitting.current = true;
    try {
      const r = await post<ObjectiveResult & { content: ListeningWithAudio }>("/api/attempts/objective", {
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

  const markHeard = () => setHeard((h) => h.map((v, i) => (i === chunkIdx ? true : v)));

  return (
    <div className="page">
      <div className="session-head">
        <div>
          <h2>{part.name} — {set.title}</h2>
          <div className="row gap-s wrap">
            <Badge>{mode === "drill" ? "Drill" : set.setType === "drill" ? "Drill" : examLike ? "Điều kiện thi" : "Luyện tập"}</Badge>
            <Badge>Độ khó {set.difficulty}</Badge>
            {browserVoice && <Badge tone="warn">giọng trình duyệt</Badge>}
            {set.chunks.length > 1 && <span className="muted small">Phần {chunkIdx + 1}/{set.chunks.length}</span>}
          </div>
        </div>
        <div className="row gap-s">
          {examLike && heard[chunkIdx] && !result && <TimerPill seconds={left} warnAt={20} />}
          <button className="btn ghost" onClick={onExit}>Thoát</button>
        </div>
      </div>
      <Unofficial compact />
      {!result && banner}
      <ErrorBox error={error} />
      {result && <WeaknessReport result={result} skill="listening" />}

      {!result ? (
        <div className="split">
          <div className="split-left">
            <Card title="Âm thanh">
              <p className="muted">{set.context}</p>
              {audio
                ? <AudioChunkPlayer key={chunkIdx} audio={audio} exam={examLike} onFinished={markHeard} />
                : <SegmentPlayer key={chunkIdx} segments={chunk.segments} exam={examLike} preferredVoice={preferredVoice} onFinished={markHeard} />}
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
                  {chunkIdx < set.chunks.length - 1 ? "Tiếp tục phần nghe tiếp theo" : "Nộp bài"}
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
                  {full.audio?.ready
                    ? <AudioTranscript segments={c.segments} audio={full.audio.chunks[i]} evidence={c.questions.map((q) => q.evidence)} />
                    : <Transcript segments={c.segments} evidence={c.questions.map((q) => q.evidence)} preferredVoice={preferredVoice} />}
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
              <button className="btn primary" onClick={onNext}>Bài tiếp theo (từ thư viện)</button>
              <button className="btn" onClick={onExit}>Chọn bài khác</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

