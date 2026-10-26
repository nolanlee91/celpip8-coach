import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Attempt } from "../../shared/types";
import { CATEGORIES, taskName, type Skill } from "../../shared/spec";
import { api } from "../api";
import { Badge, Card, useElapsed } from "./ui";

const TIPS = [
  "Mẹo: Đọc câu hỏi trước, rồi mới tìm thông tin trong bài.",
  "Mẹo: Đáp án đúng thường DIỄN ĐẠT LẠI ý trong bài, hiếm khi lặp nguyên văn từ.",
  "Mẹo: Cẩn thận với đáp án đúng một phần — chỉ một chi tiết sai là sai cả câu.",
  "Mẹo: Khi nghe, ghi từ khóa + số liệu, đừng cố chép cả câu.",
  "Mẹo: Speaking — mở bài 1 câu, 2 ý chính có ví dụ, kết 1 câu.",
];

export function Generating({ what }: { what: string }) {
  const [sec] = useElapsed(true);
  return (
    <Card>
      <div className="generating">
        <span className="spinner big" />
        <div>
          <strong>AI đang soạn {what}… ({Math.round(sec)}s)</strong>
          <p className="muted small">Bài được tạo riêng theo điểm yếu và độ khó hiện tại của bạn, thường mất 20–90 giây.</p>
          <p className="small">{TIPS[Math.floor(sec / 8) % TIPS.length]}</p>
        </div>
      </div>
    </Card>
  );
}

export function useStatus() {
  const [status, setStatus] = useState<{ aiConfigured: boolean } | null>(null);
  useEffect(() => { api<{ aiConfigured: boolean }>("/api/status").then(setStatus).catch(() => setStatus({ aiConfigured: false })); }, []);
  return status;
}

export function History({ skill }: { skill: Skill }) {
  const [rows, setRows] = useState<(Attempt & { title: string })[]>([]);
  useEffect(() => { api<(Attempt & { title: string })[]>(`/api/history?skill=${skill}`).then(setRows).catch(() => {}); }, [skill]);
  if (!rows.length) return null;
  return (
    <Card title="Lịch sử gần đây">
      <table className="table">
        <thead><tr><th>Ngày</th><th>Dạng bài</th><th>Chủ đề</th><th>Chế độ</th><th>Độ khó</th><th>Kết quả</th><th /></tr></thead>
        <tbody>
          {rows.slice(0, 12).map((a) => (
            <tr key={a.id}>
              <td>{a.finishedAt.slice(5, 10)}</td>
              <td>{taskName(a.taskType)}</td>
              <td className="ellipsis">{a.title}</td>
              <td><Badge>{a.mode}</Badge></td>
              <td>{a.difficulty}</td>
              <td>{a.total ? `${a.correct}/${a.total} (${Math.round((a.correct / a.total) * 100)}%)` : a.estimatedBand ? `~${a.estimatedBand[0]}–${a.estimatedBand[1]}` : "chưa chấm"}</td>
              <td>{a.evaluationId ? <Link to={`/evaluation/${a.evaluationId}`}>Xem</Link> : (a as { submissionId?: string | null }).submissionId ? <Link to={`/submission/${(a as { submissionId?: string }).submissionId}`}>Xem / chấm</Link> : <Link to={`/review/${a.id}`}>Xem lại</Link>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

export function DrillPicker({ skill, onStart }: { skill: Skill; onStart: (focus: string) => void }) {
  const [focus, setFocus] = useState(Object.keys(CATEGORIES[skill])[0]);
  return (
    <div className="row gap-s wrap">
      <select value={focus} onChange={(e) => setFocus(e.target.value)}>
        {Object.entries(CATEGORIES[skill]).filter(([k]) => k !== "time_management").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <button className="btn" onClick={() => onStart(focus)}>🎯 Tạo drill</button>
    </div>
  );
}
