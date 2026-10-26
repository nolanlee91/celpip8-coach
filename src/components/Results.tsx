import { NextStep } from "./NextStep";
import { Icon } from "./Icon";
import { Link } from "react-router-dom";
import type { Attempt, Evaluation, MistakeRecord, VocabItem } from "../../shared/types";
import { CATEGORIES, type Skill } from "../../shared/spec";
import { Badge, Card, Markdown, ProgressBar } from "./ui";
import { useTutor } from "./Tutor";
import { speak } from "../lib/speech";

export interface ObjectiveResult {
  attempt: Attempt;
  mistakes: MistakeRecord[];
  vocabAdded: VocabItem[];
  newDifficulty: number;
  report: {
    rows: { category: string; label: string; correct: number; total: number }[];
    traps: { trap: string; label: string; count: number }[];
    followUpFocus: string | null;
    summary: string;
  };
}

export function WeaknessReport({ result, skill }: { result: ObjectiveResult; skill: Skill }) {
  const { attempt, report } = result;
  const pct = Math.round((attempt.correct / attempt.total) * 100);
  return (
    <Card title="Báo cáo sau bài làm" className="report">
      <div className="report-top">
        <div className="big-score">{attempt.correct}/{attempt.total}<span>{pct}%</span></div>
        <div>
          <p><strong>{report.summary}</strong></p>
          <p className="muted small">
            Độ khó bài này: {attempt.difficulty} → lần sau: {result.newDifficulty}. Thời gian: {Math.round(attempt.durationSec / 60)} phút.
            {result.mistakes.length > 0 && ` Đã tạo ${result.mistakes.length} thẻ lỗi để ôn lặp lại.`}
            {result.vocabAdded.length > 0 && ` Đã thêm ${result.vocabAdded.length} từ vào sổ từ vựng.`}
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div>
          <h4>Theo loại câu hỏi</h4>
          {report.rows.map((r) => (
            <div key={r.category} className="bar-row">
              <span>{r.label}</span>
              <ProgressBar value={r.correct} max={r.total} tone={r.correct / r.total >= 0.75 ? "good" : r.correct / r.total >= 0.5 ? "warn" : "bad"} />
              <span className="muted small">{r.correct}/{r.total}</span>
            </div>
          ))}
        </div>
        <div>
          <h4>Bẫy bạn mắc phải</h4>
          {report.traps.length === 0 ? <p className="muted">Không có.</p> : report.traps.map((t) => (
            <div key={t.trap} className="row between"><span>{t.label}</span><Badge tone="bad">{t.count}×</Badge></div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 14 }}><NextStep after="practice" attemptId={attempt.id} /></div>
    </Card>
  );
}

export function EvaluationView({ ev, audioUrl, newDifficulty, onRepeat }: { ev: Evaluation; audioUrl?: string | null; newDifficulty?: number; onRepeat?: () => void }) {
  const tutor = useTutor();
  const cats = CATEGORIES[ev.skill];
  return (
    <div className="eval">
      <Card title="Kết quả ước tính (không chính thức)">
        <div className="report-top">
          <div className="big-score">{ev.bandLow === ev.bandHigh ? ev.bandLow : `${ev.bandLow}–${ev.bandHigh}`}<span>AI ước tính</span></div>
          <div className="dims">
            {ev.dimensions.map((d) => (
              <div key={d.name} className="dim">
                <div className="row between"><strong>{d.name}</strong><Badge tone={d.band >= 8 ? "good" : d.band >= 7 ? "warn" : "bad"}>~{d.band}</Badge></div>
                <p className="small">{d.commentVi}</p>
              </div>
            ))}
          </div>
        </div>
        {ev.audioCaveat && <div className="unofficial compact">{ev.audioCaveat}</div>}
        {newDifficulty !== undefined && <p className="muted small">Độ khó đề tiếp theo cho task này: {newDifficulty}.</p>}
      </Card>

      <Card title={ev.skill === "speaking" ? "1. Bản chép lời gốc" : "1. Bài viết gốc"}>
        {audioUrl && <audio controls src={audioUrl} className="audio" />}
        <p className="original">{ev.response}</p>
        <p className="muted small">{ev.meta.wordCount} từ{ev.meta.durationSec ? ` · ${ev.meta.durationSec}s` : ""}</p>
      </Card>

      <div className="grid-2">
        <Card title="2. Điểm mạnh">
          <ul>{ev.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </Card>
        <Card title="3. Ba điểm yếu chính">
          <ol>{ev.weaknesses.map((w, i) => <li key={i}><Badge tone="bad">{cats[w.category] ?? w.category}</Badge> {w.descriptionVi}</li>)}</ol>
        </Card>
      </div>

      <Card title="4. Sửa từng câu">
        {ev.corrections.length === 0 ? <p className="muted">Không có lỗi đáng kể.</p> : (
          <div className="corrections">
            {ev.corrections.map((c, i) => (
              <div key={i} className="correction">
                <div className="from">✗ {c.original}</div>
                <div className="to">✓ {c.corrected}</div>
                <div className="small muted">{c.explanationVi}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="5. Bản mẫu Level 8+" actions={<button className="btn small ghost" onClick={() => speak(ev.improvedVersion)}><Icon name="volume-2" /> Nghe</button>}>
        <p className="improved">{ev.improvedVersion}</p>
        <Markdown text={ev.improvementNotesVi} />
      </Card>

      <Card title="Cụm từ dùng lại được">
        <ul className="expr">
          {ev.reusableExpressions.map((x, i) => <li key={i}><strong>{x.expression}</strong> — {x.usageVi}</li>)}
        </ul>
      </Card>

      <Card title="6. Bài tập lặp lại" actions={onRepeat && <button className="btn small primary" onClick={onRepeat}>Làm lại ngay</button>}>
        <Markdown text={ev.followUpExercise} />
        <button className="btn small ghost" onClick={() => tutor.ask("Vì sao bài của tôi chỉ được ước tính ở mức này, và tôi cần làm gì để lên Level 8?", {
          exercise: `${ev.skill} ${ev.taskType}`, response: ev.response, estimatedBand: `${ev.bandLow}-${ev.bandHigh}`,
          weaknesses: ev.weaknesses, dimensions: ev.dimensions, transcriptOnly: ev.skill === "speaking",
        })}><Icon name="message-circle" /> Hỏi tutor về kết quả này</button>
      </Card>
    </div>
  );
}
