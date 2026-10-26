import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { DailyPlan, Settings, WeeklyAssessment } from "../../shared/types";
import { SKILL_LABEL, SKILLS } from "../../shared/spec";
import { api, post } from "../api";
import { Card, ErrorBox, Loading, Segmented } from "../components/ui";

const PHASES = [
  { n: 1, name: "Chẩn đoán & nền tảng", weeks: "Tuần 1–2", detail: "Làm đủ 4 part Reading, 6 part Listening, 8 task Speaking, 2 task Writing ở độ khó vừa sức để xác định điểm yếu thật." },
  { n: 2, name: "Sửa điểm yếu trọng tâm", weeks: "Tuần 3–6", detail: "Drill theo loại lỗi (suy luận, paraphrase, thái độ người nói…), ôn thẻ lỗi hằng ngày, Speaking có bài lặp lại." },
  { n: 3, name: "Luyện chuẩn Level 8", weeks: "Tuần 7–10", detail: "Full part ở độ khó 8–9, giữ độ chính xác ≥ 75%, Writing/Speaking nhắm ổn định band 8." },
  { n: 4, name: "Thi thử & hoàn thiện", weeks: "Tuần 11–12", detail: "2 bài thi thử/tuần, phân tích sau thi, ôn lỗi lặp lại, giữ phong độ trước ngày thi." },
];

export function PlannerPage() {
  const [params] = useSearchParams();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [minutes, setMinutes] = useState<number>(90);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [weekly, setWeekly] = useState<WeeklyAssessment[]>([]);
  const [checkin, setCheckin] = useState<WeeklyAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then((s) => { setSettings(s); setMinutes(s.dailyMinutes); }).catch((e) => setError(e.message));
    api<{ weeklyAssessments: WeeklyAssessment[] }>("/api/analytics").then((a) => setWeekly(a.weeklyAssessments)).catch(() => {});
  }, []);
  useEffect(() => { api<DailyPlan>(`/api/plan?minutes=${minutes}`).then(setPlan).catch((e) => setError(e.message)); }, [minutes]);

  if (error) return <ErrorBox error={error} />;
  if (!settings || !plan) return <Loading />;

  const doCheckin = async () => {
    try {
      const r = await post<WeeklyAssessment>("/api/weekly/checkin");
      setCheckin(r);
      setWeekly((w) => [...w.filter((x) => x.week !== r.week), r]);
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="page">
      <h1>🗓 Kế hoạch học {settings.planWeeks} tuần</h1>
      <p className="muted">Bắt đầu {settings.startDate} · hiện ở <strong>tuần {plan.week}</strong> · tỷ trọng: {SKILLS.map((k) => `${SKILL_LABEL[k]} ${settings.weights[k]}%`).join(" · ")} (<Link to="/settings">chỉnh</Link>)</p>

      <div className="timeline">
        {PHASES.map((p) => (
          <div key={p.n} className={`phase ${plan.phase.number === p.n ? "current" : plan.phase.number > p.n ? "past" : ""}`}>
            <div className="phase-n">{p.n}</div>
            <div><strong>{p.name}</strong> <span className="muted small">{p.weeks}</span><p className="small">{p.detail}</p></div>
          </div>
        ))}
      </div>

      <Card title={`Buổi học hôm nay (${plan.date})`} actions={<Segmented value={minutes} options={[30, 60, 90, 120].map((m) => ({ value: m, label: `${m} phút` }))} onChange={setMinutes} />}>
        <ol className="plan-list numbered">
          {plan.blocks.map((b) => (
            <li key={b.id}>
              <div className="grow">
                <div className="row between"><strong>{b.title}</strong><span className="muted small">{b.minutes} phút</span></div>
                <div className="muted small">{b.detail}</div>
              </div>
              <Link className="btn small" to={b.route}>Bắt đầu</Link>
            </li>
          ))}
        </ol>
        <p className="muted tiny">Kế hoạch được tính lại mỗi ngày từ: thời gian bạn có, lỗi đến hạn ôn, loại lỗi yếu nhất, độ khó hiện tại và xu hướng gần đây.</p>
      </Card>

      <Card title="Đánh giá hằng tuần" className={params.get("weekly") ? "highlight" : ""}>
        <p>Cuối mỗi tuần: làm 3 bài kiểm tra ngắn ở điều kiện thi, sau đó bấm “Hoàn tất” để hệ thống ước tính lại trình độ và tự điều chỉnh tỷ trọng kỹ năng{settings.autoAdjust ? "" : " (đang tắt tự điều chỉnh)"}.</p>
        <div className="row gap-s wrap">
          <Link className="btn" to="/reading?mode=weekly&task=R4">1. Reading Part 4</Link>
          <Link className="btn" to="/listening?mode=weekly&task=L5">2. Listening Part 5</Link>
          <Link className="btn" to="/speaking?mode=weekly&task=S7">3. Speaking Task 7</Link>
          <button className="btn primary" onClick={doCheckin}>✔ Hoàn tất đánh giá tuần {plan.week}</button>
        </div>
        {checkin && (
          <div className="checkin">
            <p><strong>{checkin.note}</strong></p>
            <table className="table">
              <thead><tr><th>Kỹ năng</th><th>Ước tính</th><th>Tỷ trọng cũ</th><th>Tỷ trọng mới</th></tr></thead>
              <tbody>{SKILLS.map((k) => <tr key={k}><td>{SKILL_LABEL[k]}</td><td>{checkin.estimates[k] ?? "–"}</td><td>{checkin.weightsBefore[k]}%</td><td><strong>{checkin.weightsAfter[k]}%</strong></td></tr>)}</tbody>
            </table>
          </div>
        )}
        {weekly.length > 0 && (
          <details>
            <summary className="small muted">Lịch sử đánh giá tuần</summary>
            <table className="table">
              <thead><tr><th>Tuần</th><th>Ngày</th>{SKILLS.map((k) => <th key={k}>{SKILL_LABEL[k]}</th>)}</tr></thead>
              <tbody>{weekly.map((w) => <tr key={w.id}><td>{w.week}</td><td>{w.date}</td>{SKILLS.map((k) => <td key={k}>{w.estimates[k] ?? "–"}</td>)}</tr>)}</tbody>
            </table>
          </details>
        )}
      </Card>
    </div>
  );
}
