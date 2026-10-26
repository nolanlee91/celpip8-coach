import { useEffect, useState } from "react";
import type { Evaluation, SpeakingPrompt, Submission, WritingPrompt } from "../../shared/types";
import { api, post, wordCount } from "../api";
import { Card, ErrorBox, Loading } from "./ui";
import { EvaluationView } from "./Results";
import { speak } from "../lib/speech";

interface AiStatus { configured: boolean; rateLimited: boolean; model: string; lastError: { message: string } | null }

export function useAiStatus() {
  const [s, setS] = useState<AiStatus | null>(null);
  useEffect(() => { api<{ ai: AiStatus }>("/api/status").then((r) => setS(r.ai)).catch(() => {}); }, []);
  return s;
}

/** Offline study material that comes with every prompt (no AI). */
export function ModelAnswer({ prompt }: { prompt: WritingPrompt | SpeakingPrompt }) {
  const sample = prompt.kind === "writing" ? prompt.modelResponse : prompt.modelAnswer;
  return (
    <div className="grid-2">
      <Card title="Bài mẫu Level 8+ (soạn sẵn)" actions={sample && <button className="btn small ghost" onClick={() => speak(sample)}>🔊 Nghe</button>}>
        {sample ? <p className="improved">{sample}</p> : <p className="muted">Đề này chưa có bài mẫu.</p>}
        {sample && <p className="muted tiny">{wordCount(sample)} từ. Bài mẫu không chính thức — dùng để học cách tổ chức ý và diễn đạt.</p>}
      </Card>
      <div className="stack">
        {prompt.structure?.length ? <Card title="Dàn ý gợi ý"><ol>{prompt.structure.map((s, i) => <li key={i}>{s}</li>)}</ol></Card> : null}
        {prompt.usefulExpressions?.length ? (
          <Card title="Cụm từ hữu ích">
            <ul className="expr">{prompt.usefulExpressions.map((x, i) => <li key={i}><strong>{x.expression}</strong> — {x.usageVi}</li>)}</ul>
          </Card>
        ) : null}
        {prompt.commonMistakes?.length ? <Card title="Lỗi thường gặp"><ul>{prompt.commonMistakes.map((x, i) => <li key={i}>{x}</li>)}</ul></Card> : null}
      </div>
    </div>
  );
}

/**
 * After submission: shows the saved response, the offline model answer, and an explicit
 * "evaluate with AI" action. AI is never called automatically.
 */
export function SubmissionPanel({ submission, prompt, audioUrl, onRepeat, onEvaluated }: {
  submission: Submission; prompt: WritingPrompt | SpeakingPrompt; audioUrl?: string | null; onRepeat?: () => void; onEvaluated?: (ev: Evaluation) => void;
}) {
  const ai = useAiStatus();
  const [ev, setEv] = useState<Evaluation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(submission.lastError);
  const [newDifficulty, setNewDifficulty] = useState<number | undefined>();
  const [cached, setCached] = useState(false);

  useEffect(() => {
    if (submission.evaluationId) api<Evaluation>(`/api/evaluations/${submission.evaluationId}`).then(setEv).catch(() => {});
  }, [submission.evaluationId]);

  const evaluate = async () => {
    setBusy(true); setError(null);
    try {
      const r = await post<{ evaluation: Evaluation; cached: boolean; newDifficulty?: number }>(`/api/submissions/${submission.id}/evaluate`);
      setEv(r.evaluation); setCached(r.cached); setNewDifficulty(r.newDifficulty);
      onEvaluated?.(r.evaluation);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  if (ev) return (
    <>
      {cached && <p className="muted small">♻︎ Dùng lại nhận xét AI đã có cho đúng bài làm này (không tốn thêm lượt gọi API).</p>}
      <EvaluationView ev={ev} audioUrl={audioUrl ?? (ev.meta.audioFile ? `/api/audio/${ev.meta.audioFile}` : null)} newDifficulty={newDifficulty} onRepeat={onRepeat} />
    </>
  );

  return (
    <div className="stack">
      <Card title="Đã lưu bài làm" actions={<span className="badge good">không cần AI</span>}>
        {audioUrl && <audio controls src={audioUrl} className="audio" />}
        <p className="original">{submission.response}</p>
        <p className="muted small">{wordCount(submission.response)} từ · {Math.round(submission.durationSec / 60)} phút{submission.chosenOption ? ` · lựa chọn: ${submission.chosenOption}` : ""}</p>
        <div className="ai-box">
          <div>
            <strong>Nhận xét chi tiết bằng AI (tùy chọn)</strong>
            <p className="small muted">
              Ước tính band, sửa từng câu, bản viết lại Level 8, bài tập lặp lại. Tốn 1 lượt gọi Gemini.
              {prompt.kind === "speaking" && " AI chỉ đọc bản chép lời — không đánh giá phát âm."}
            </p>
            {ai && !ai.configured && <p className="small">⚠︎ Chưa cấu hình Gemini — bài đã được lưu, bạn có thể chấm sau khi thêm key.</p>}
            {ai?.rateLimited && <p className="small">⚠︎ Gemini đang bị giới hạn tốc độ — thử lại sau ít phút.</p>}
          </div>
          <button className="btn primary" disabled={busy || (ai !== null && !ai.configured)} onClick={evaluate}>{busy ? "AI đang chấm…" : error ? "Thử lại" : "Nhận xét bằng AI"}</button>
        </div>
        <ErrorBox error={error} />
        {busy && <Loading text="Đang chờ Gemini (~20–60s)…" />}
      </Card>
      <div className="self-check card">
        <h3>Tự kiểm tra nhanh (so với bài mẫu)</h3>
        <ul className="small">
          {prompt.kind === "writing" ? (
            <>
              <li>Đã trả lời <strong>đủ mọi ý</strong> trong đề chưa?</li>
              <li>Giọng văn (trang trọng / thân mật) có đúng với người nhận?</li>
              <li>Có câu mở đầu nêu mục đích và câu kết rõ ràng?</li>
              <li>Độ dài 150–200 từ? Có dùng 2–3 cụm từ trong danh sách bên dưới?</li>
            </>
          ) : (
            <>
              <li>Đã trả lời đúng yêu cầu và nói gần hết thời gian?</li>
              <li>Có câu mở đầu, 2 ý chính có ví dụ, câu kết?</li>
              <li>Nghe lại bản ghi: chỗ nào ngập ngừng, lặp từ, phát âm chưa rõ?</li>
            </>
          )}
        </ul>
        {onRepeat && <button className="btn small" onClick={onRepeat}>🔁 Làm lại đề này</button>}
      </div>
      <ModelAnswer prompt={prompt} />
    </div>
  );
}
