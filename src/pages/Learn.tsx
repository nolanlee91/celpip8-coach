import { LEARN_HELP } from "../components/helpText";
import { HelpTip } from "../components/Guide";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { SKILL_LABEL, SKILLS, type Skill } from "../../shared/spec";
import { api } from "../api";
import { Badge, Card, ErrorBox, Loading, ProgressBar, Segmented } from "../components/ui";
import { STATUS_LABEL } from "./Lesson";
import { Icon, type IconName } from "../components/Icon";

export interface Rec { kind: string; skill: Skill; lessonId: string | null; title: string; reasonVi: string; minutes: number; route: string; priority: number }
export interface MasteryRow { skill: Skill; lessons: number; mastered: number; needsReview: number; inProgress: number; notStarted: number; averageMastery: number | null }
export interface Blocker { skill: Skill; label: string; evidence: string; lessonId: string | null; lessonTitle: string | null; textVi: string }
export interface LearningSummary { next: Rec | null; recommendations: Rec[]; blockers: Blocker[]; improvements: string[]; mastery: MasteryRow[]; dueReviews: number }

interface LessonRow {
  id: string; skill: Skill; title: string; titleVi: string; level: string; difficulty: number; estimatedMinutes: number; competencies: string[]; tasks: string[];
  prerequisites: string[]; status: string; mastery: number | null; inProgress: boolean; locked: boolean; nextReview: string | null; runs: number; lastOutcome: string | null; audioReady: boolean;
}
interface CurriculumData extends LearningSummary {
  modules: { id: string; skill: Skill; order: number; title: string; titleVi: string; goalVi: string; lessons: LessonRow[]; planned: number }[];
  competencies: { skill: Skill; skillLabel: string; competency: string; label: string; practice: { correct: number; total: number; accuracy: number } | null; lessonMastery: number | null; need: number }[];
  consistency: { week: string; daysStudied: number; minutes: number; lessonsCompleted: number; reviews: number }[];
  reviewSchedule: { lessonId: string; title: string; due: string; status: string }[];
  counts: { planned: number; active: number; files: number };
}

const ICON: Record<Skill, IconName> = { reading: "book-open", listening: "headphones", speaking: "mic", writing: "pen-line" };
const STATUS_ICON: Record<string, IconName> = { not_started: "target", in_progress: "play", needs_review: "rotate-ccw", mastered: "circle-check" };
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function RecommendationCard({ rec, compact }: { rec: Rec; compact?: boolean }) {
  return (
    <div className={`rec ${compact ? "compact" : ""}`}>
      <div className="row between wrap gap-s">
        <strong className={`skill-${rec.skill}`}>{rec.title}</strong>
        <span className="muted small">khoảng {rec.minutes} phút</span>
      </div>
      <div className="rec-why">{rec.reasonVi}</div>
      <Link className={`btn ${compact ? "small" : "primary"}`} to={rec.route} style={{ marginTop: 6 }}>{compact ? "Mở" : <><Icon name="play" /> Bắt đầu</>}</Link>
    </div>
  );
}

export function MasteryBars({ rows }: { rows: MasteryRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.skill} className="bar-row fixed">
          <span className="row gap-s"><Icon name={ICON[r.skill]} size={16} />{SKILL_LABEL[r.skill]}</span>
          <ProgressBar value={r.mastered} max={Math.max(1, r.lessons)} tone={r.mastered === r.lessons && r.lessons ? "good" : undefined} />
          <span className="muted small">{r.mastered}/{r.lessons} nắm vững{r.needsReview ? `, ${r.needsReview} cần ôn` : ""}{r.averageMastery !== null ? `, trung bình ${pct(r.averageMastery)}` : ""}</span>
        </div>
      ))}
      <p className="muted tiny">Mastery bài học đo mức nắm kỹ thuật — không phải điểm CELPIP và không quy đổi sang điểm thi.</p>
    </>
  );
}

