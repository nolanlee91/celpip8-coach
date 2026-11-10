import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icon";
import { NotePad, useNotebook } from "../components/Notebook";

function linkFor(id: string): string {
  if (id === "ai-general") return "/ai";
  if (id.startsWith("ai-")) return `/ai/${id}`;
  if (id.startsWith("lesson-")) return `/learn/${id.slice("lesson-".length)}`;
  return "/notebook";
}

/** /notebook: every page of notes in one place, newest first, with search. */
export function NotebookPage() {
  const book = useNotebook();
  const [q, setQ] = useState("");
  const entries = Object.entries(book ?? {})
    .filter(([id, e]) => id !== "celpip-general" && e.text.trim())
    .filter(([, e]) => !q.trim() || `${e.title ?? ""}\n${e.text}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
  const groups = [
    { key: "celpip", label: "CELPIP", items: entries.filter(([id]) => !id.startsWith("ai-")) },
    { key: "ai", label: "AI", items: entries.filter(([id]) => id.startsWith("ai-")) },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Vở ghi</h1>
          <p>Mọi ghi chú của bạn ở một chỗ. Mỗi bài học CELPIP và mỗi mục AI đều có trang vở riêng ở cuối trang.</p>
        </div>
      </div>

      <NotePad id="celpip-general" title="CELPIP · Ghi chú chung" heading="Ghi chú chung CELPIP" placeholder="Mẹo làm bài, cấu trúc câu hay, lỗi hay mắc, kế hoạch ngày thi…" />

      <div className="row gap-s">
        <input className="grow" type="search" placeholder="Tìm trong vở…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tìm trong vở" />
      </div>

      {book === null ? <p className="muted">Đang mở vở…</p> : groups.map((g) => (
        <section key={g.key}>
          <h2>{g.label} <span className="muted small">({g.items.length})</span></h2>
          {g.items.length === 0 ? (
            <p className="muted small">{q ? "Không có ghi chú khớp." : g.key === "ai" ? <>Chưa có ghi chú. Mở <Link to="/ai">Lộ trình AI</Link> và ghi ở cuối mỗi mục.</> : <>Chưa có ghi chú. Mở một <Link to="/learn">bài học</Link> và ghi ở cuối trang.</>}</p>
          ) : (
            <ul className="hub-list">
              {g.items.map(([id, e]) => (
                <li key={id}>
                  <Link to={linkFor(id)} className="hub-item">
                    <span className="hub-icon"><Icon name="notebook" size={20} /></span>
                    <span className="grow note-excerpt">
                      <strong>{e.title ?? id}</strong>
                      <span className="muted small">{new Date(e.updatedAt).toLocaleDateString("vi-VN")} · {e.text.trim().slice(0, 140)}{e.text.trim().length > 140 ? "…" : ""}</span>
                    </span>
                    <Icon name="chevron-right" className="hub-chevron" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
