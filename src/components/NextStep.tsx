import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Icon } from "./Icon";

export interface NextStepData {
  title: string;
  reasonVi: string;
  route: string;
  cta: string;
  secondary: { label: string; route: string } | null;
  nextReviewVi: string | null;
}

/** "What now?" at the end of an activity: one primary action from the coach and a quiet way home. */
export function NextStep({ after, attemptId, refreshKey }: { after: "lesson" | "practice" | "review"; attemptId?: string | null; refreshKey?: unknown }) {
  const [d, setD] = useState<NextStepData | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ after, ...(attemptId ? { attemptId } : {}) });
    api<NextStepData>(`/api/next-step?${q}`).then(setD).catch(() => setD(null));
  }, [after, attemptId, refreshKey]);
  if (!d) return null;
  return (
    <section className="next-step" aria-label="Bước tiếp theo">
      <h3 className="next-step-title">{d.title}</h3>
      <p>{d.reasonVi}</p>
      {d.nextReviewVi && <p className="muted small">{d.nextReviewVi}</p>}
      <div className="row gap-s wrap">
        <Link className="btn primary" to={d.route}><Icon name="play" /> {d.cta}</Link>
        {d.secondary && <Link className="btn ghost" to={d.secondary.route}>{d.secondary.label}</Link>}
      </div>
    </section>
  );
}
