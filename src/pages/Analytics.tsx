import { useEffect, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { SkillSummary, WeeklyAssessment } from "../../shared/types";
import { CATEGORIES, SKILL_LABEL, SKILLS, TRAPS, type Skill } from "../../shared/spec";
import { api } from "../api";
import { Card, Empty, ErrorBox, Loading } from "../components/ui";

interface AnalyticsData {
  skills: SkillSummary[];
  weekly: { week: string; reading: number | null; listening: number | null; writingBand: number | null; speakingBand: number | null; minutes: number }[];
  byTask: { taskType: string; name: string; accuracy: number | null; attempts: number }[];
  byDifficulty: { difficulty: number; reading: number | null; listening: number | null }[];
  studyDaily: Record<string, number | string>[];
  vocabStats: { total: number; mastered: number; learning: number; fresh: number; retention: number | null };
  recurring: { skill: Skill; category: string; count: number; unresolved: number }[];
  traps: { trap: string; count: number }[];
  mocks: { date: string; listening: number | null; reading: number | null; writing: number | null; speaking: number | null }[];
  weeklyAssessments: WeeklyAssessment[];
  official: Record<Skill, number>;
}

const COLORS: Record<string, string> = {
  reading: "var(--c-reading)", listening: "var(--c-listening)", writing: "var(--c-writing)", speaking: "var(--c-speaking)", vocab: "var(--c-vocab)", review: "var(--c-review)",
};

export function AnalyticsPage() {
  const [d, setD] = useState<AnalyticsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<AnalyticsData>("/api/analytics").then(setD).catch((e) => setError(e.message)); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const scoreRows = SKILLS.map((s) => {
    const sum = d.skills.find((x) => x.skill === s)!;
    return { skill: SKILL_LABEL[s], official: d.official[s], estimate: sum.estimate, target: sum.target };
  });

  return (
    <div className="page">
      <h1>Thống kê & tiến bộ</h1>

      <Card title="Điểm chính thức vs. ước tính luyện tập">
        <p className="muted small"><strong>Điểm chính thức</strong> = kết quả CELPIP ngày 01/04/2026. <strong>Ước tính luyện tập</strong> = suy ra từ bài làm trong app (độ khó × độ chính xác, hoặc band AI) — chỉ để theo dõi xu hướng, <strong>không phải điểm CELPIP</strong>.</p>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={scoreRows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="skill" /><YAxis domain={[0, 12]} /><Tooltip /><Legend />
            <Bar dataKey="official" name="Chính thức (04/2026)" fill="var(--muted-bar)" />
            <Bar dataKey="estimate" name="Ước tính luyện tập" fill="var(--accent)" />
            <Bar dataKey="target" name="Mục tiêu" fill="var(--good)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-2">
        <Card title="Độ chính xác theo tuần (Reading / Listening)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="week" fontSize={11} /><YAxis domain={[0, 100]} unit="%" fontSize={11} /><Tooltip /><Legend />
              <Line dataKey="reading" name="Reading" stroke={COLORS.reading} connectNulls strokeWidth={2} />
              <Line dataKey="listening" name="Listening" stroke={COLORS.listening} connectNulls strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Band AI ước tính theo tuần (Writing / Speaking)">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.weekly}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="week" fontSize={11} /><YAxis domain={[4, 12]} fontSize={11} /><Tooltip /><Legend />
              <Line dataKey="writingBand" name="Writing" stroke={COLORS.writing} connectNulls strokeWidth={2} />
              <Line dataKey="speakingBand" name="Speaking" stroke={COLORS.speaking} connectNulls strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid-2">
        <Card title="Độ chính xác theo dạng bài">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.byTask} layout="vertical" margin={{ left: 30 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis type="number" domain={[0, 100]} unit="%" fontSize={11} /><YAxis type="category" dataKey="taskType" fontSize={11} width={30} />
              <Tooltip formatter={(v, _n, p) => [`${v}% (${(p.payload as { attempts: number }).attempts} bài)`, (p.payload as { name: string }).name]} />
              <Bar dataKey="accuracy" fill="var(--accent)" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Độ chính xác theo độ khó">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={d.byDifficulty}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="difficulty" fontSize={11} /><YAxis domain={[0, 100]} unit="%" fontSize={11} /><Tooltip /><Legend />
              <Bar dataKey="reading" name="Reading" fill={COLORS.reading} /><Bar dataKey="listening" name="Listening" fill={COLORS.listening} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="Thời gian học (30 ngày, phút)">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={d.studyDaily}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="date" fontSize={10} /><YAxis fontSize={11} /><Tooltip /><Legend />
            {[...SKILLS, "vocab", "review"].map((k) => <Bar key={k} dataKey={k} stackId="a" name={k in SKILL_LABEL ? SKILL_LABEL[k as Skill] : k === "vocab" ? "Từ vựng" : "Ôn lỗi"} fill={COLORS[k]} />)}
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid-2">
        <Card title="Ghi nhớ từ vựng">
          <div className="grid-4">
            <div className="mock-score"><span>Tổng</span><strong>{d.vocabStats.total}</strong></div>
            <div className="mock-score"><span>Đã thuộc</span><strong>{d.vocabStats.mastered}</strong></div>
            <div className="mock-score"><span>Đang học</span><strong>{d.vocabStats.learning}</strong></div>
            <div className="mock-score"><span>Tỷ lệ nhớ</span><strong>{d.vocabStats.retention ?? "–"}{d.vocabStats.retention !== null && "%"}</strong></div>
          </div>
        </Card>
        <Card title="Lỗi lặp lại nhiều nhất">
          {d.recurring.length === 0 ? <Empty>Chưa có dữ liệu.</Empty> : (
            <table className="table">
              <thead><tr><th>Kỹ năng</th><th>Loại lỗi</th><th>Số lần</th><th>Chưa khắc phục</th></tr></thead>
              <tbody>{d.recurring.map((r) => <tr key={`${r.skill}${r.category}`}><td>{SKILL_LABEL[r.skill]}</td><td>{CATEGORIES[r.skill][r.category] ?? r.category}</td><td>{r.count}</td><td>{r.unresolved}</td></tr>)}</tbody>
            </table>
          )}
          {d.traps.length > 0 && <p className="small">Bẫy hay mắc: {d.traps.slice(0, 3).map((t) => `${TRAPS[t.trap] ?? t.trap} (${t.count})`).join(" · ")}</p>}
        </Card>
      </div>

      <Card title="Kết quả thi thử">
        {d.mocks.length === 0 ? <Empty>Chưa có bài thi thử hoàn thành.</Empty> : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={d.mocks}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" /><XAxis dataKey="date" fontSize={11} /><YAxis domain={[3, 12]} fontSize={11} /><Tooltip /><Legend />
              {SKILLS.map((s) => <Line key={s} dataKey={s} name={SKILL_LABEL[s]} stroke={COLORS[s]} strokeWidth={2} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
        <p className="muted tiny">Ước tính không chính thức.</p>
      </Card>
    </div>
  );
}
