import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { post } from "../api";

/**
 * "Bản dịch tiếng Việt" toggle, hidden by default so the learner reads the English first.
 * Each text is looked up in the pre-made translations; `labels` (e.g. speaker names) prefix each line.
 */
export function Translation({ texts, labels }: { texts: (string | null | undefined)[]; labels?: string[] }) {
  const items = texts.map((t, i) => ({ text: t?.trim() ?? "", label: labels?.[i] })).filter((x) => x.text);
  const key = items.map((x) => x.text).join("\u0001");
  const [open, setOpen] = useState(false);
  const [vi, setVi] = useState<(string | null)[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setOpen(false); setVi(null); setError(null); }, [key]);

  if (!items.length) return null;

  const toggle = async () => {
    if (open) return setOpen(false);
    setOpen(true);
    if (vi) return;
    try {
      setVi((await post<{ vi: (string | null)[] }>("/api/translations", { texts: items.map((x) => x.text) })).vi);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="translation">
      <button className="btn small ghost" onClick={toggle}><Icon name="book-open" /> {open ? "Ẩn bản dịch" : "Bản dịch tiếng Việt"}</button>
      {open && (
        <div className="translation-body">
          {error && <p className="muted small">Không tải được bản dịch: {error}</p>}
          {!error && !vi && <p className="muted small">Đang tải…</p>}
          {vi && vi.every((v) => !v) && <p className="muted small">Đoạn này chưa có bản dịch.</p>}
          {vi && items.map((x, i) => vi[i] && (
            <p key={i}>{x.label && <strong>{x.label}: </strong>}{vi[i]}</p>
          ))}
        </div>
      )}
    </div>
  );
}
