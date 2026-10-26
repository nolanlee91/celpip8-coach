import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard as DashboardData } from "../../shared/types";
import { CATEGORIES, SKILL_LABEL, SKILLS, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, ProgressBar, Segmented } from "../components/ui";
import { MasteryBars, RecommendationCard, type LearningSummary } from "./Learn";

const KIND: Record<string, { label: string; tone: "info" | "good" | "warn" | "neutral" | "bad" }> = {
  learn: { label: "Học", tone: "info" }, guided: { label: "Luyện có hướng dẫn", tone: "info" }, "lesson-review": { label: "Ôn bài học", tone: "warn" },
  vocab: { label: "Từ vựng", tone: "neutral" }, mistakes: { label: "Ôn lỗi", tone: "warn" }, practice: { label: "Practice", tone: "good" }, exam: { label: "Thi thử", tone: "bad" }, weekly: { label: "Kiểm tra tuần", tone: "bad" },
};

const SKILL_ICON: Record<Skill, string> = { listening: "🎧", reading: "📖", writing: "✍️", speaking: "🎙" };

export function Heatmap({ stats }: { stats: DashboardData["categoryStats"] }) {
  return (
    <div className="heatmap">
      {SKILLS.map((skill) => (
        <div key={skill} className="heat-row">
          <div className="heat-label">{SKILL_LABEL[skill]}</div>
          <div className="heat-cells">
            {Object.entries(CATEGORIES[skill]).map(([cat, label]) => {
              const st = stats.find((s) => s.skill === skill && s.category === cat);
              const acc = st ? st.accuracy : null;
              const cls = acc === null ? "none" : acc >= 0.8 ? "h4" : acc >= 0.65 ? "h3" : acc >= 0.5 ? "h2" : "h1";
              return (
                <div key={cat} className={`heat-cell ${cls}`} title={`${label}: ${acc === null ? "chưa có dữ liệu" : `${Math.round(acc * 100)}% (${st!.correct}/${st!.total})`}`}>
                  <span>{label}</span>
                  <strong>{acc === null ? "–" : `${Math.round(acc * 100)}%`}</strong>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div className="heat-legend muted small">
        <span className="heat-cell h1" /> &lt;50% <span className="heat-cell h2" /> 50–64% <span className="heat-cell h3" /> 65–79% <span className="heat-cell h4" /> ≥80% · Writing/Speaking: % bài không bị đánh dấu yếu ở tiêu chí đó
      </div>
    </div>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  const load = (m?: number | null) =>
    api<DashboardData>(`/api/dashboard${m ? `?minutes=${m}` : ""}`).then(setData).catch((e) => setError(e.message));
  useEffect(() => { void load(minutes); }, [minutes]);

  if (error) return <ErrorBox error={error} onRetry={() => load(minutes)} />;
  if (!data) return <Loading />;

  const { plan } = data;
  const learning = data.learning as LearningSummary | undefined;
  const nextBlock = plan.blocks.find((b) => !plan.completed.includes(b.id)) ?? plan.blocks[0];
  const toggle = async (id: string, done: boolean) => {
    await post("/api/plan/complete", { blockId: id, done });
    void load(minutes);
  };

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>Chào {data.settings.learnerName} 👋</h1>
          <p className="muted">Tuần {plan.week}/{data.settings.planWeeks} · Giai đoạn {plan.phase.number}: <strong>{plan.phase.name}</strong> — {plan.phase.goal}</p>
        </div>
        <button className="btn primary big" onClick={() => nextBlock && nav(nextBlock.route)}>▶ Bắt đầu buổi học hôm nay</button>
      </div>

      <Card title="📋 Kế hoạch học hôm nay" className="today-plan" actions={
        <Segmented value={minutes ?? data.settings.dailyMinutes} options={[30, 60, 90, 120].map((m) => ({ value: m, label: `${m}′` }))} onChange={(m) => setMinutes(m)} />
      }>
        <ul className="plan-list">
          {plan.blocks.map((b) => {
            const done = plan.completed.includes(b.id);
            const kind = b.kind ? KIND[b.kind] : null;
            return (
              <li key={b.id} className={done ? "done" : ""}>
                <input type="checkbox" checked={done} onChange={(e) => toggle(b.id, e.target.checked)} />
                <div className="grow">
                  <div className="row between wrap gap-s"><span>{kind && <Badge tone={kind.tone}>{kind.label}</Badge>} <strong>{b.title}</strong></span><span className="muted small">{b.minutes} phút</span></div>
                  <div className="muted small">{b.detail}</div>
                  {b.reason && <div className="small reason">💡 {b.reason}</div>}
                </div>
                <Link className="btn small" to={b.route}>Bắt đầu</Link>
              </li>
            );
          })}
        </ul>
        <p className="muted tiny">Tổng {plan.blocks.reduce((n, b) => n + b.minutes, 0)} phút · trộn bài học, luyện có hướng dẫn, ôn ngắt quãng và luyện dạng thi theo điểm yếu của bạn.</p>
      </Card>

      {learning && (
        <div className="grid-2">
          <Card title="🧭 Nên học gì tiếp theo?">
            {learning.next ? <RecommendationCard rec={learning.next} /> : <p className="muted">Bạn đã hoàn thành lộ trình hiện có 🎉 — tiếp tục Practice Mode và thi thử.</p>}
            {learning.dueReviews > 0 && <p className="small" style={{ marginTop: 8 }}>🔁 {learning.dueReviews} bài học đến hạn ôn — <Link to="/learn">xem lịch ôn</Link></p>}
            <h4>Mức độ nắm vững</h4>
            <MasteryBars rows={learning.mastery} />
          </Card>
          <Card title="🚧 Điều đang giữ bạn dưới Level 8">
            <ul className="plain">{learning.blockers.map((b) => (
              <li key={`${b.skill}-${b.label}`}>{b.textVi} {b.lessonId && <Link to={`/learn/${b.lessonId}`}>→ {b.lessonTitle}</Link>}</li>
            ))}</ul>
            <h4>📈 Bạn đã tiến bộ gì?</h4>
            {learning.improvements.length ? <ul className="plain">{learning.improvements.map((t) => <li key={t}>{t}</li>)}</ul> : <p className="muted small">Chưa có thay đổi đủ lớn để ghi nhận — hoàn thành vài bài học và bài luyện để thấy tiến bộ ở đây.</p>}
            <div className="recommend small">Practice: {data.recommendation}</div>
          </Card>
        </div>
      )}

      <div className="skill-cards">
        {data.skills.map((s) => {
          const est = s.estimate;
          const gap = s.target - (est ?? s.official);
          return (
            <Link to={`/${s.skill}`} key={s.skill} className="card skill-card">
              <div className="row between">
                <h3>{SKILL_ICON[s.skill]} {SKILL_LABEL[s.skill]}</h3>
                <Badge tone={gap <= 0 ? "good" : gap <= 1 ? "warn" : "bad"}>Mục tiêu {s.target}</Badge>
              </div>
              <div className="score-pair">
                <div><span className="label">Điểm chính thức</span><span className="num">{s.official}</span><span className="muted tiny">CELPIP 04/2026</span></div>
                <div className="est"><span className="label">Ước tính luyện tập</span><span className="num">{est ?? "–"}</span><span className="muted tiny">không chính thức</span></div>
              </div>
              <ProgressBar value={est ?? s.official} max={12} tone={gap <= 0 ? "good" : "warn"} />
              <div className="muted small">
                {s.accuracy !== null ? `Độ chính xác ${Math.round(s.accuracy * 100)}%` : `${s.attempts} bài`}
                {s.recentTrend !== null && ` · xu hướng ${s.recentTrend >= 0 ? "▲" : "▼"} ${Math.abs(Math.round(s.recentTrend * 100))}%`}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid-2">
        <div className="stack">
          <div className="stats-row">
            <div className="stat"><span>🔥</span><strong>{data.streak}</strong><small>ngày liên tiếp</small></div>
            <div className="stat"><span>⏱</span><strong>{data.minutesToday}′</strong><small>hôm nay</small></div>
            <div className="stat"><span>📅</span><strong>{Math.round(data.minutesWeek / 6) / 10}h</strong><small>7 ngày qua</small></div>
            <div className="stat"><span>Σ</span><strong>{Math.round(data.minutesTotal / 6) / 10}h</strong><small>tổng</small></div>
          </div>
          <Card title="Sẵn sàng thi thử?">
            <div className="row gap">
              <div className={`ring ${data.readiness.ready ? "good" : ""}`} style={{ ["--p" as string]: data.readiness.percent }}><span>{data.readiness.percent}%</span></div>
              <div>
                <p>{data.readiness.message}</p>
                <p className="muted tiny">Dự đoán dựa trên ước tính luyện tập, không phải điểm chính thức.</p>
                {data.readiness.ready && <Link className="btn small primary" to="/mock">Làm bài thi thử</Link>}
              </div>
            </div>
          </Card>
          <Card title="Ôn tập đến hạn">
            <div className="row between"><span>Thẻ lỗi cần ôn</span><Link to="/mistakes?review=1" className="btn small">{data.dueMistakes} thẻ</Link></div>
            <div className="row between" style={{ marginTop: 8 }}><span>Từ vựng cần ôn</span><Link to="/vocabulary?review=1" className="btn small">{data.dueVocab} từ</Link></div>
          </Card>
        </div>
      </div>

      <div className="grid-2">
        <Card title="Mục tiêu tuần">
          {data.weeklyGoals.map((g) => (
            <div key={g.label} className="bar-row">
              <span>{g.label}</span>
              <ProgressBar value={g.done} max={g.target} tone={g.done >= g.target ? "good" : undefined} />
              <span className="muted small">{g.done}/{g.target}</span>
            </div>
          ))}
        </Card>
        <Card title="Xu hướng độ chính xác (8 tuần)">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data.accuracyTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="week" fontSize={11} />
              <YAxis domain={[0, 100]} fontSize={11} unit="%" />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="reading" name="Reading" stroke="var(--c-reading)" connectNulls strokeWidth={2} />
              <Line type="monotone" dataKey="listening" name="Listening" stroke="var(--c-listening)" connectNulls strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Bản đồ điểm yếu (60 ngày)">
        <Heatmap stats={data.categoryStats} />
      </Card>

      <Card title="Lỗi gần đây cần chú ý" actions={<Link to="/mistakes" className="btn small ghost">Tất cả</Link>}>
        {data.recentMistakes.length === 0 ? <p className="muted">Chưa có lỗi nào — hãy làm bài đầu tiên.</p> : (
          <ul className="mistake-mini">
            {data.recentMistakes.map((m) => (
              <li key={m.id}>
                <Badge tone="bad">{SKILL_LABEL[m.skill]}</Badge>
                <Badge tone="info">{CATEGORIES[m.skill][m.category] ?? m.category}</Badge>
                <span className="grow ellipsis">{m.question}</span>
                {m.repeatCount > 1 && <Badge tone="warn">lặp {m.repeatCount}×</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
