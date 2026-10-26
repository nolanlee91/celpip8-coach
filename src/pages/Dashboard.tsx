import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Dashboard as DashboardData, PlanBlock } from "../../shared/types";
import { CATEGORIES, SKILL_LABEL, SKILLS, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Card, ErrorBox, Loading, ProgressBar, Segmented } from "../components/ui";
import { Icon, type IconName } from "../components/Icon";
import type { LearningSummary } from "./Learn";

const SKILL_ICON: Record<Skill, IconName> = { reading: "book-open", listening: "headphones", speaking: "mic", writing: "pen-line" };

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

/** The rest of today's session as a quiet timetable. The dashboard's one primary button lives above it. */
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
                  <button className={`icon-btn slot-check ${done ? "on" : ""}`} onClick={() => onToggle(b.id, !done)} aria-pressed={done} aria-label={done ? "Bỏ đánh dấu đã xong" : "Đánh dấu đã xong"} title={done ? "Bỏ đánh dấu" : "Đánh dấu xong"}>
                    <Icon name={done ? "circle-check" : "check"} size={18} />
                  </button>
                </span>
              </div>
              <Link className="slot-title" to={b.route}>{b.title}</Link>
              {!done && <div className="slot-detail">{b.detail}</div>}
              {b.reason && !done && <details className="slot-reason"><summary>Vì sao?</summary><p>{b.reason}</p></details>}
            </div>
          </li>
        );
      })}
      <li className="session-end"><span>{t}′</span><span /><span>Hết buổi học</span></li>
    </ol>
  );
}

interface Primary { state: string; headline: string; title: string; skill: Skill | null; minutes: number; reasonVi: string; route: string; cta: string }

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
  const primary = data.primary as Primary | undefined;
  const isNew = Boolean(data.isNewLearner);
  const totalMin = plan.blocks.reduce((n, b) => n + b.minutes, 0);
  const doneMin = plan.blocks.filter((b) => plan.completed.includes(b.id)).reduce((n, b) => n + b.minutes, 0);
  const toggle = async (id: string, done: boolean) => {
    await post("/api/plan/complete", { blockId: id, done });
    void load(minutes);
  };
  const mastery = (k: Skill) => learning?.mastery.find((m) => m.skill === k);

  return (
    <div className="page">
      <p className="greet">Chào {data.settings.learnerName}. Tuần {plan.week}/{data.settings.planWeeks} của kế hoạch.</p>

      {/* 1. The one thing to do now: what, why, how long, then what. */}
      {primary && (
        <section className={`primary-action ${primary.skill ? `skill-${primary.skill}` : ""}`} aria-labelledby="primary-h">
          <h1 id="primary-h">{primary.headline}</h1>
          <p className="pa-title">{primary.title}</p>
          <p className="pa-meta">
            {primary.skill && <><Icon name={SKILL_ICON[primary.skill]} size={16} /> {SKILL_LABEL[primary.skill]}</>}
            <span className="pa-sep" aria-hidden />
            <Icon name="clock" size={16} /> khoảng {primary.minutes} phút
          </p>
          <p className="pa-why">{primary.reasonVi}</p>
          <button className="btn primary big pa-cta" onClick={() => nav(primary.route)}><Icon name="play" /> {primary.cta}</button>
          {data.afterPrimary && <p className="pa-next">{data.afterPrimary}</p>}
        </section>
      )}

      {/* 2. Secondary: the rest of today, reviews, progress. */}
      <div className="today">
        <Card title="Kế hoạch hôm nay" actions={
          <Segmented value={minutes ?? data.settings.dailyMinutes} options={[30, 60, 90, 120].map((m) => ({ value: m, label: `${m} phút` }))} onChange={(m) => setMinutes(m)} />
        }>
          <p className="muted small" style={{ marginTop: -6 }}>Đã xong {doneMin}/{totalMin} phút. Bấm vào tên một mục để mở, bấm dấu tích khi làm xong.</p>
          <Session blocks={plan.blocks} completed={plan.completed} onToggle={toggle} />
        </Card>

        <div className="today-side">
          <Card title="Ôn tập đến hạn">
            {data.dueMistakes + data.dueVocab + (learning?.dueReviews ?? 0) === 0
              ? <p className="muted small">Hôm nay chưa có gì đến hạn ôn. Những gì bạn học sẽ được nhắc ôn lại đúng lúc sắp quên.</p>
              : (
                <dl className="facts">
                  {(learning?.dueReviews ?? 0) > 0 && <><dt>Bài học cần ôn</dt><dd><Link to="/learn">{learning!.dueReviews}</Link></dd></>}
                  <dt>Câu đã sai</dt><dd><Link to="/mistakes?review=1">{data.dueMistakes}</Link></dd>
                  <dt>Từ vựng</dt><dd><Link to="/vocabulary?review=1">{data.dueVocab}</Link></dd>
                </dl>
              )}
          </Card>

          <Card title="Tiến độ tới Level 8">
            <table className="scores compact">
              <thead><tr><th>Kỹ năng</th><th>Hiện tại</th><th>Bài đã vững</th></tr></thead>
              <tbody>{data.skills.map((s) => {
                const m = mastery(s.skill);
                return (
                  <tr key={s.skill} className={`skill-${s.skill}`}>
                    <td className="skill"><span className="dot" />{SKILL_LABEL[s.skill]}</td>
                    <td>{s.estimate ?? s.official} <span className="gap">/ {s.target}</span></td>
                    <td>{m ? `${m.mastered}/${m.lessons}` : "–"}</td>
                  </tr>
                );
              })}</tbody>
            </table>
            <p className="muted tiny">"Hiện tại" là điểm chính thức, hoặc ước tính luyện tập khi đã đủ bài. Không phải điểm CELPIP chính thức.</p>
          </Card>
        </div>
      </div>

      {isNew ? (
        <p className="muted small">Thống kê, điểm yếu và tiến bộ sẽ xuất hiện ở đây sau vài bài học đầu tiên.</p>
      ) : learning && (
        <Card title="Tiến bộ và điểm còn yếu" actions={<Link to="/analytics" className="btn small ghost">Thống kê chi tiết</Link>}>
          <div className="grid-2 tight">
            <div>
              <h4>Tiến bộ gần đây</h4>
              {learning.improvements.length ? <ul className="plain">{learning.improvements.map((t) => <li key={t}>{t}</li>)}</ul>
                : <p className="muted small">Chưa có thay đổi đủ lớn để ghi nhận.</p>}
            </div>
            <div>
              <h4>Điểm còn giữ bạn dưới Level 8</h4>
              <ul className="plain">{learning.blockers.slice(0, 3).map((b) => (
                <li key={`${b.skill}-${b.label}`}>{b.textVi} {b.lessonId && <Link to={`/learn/${b.lessonId}`}>Học: {b.lessonTitle}</Link>}</li>
              ))}</ul>
            </div>
          </div>
          <details className="more">
            <summary>Mục tiêu tuần</summary>
            {data.weeklyGoals.map((g) => (
              <div key={g.label} className="bar-row">
                <span>{g.label}</span>
                <ProgressBar value={g.done} max={g.target} tone={g.done >= g.target ? "good" : undefined} />
                <span className="muted small">{g.done}/{g.target}</span>
              </div>
            ))}
          </details>
        </Card>
      )}
    </div>
  );
}
