import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Dashboard as DashboardData, PlanBlock } from "../../shared/types";
import { CATEGORIES, SKILL_LABEL, SKILLS } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, ErrorBox, Loading, ProgressBar, Segmented } from "../components/ui";
import { Icon } from "../components/Icon";
import { MasteryBars, RecommendationCard, type LearningSummary } from "./Learn";

const KIND_LABEL: Record<string, string> = {
  learn: "Học bài mới", guided: "Luyện có hướng dẫn", "lesson-review": "Ôn bài học", vocab: "Từ vựng",
  mistakes: "Ôn lỗi", practice: "Luyện dạng thi", exam: "Làm bài đủ giờ", weekly: "Kiểm tra tuần",
};

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
        <span className="heat-cell h1" /> dưới 50% <span className="heat-cell h2" /> 50–64% <span className="heat-cell h3" /> 65–79% <span className="heat-cell h4" /> từ 80%. Writing/Speaking: tỷ lệ bài không bị đánh dấu yếu ở tiêu chí đó.
      </div>
    </div>
  );
}

/** The day's session drawn as a timetable: minute marks, one coloured line per skill, the next block opened up. */
function Session({ blocks, completed, onToggle }: { blocks: PlanBlock[]; completed: string[]; onToggle: (id: string, done: boolean) => void }) {
  const nextId = blocks.find((b) => !completed.includes(b.id))?.id;
  let t = 0;
  return (
    <ol className="session">
      {blocks.map((b) => {
        const start = t;
        t += b.minutes;
        const done = completed.includes(b.id);
        const now = b.id === nextId;
        return (
          <li key={b.id} className={`slot skill-${b.skill} ${done ? "done" : ""} ${now ? "now" : ""}`} style={{ ["--m" as string]: b.minutes }}>
            <span className="slot-time">{start}′</span>
            <span className="slot-bar" aria-hidden />
            <div className="slot-body">
              <div className="slot-head">
                <span className="slot-kind">{b.kind ? KIND_LABEL[b.kind] : SKILL_LABEL[b.skill as keyof typeof SKILL_LABEL] ?? "Ôn tập"}</span>
                <span className="slot-min">
                  {b.minutes} phút
                  {!now && (
                    <button className={`icon-btn slot-check ${done ? "on" : ""}`} onClick={() => onToggle(b.id, !done)} aria-pressed={done} aria-label={done ? "Bỏ đánh dấu đã xong" : "Đánh dấu đã xong"} title={done ? "Bỏ đánh dấu" : "Đánh dấu xong"}>
                      <Icon name={done ? "circle-check" : "check"} size={18} />
                    </button>
                  )}
                </span>
              </div>
              {now ? <div className="slot-title">{b.title}</div> : <Link className="slot-title" to={b.route}>{b.title}</Link>}
              <div className="slot-detail">{b.detail}</div>
              {b.reason && (now
                ? <p className="slot-reason">{b.reason}</p>
                : !done && <details className="slot-reason"><summary>Vì sao bài này?</summary><p>{b.reason}</p></details>)}
              {now && (
                <div className="slot-actions">
                  <Link className="btn primary" to={b.route}><Icon name="play" /> Bắt đầu</Link>
                  <button className="btn ghost" onClick={() => onToggle(b.id, true)}>Đánh dấu xong</button>
                </div>
              )}
            </div>
          </li>
        );
      })}
      <li className="session-end"><span>{t}′</span><span /><span>Hết buổi học</span></li>
    </ol>
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
  const doneMin = plan.blocks.filter((b) => plan.completed.includes(b.id)).reduce((n, b) => n + b.minutes, 0);
  const toggle = async (id: string, done: boolean) => {
    await post("/api/plan/complete", { blockId: id, done });
    void load(minutes);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Chào {data.settings.learnerName}</h1>
          <p>Tuần {plan.week}/{data.settings.planWeeks}, giai đoạn {plan.phase.number}: {plan.phase.name}. {plan.phase.goal}</p>
        </div>
        {nextBlock && <button className="btn primary big" onClick={() => nav(nextBlock.route)}><Icon name="play" /> {plan.completed.length ? "Học tiếp" : "Bắt đầu buổi học"}</button>}
      </div>

      <div className="today">
        <Card title="Kế hoạch học hôm nay" actions={
          <Segmented value={minutes ?? data.settings.dailyMinutes} options={[30, 60, 90, 120].map((m) => ({ value: m, label: `${m} phút` }))} onChange={(m) => setMinutes(m)} />
        }>
          <p className="muted small" style={{ marginTop: -6 }}>Đã xong {doneMin}/{plan.blocks.reduce((n, b) => n + b.minutes, 0)} phút. Bài học, luyện có hướng dẫn, ôn tập và luyện dạng thi được trộn theo điểm yếu của bạn.</p>
          <Session blocks={plan.blocks} completed={plan.completed} onToggle={toggle} />
        </Card>

        <div className="today-side">
          {learning && (
            <Card title="Nên học gì tiếp">
              {learning.next ? <RecommendationCard rec={learning.next} /> : <p className="muted">Bạn đã đi hết lộ trình hiện có. Tiếp tục luyện dạng thi và thi thử.</p>}
              {learning.dueReviews > 0 && <p className="small"><Link to="/learn">{learning.dueReviews} bài học đến hạn ôn</Link></p>}
            </Card>
          )}
          <Card title="Ôn tập đến hạn">
            <dl className="facts">
              <dt>Thẻ lỗi</dt><dd><Link to="/mistakes?review=1">{data.dueMistakes}</Link></dd>
              <dt>Từ vựng</dt><dd><Link to="/vocabulary?review=1">{data.dueVocab}</Link></dd>
              <dt>Chuỗi ngày học</dt><dd>{data.streak} ngày</dd>
              <dt>Hôm nay</dt><dd>{data.minutesToday} phút</dd>
              <dt>7 ngày qua</dt><dd>{Math.round(data.minutesWeek / 6) / 10} giờ</dd>
            </dl>
          </Card>
        </div>
      </div>

      {learning && (
        <div className="grid-2">
          <Card title="Còn thiếu gì để đạt Level 8">
            <ul className="plain">{learning.blockers.map((b) => (
              <li key={`${b.skill}-${b.label}`}>{b.textVi} {b.lessonId && <Link to={`/learn/${b.lessonId}`}>Học: {b.lessonTitle}</Link>}</li>
            ))}</ul>
            <h4>Tiến bộ gần đây</h4>
            {learning.improvements.length ? <ul className="plain">{learning.improvements.map((t) => <li key={t}>{t}</li>)}</ul>
              : <p className="muted small">Chưa có thay đổi đủ lớn để ghi nhận. Hoàn thành vài bài học và bài luyện để thấy tiến bộ ở đây.</p>}
          </Card>
          <Card title="Mức độ nắm vững bài học">
            <MasteryBars rows={learning.mastery} />
          </Card>
        </div>
      )}

      <Card title="Điểm theo kỹ năng">
        <table className="scores">
          <thead><tr><th>Kỹ năng</th><th>Chính thức</th><th>Ước tính luyện tập</th><th>Mục tiêu</th><th>Độ chính xác</th></tr></thead>
          <tbody>{data.skills.map((s) => (
            <tr key={s.skill} className={`skill-${s.skill}`}>
              <td className="skill"><Link to={`/${s.skill}`}><span className="dot" />{SKILL_LABEL[s.skill]}</Link></td>
              <td>{s.official}</td>
              <td>{s.estimate ?? <span className="gap">chưa đủ dữ liệu</span>}</td>
              <td>{s.target}</td>
              <td>{s.accuracy !== null ? `${Math.round(s.accuracy * 100)}%` : <span className="gap">{s.attempts} bài</span>}
                {s.recentTrend !== null && <span className="gap"> ({s.recentTrend >= 0 ? "+" : "−"}{Math.abs(Math.round(s.recentTrend * 100))}%)</span>}</td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted tiny">Điểm chính thức: CELPIP tháng 4/2026. Ước tính luyện tập không phải điểm chính thức. {data.readiness.message}</p>
      </Card>

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
        <Card title="Độ chính xác 8 tuần qua">
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

      <Card title="Lỗi gần đây" actions={<Link to="/mistakes" className="btn small ghost">Xem sổ lỗi</Link>}>
        {data.recentMistakes.length === 0 ? <p className="muted">Chưa có lỗi nào. Làm một bài để bắt đầu.</p> : (
          <ul className="mistake-mini">
            {data.recentMistakes.map((m) => (
              <li key={m.id}>
                <Badge tone="info">{CATEGORIES[m.skill][m.category] ?? m.category}</Badge>
                <span className="grow ellipsis">{m.question}</span>
                {m.repeatCount > 1 && <Badge tone="warn">lặp {m.repeatCount} lần</Badge>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
