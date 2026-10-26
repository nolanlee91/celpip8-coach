import { useEffect, useRef, useState, type ReactNode } from "react";
import { UNOFFICIAL_NOTICE } from "../../shared/spec";

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="row gap-s">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Loading({ text = "Đang tải…" }: { text?: string }) {
  return <div className="loading"><span className="spinner" /> {text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string | null; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-box">
      <strong>Lỗi:</strong> {error}
      {onRetry && <button className="btn small ghost" onClick={onRetry}>Thử lại</button>}
    </div>
  );
}

export function Unofficial({ compact }: { compact?: boolean }) {
  return <div className={`unofficial ${compact ? "compact" : ""}`}>{UNOFFICIAL_NOTICE}</div>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "bad" | "warn" | "info" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function ProgressBar({ value, max = 100, tone }: { value: number; max?: number; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="progress"><div className={`progress-fill ${tone ?? ""}`} style={{ width: `${pct}%` }} /></div>;
}

/** Countdown timer. Calls onExpire once when it reaches zero. */
export function useCountdown(seconds: number, running: boolean, onExpire?: () => void) {
  const [left, setLeft] = useState(seconds);
  const expired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;
  useEffect(() => { setLeft(seconds); expired.current = false; }, [seconds]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const initial = left;
    const t = setInterval(() => {
      const next = initial - (Date.now() - started) / 1000;
      setLeft(Math.max(0, next));
      if (next <= 0 && !expired.current) {
        expired.current = true;
        clearInterval(t);
        cb.current?.();
      }
    }, 250);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, seconds]);
  return left;
}

/** Elapsed-seconds stopwatch. */
export function useElapsed(running: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now() - sec * 1000;
    const t = setInterval(() => setSec((Date.now() - start) / 1000), 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);
  return [sec, setSec] as const;
}

export function TimerPill({ seconds, warnAt = 60 }: { seconds: number; warnAt?: number }) {
  const s = Math.max(0, Math.round(seconds));
  return <span className={`timer ${s <= warnAt ? "warn" : ""}`}>⏱ {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

/** Minimal, safe Markdown renderer (bold, italics, code, lists, headings, paragraphs). */
export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={`ul${out.length}`}>{list}</ul>);
    list = [];
  };
  lines.forEach((line, i) => {
    const bullet = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
    if (bullet) { list.push(<li key={i}>{inline(bullet[1])}</li>); return; }
    flush();
    const head = line.match(/^#{1,4}\s+(.*)/);
    if (head) out.push(<h4 key={i}>{inline(head[1])}</h4>);
    else if (line.trim()) out.push(<p key={i}>{inline(line)}</p>);
  });
  flush();
  return <div className="md">{out}</div>;
}

function inline(s: string): ReactNode[] {
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(p)) return <code key={i}>{p.slice(1, -1)}</code>;
    if (/^(_[^_]+_|\*[^*]+\*)$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    return p;
  });
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