export function LearnPage() {
  const [data, setData] = useState<CurriculumData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skill, setSkill] = useState<Skill | "all">(() => { try { return (localStorage.getItem("learn.skill") as Skill | "all") || "all"; } catch { return "all"; } });
  useEffect(() => { void api<CurriculumData>("/api/curriculum").then(setData).catch((e) => setError(e.message)); }, []);
  useEffect(() => { try { localStorage.setItem("learn.skill", skill); } catch { /* ignore */ } }, [skill]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;

  const modules = data.modules.filter((m) => skill === "all" || m.skill === skill);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Lộ trình học</h1>
          <p>{data.counts.active} bài cho bốn kỹ năng. Mỗi bài: học kỹ thuật, xem ví dụ mẫu, luyện có gợi ý, tự làm bài kiểm tra, rồi ôn lại theo lịch.</p>
        </div>
      </div>
      <HelpTip id="learn" title="Một bài học gồm những gì?">{LEARN_HELP}</HelpTip>

      {data.next && (
        <Card title="Nên học tiếp" className="next-card">
          <RecommendationCard rec={data.next} />
          {data.recommendations.length > 1 && (
            <details style={{ marginTop: 8 }}>
              <summary className="small">Các gợi ý khác ({data.recommendations.length - 1})</summary>
              <div className="stack" style={{ marginTop: 8 }}>{data.recommendations.slice(1).map((r) => <RecommendationCard key={`${r.kind}-${r.lessonId}-${r.route}`} rec={r} compact />)}</div>
            </details>
          )}
        </Card>
      )}

      <div className="grid-2">
        <Card title="Mức độ nắm vững theo kỹ năng"><MasteryBars rows={data.mastery} /></Card>
        <Card title="Còn thiếu gì để đạt Level 8">
          {data.blockers.length === 0 ? <p className="muted">Chưa đủ dữ liệu.</p> : (
            <ul className="plain">{data.blockers.map((b) => (
              <li key={`${b.skill}-${b.label}`}>
                {b.textVi} {b.lessonId && <Link to={`/learn/${b.lessonId}`}>Học: {b.lessonTitle}</Link>}
              </li>
            ))}</ul>
          )}
          {data.improvements.length > 0 && <>
            <h4>Tiến bộ gần đây</h4>
            <ul className="plain">{data.improvements.map((t) => <li key={t}>{t}</li>)}</ul>
          </>}
        </Card>
      </div>

      <div className="row between wrap" style={{ margin: "18px 0 8px" }}>
        <h2>Bản đồ lộ trình</h2>
        <Segmented value={skill} onChange={setSkill} options={[{ value: "all" as const, label: "Tất cả" }, ...SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] }))]} />
      </div>
      <div className="legend small muted">
        {Object.entries(STATUS_LABEL).map(([k, v]) => <span key={k} className="row gap-s"><Icon name={STATUS_ICON[k]} size={15} />{v.text}</span>)} <span className="row gap-s"><Icon name="lock" size={15} />nên học bài trước nó trước (không bắt buộc)</span>
      </div>

      {modules.map((m) => (
        <Card key={m.id} title={<span className={`row gap-s skill-${m.skill}`}><Icon name={ICON[m.skill]} />{SKILL_LABEL[m.skill]}, phần {m.order}: {m.titleVi}</span>} actions={<span className="muted small">{m.lessons.filter((l) => l.status === "mastered").length}/{m.planned} nắm vững</span>}>
          <p className="muted small">{m.goalVi}</p>
          <div className="lesson-grid">
            {m.lessons.map((l, i) => (
              <Link key={l.id} to={`/learn/${l.id}`} className={`lesson-tile ${l.status}`}>
                <div className="row between gap-s">
                  <span className="tile-meta">Bài {i + 1}, {l.estimatedMinutes} phút</span>
                  {l.locked && <span title="Nên học bài tiên quyết trước" className="muted"><Icon name="lock" size={15} label="Nên học bài trước" /></span>}
                </div>
                <strong>{l.titleVi}</strong>
                <span className="muted small">{l.title}</span>
                <span className="tile-status">
                  <Icon name={STATUS_ICON[l.status] ?? "target"} size={15} />
                  {l.inProgress && l.status !== "in_progress" ? "Đang học lại" : STATUS_LABEL[l.status]?.text}
                  {l.mastery !== null && <span className="muted">, {pct(l.mastery)}</span>}
                </span>
                {l.nextReview && <span className="tile-meta">Ôn lại ngày {l.nextReview}</span>}
              </Link>
            ))}
            {m.lessons.length < m.planned && <div className="lesson-tile pending muted small">{m.planned - m.lessons.length} bài chưa được duyệt</div>}
          </div>
        </Card>
      ))}

      <div className="grid-2">
        <Card title="Lịch ôn bài học">
          {data.reviewSchedule.length === 0 ? <p className="muted">Hoàn thành một bài học để có lịch ôn.</p> : (
            <ul className="plain">{data.reviewSchedule.slice(0, 12).map((r) => (
              <li key={r.lessonId} className="row between"><Link to={`/learn/${r.lessonId}${r.status === "needs_review" ? "?review=1" : ""}`}>{r.title}</Link><span className="muted small">{r.due}</span></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Tính đều đặn (4 tuần)">
          <table className="table small">
            <thead><tr><th>Tuần từ</th><th>Ngày học</th><th>Phút</th><th>Bài học</th><th>Lần ôn</th></tr></thead>
            <tbody>{data.consistency.map((w) => <tr key={w.week}><td>{w.week}</td><td>{w.daysStudied}/7</td><td>{w.minutes}</td><td>{w.lessonsCompleted}</td><td>{w.reviews}</td></tr>)}</tbody>
          </table>
        </Card>
      </div>

      <Card title="Năng lực nền tảng yếu nhất">
        <table className="table small">
          <thead><tr><th>Kỹ năng</th><th>Năng lực</th><th>Luyện tập (60 ngày)</th><th>Mastery bài học</th><th>Mức ưu tiên</th></tr></thead>
          <tbody>{data.competencies.slice(0, 10).map((c) => (
            <tr key={`${c.skill}-${c.competency}`}>
              <td>{c.skillLabel}</td><td>{c.label}</td>
              <td>{c.practice ? `${pct(c.practice.accuracy)} (${c.practice.correct}/${c.practice.total})` : "–"}</td>
              <td>{pct(c.lessonMastery)}</td><td><ProgressBar value={c.need} max={Math.max(1, data.competencies[0]?.need ?? 1)} tone="warn" /></td>
            </tr>
          ))}</tbody>
        </table>
        <p className="muted tiny">Mức ưu tiên tính từ hiệu suất hiện tại nhân với khoảng cách tới mục tiêu của kỹ năng. Khi chưa có dữ liệu, ưu tiên theo điểm chính thức.</p>
      </Card>
    </div>
  );
}
