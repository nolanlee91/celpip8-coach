import { useEffect, useState } from "react";
import type { Settings, SpeakingPrompt, Submission } from "../../shared/types";
import { SPEAKING_TASKS } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, Unofficial } from "../components/ui";
import { History } from "../components/Practice";
import { LibraryBrowser, PickReason, useLibraryPick } from "../components/Library";
import { SpeakingRunner, type SpeakingOutput } from "../components/SpeakingRunner";
import { SubmissionPanel } from "../components/Productive";
import { useTutorContext } from "../components/Tutor";

export function SpeakingPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const { picked, busy, error, next, open, exit } = useLibraryPick<SpeakingPrompt>("speaking");

  useEffect(() => { api<Settings>("/api/settings").then(setSettings).catch(() => {}); }, []);

  if (busy) return <div className="page"><Loading text="Đang mở đề từ thư viện…" /></div>;
  if (picked) return (
    <SpeakingSession key={picked.item.id} prompt={picked.item} mode={picked.mode} banner={<PickReason reason={picked.reason} repeated={picked.repeated} />}
      onNext={() => { const i = SPEAKING_TASKS.findIndex((t) => t.id === picked.item.taskType); void next({ taskType: SPEAKING_TASKS[(i + 1) % SPEAKING_TASKS.length].id }); }}
      onSame={() => next({ taskType: picked.item.taskType })} onExit={exit} />
  );

  return (
    <div className="page">
      <h1>🎙 Speaking</h1>
      <p className="muted">Đề lấy ngay từ ngân hàng đề (kèm hình minh họa khi cần). Ghi âm, chuyển giọng nói thành chữ trong trình duyệt, xem bài mẫu Level 8 ngay — AI chỉ chạy khi bạn bấm “Nhận xét bằng AI”. <strong>AI không đánh giá phát âm</strong> vì chỉ đọc bản chép lời.</p>
      <ErrorBox error={error} />
      <div className="part-grid">
        {SPEAKING_TASKS.map((t) => (
          <Card key={t.id} title={`Task ${t.task}: ${t.name}`}>
            <p className="small muted">{t.selectSec ? `${t.selectSec}s chọn · ` : ""}{t.prepSec}s chuẩn bị · {t.speakSec}s nói · độ khó {settings?.difficulty[t.id] ?? "–"}</p>
            <button className="btn primary small" onClick={() => next({ taskType: t.id })}>Luyện</button>
          </Card>
        ))}
      </div>
      <LibraryBrowser skill="speaking" tasks={SPEAKING_TASKS.map((t) => t.id)} onOpen={(id) => open(id)} />
      <History skill="speaking" />
    </div>
  );
}

function SpeakingSession({ prompt, mode, banner, onNext, onSame, onExit }: { prompt: SpeakingPrompt; mode: string; banner: React.ReactNode; onNext: () => void; onSame: () => void; onExit: () => void }) {
  const [round, setRound] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ submission: Submission; audioUrl: string | null } | null>(null);
  const [lastOutput, setLastOutput] = useState<SpeakingOutput | null>(null);

  useTutorContext({
    exercise: `Speaking ${prompt.taskType}: ${prompt.title}`, skill: "speaking", prompt: prompt.prompt,
    options: prompt.options, transcript: done?.submission.response ?? null,
    note: "Feedback is transcript-based; pronunciation not assessed.",
  }, [prompt.id, Boolean(done)]);

  const save = async (o: SpeakingOutput) => {
    setLastOutput(o); setSaving(true); setError(null);
    try {
      const r = await post<{ submission: Submission }>("/api/submissions", {
        skill: "speaking", contentId: prompt.id, response: o.transcript, durationSec: o.durationSec, transcriptSource: o.transcriptSource,
        audioFile: o.audioFile, chosenOption: o.chosenOption, mode,
      });
      setDone({ submission: r.submission, audioUrl: o.audioUrl });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setSaving(false); }
  };
  const again = () => { setDone(null); setRound((r) => r + 1); };

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
      {!done && round === 0 && banner}
      <ErrorBox error={error} onRetry={lastOutput ? () => save(lastOutput) : undefined} />
      {saving && <Loading text="Đang lưu bài nói…" />}
      {done ? (
        <>
          <SubmissionPanel submission={done.submission} prompt={prompt} audioUrl={done.audioUrl} onRepeat={again} />
          <div className="row gap-s">
            <button className="btn primary" onClick={again}>🔁 Nói lại cùng đề</button>
            <button className="btn" onClick={onSame}>Đề khác cùng task</button>
            <button className="btn" onClick={onNext}>Task tiếp theo →</button>
          </div>
        </>
      ) : !saving && (
        <SpeakingRunner key={round} prompt={prompt} exam={false} onComplete={save} />
      )}
    </div>
  );
}
