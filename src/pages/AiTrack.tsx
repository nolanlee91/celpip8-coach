import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AI_ITEMS, AI_TRACK_INTRO, AI_WEEKS, DISCOVERY_PROMPT, aiItemById, type AiItem } from "../../shared/ai-track";
import { Icon } from "../components/Icon";
import { NotePad, useChecks, useNotebook } from "../components/Notebook";
import { Badge, ProgressBar } from "../components/ui";

const KIND = { course: { text: "Khóa học", tone: "info" }, practice: { text: "Thực hành", tone: "warn" }, exam: { text: "Bài kiểm tra", tone: "good" } } as const;
const TRACK = { A: "A · Team agent viết phần mềm", B: "B · Agent vận hành trong KDE Core" };

function itemProgress(book: ReturnType<typeof useNotebook>, item: AiItem) {
  const done = book?.[item.id]?.checks.filter((i) => i < item.checklist.length).length ?? 0;
  return { done, total: item.checklist.length, complete: done === item.checklist.length, hasNote: !!book?.[item.id]?.text.trim() };
}

/** /ai: the 8-week AI agents plan, with progress taken from the ticked checklists. */
export function AiTrackPage() {
  const book = useNotebook();
  const all = AI_ITEMS.map((i) => itemProgress(book, i));
  const ticked = all.reduce((n, p) => n + p.done, 0);
  const total = all.reduce((n, p) => n + p.total, 0);
  const next = AI_ITEMS.find((_, k) => !all[k].complete);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted small">{AI_TRACK_INTRO.levelVi}</div>
          <h1>{AI_TRACK_INTRO.title}</h1>
          <p>{AI_TRACK_INTRO.summaryVi}</p>
        </div>
      </div>

      <section className="card">
        <div className="row between wrap gap-s">
          <strong>Tiến độ: {ticked}/{total} việc</strong>
          <span className="muted small">{all.filter((p) => p.complete).length}/{AI_ITEMS.length} mục xong</span>
        </div>
        <ProgressBar value={ticked} max={total || 1} />
        {next && (
          <div className="row between wrap gap-s" style={{ marginTop: 12 }}>
            <span>Tiếp theo: <strong>{next.title}</strong></span>
            <Link className="btn primary" to={`/ai/${next.id}`}><Icon name="play" /> Học tiếp</Link>
          </div>
        )}
      </section>

      <details className="card ai-principles">
        <summary><strong>Nguyên tắc học</strong></summary>
        <ul>{AI_TRACK_INTRO.principlesVi.map((p) => <li key={p}>{p}</li>)}</ul>
        <p className="muted small">{AI_TRACK_INTRO.certNoteVi}</p>
      </details>

      {AI_WEEKS.map((w) => (
        <section key={w.week} className="ai-week">
          <div className="ai-week-head">
            <span className="ai-week-no">Tuần {w.week}</span>
            <div className="grow">
              <h2>{w.title}</h2>
              <p className="muted small">{w.goalVi} <span className="ai-track-tag">{TRACK[w.track]}</span></p>
            </div>
          </div>
          <ul className="hub-list">
            {w.items.map((item) => {
              const p = itemProgress(book, item);
              return (
                <li key={item.id}>
                  <Link to={`/ai/${item.id}`} className="hub-item">
                    <span className={`hub-icon ${p.complete ? "done" : ""}`}><Icon name={p.complete ? "circle-check" : item.kind === "course" ? "graduation-cap" : "wrench"} size={20} /></span>
                    <span className="grow">
                      <strong>{item.title}</strong>
                      <span className="muted small">
                        {item.provider ? `${item.provider} · ` : ""}{item.durationVi} · {p.done}/{p.total} việc{p.hasNote ? " · có ghi chú" : ""}
                      </span>
                    </span>
                    <Badge tone={KIND[item.kind].tone}>{KIND[item.kind].text}</Badge>
                    <Icon name="chevron-right" className="hub-chevron" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <section className="card">
        <h3>{AI_TRACK_INTRO.nextLevelVi.title}</h3>
        <p className="muted">{AI_TRACK_INTRO.nextLevelVi.text}</p>
      </section>

      <NotePad id="ai-general" title="AI · Ghi chú chung" heading="Ghi chú chung về AI" placeholder="Ý tưởng, câu hỏi muốn hỏi, mục tiêu nghề nghiệp, việc muốn thử ở công ty…" />
    </div>
  );
}

function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <pre>{text}</pre>
      <button className="btn small" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>
        <Icon name={copied ? "check" : "copy"} /> {copied ? "Đã chép" : "Chép prompt"}
      </button>
    </div>
  );
}

/** /ai/:id: one course or practice, with its checklist and a notebook page. */
export function AiItemPage() {
  const { id = "" } = useParams();
  const item = aiItemById(id);
  const week = AI_WEEKS.find((w) => w.items.some((i) => i.id === id));
  const { checks, toggle, ready } = useChecks(id, item ? `AI · ${item.title}` : id);
  if (!item || !week) return <div className="page"><p>Không tìm thấy mục này. <Link to="/ai">Về lộ trình AI</Link></p></div>;

  const idx = AI_ITEMS.indexOf(item);
  const prev = AI_ITEMS[idx - 1];
  const next = AI_ITEMS[idx + 1];

  return (
    <div className="page">
      <div>
        <div className="muted small"><Link to="/ai" className="row gap-s" style={{ display: "inline-flex" }}><Icon name="chevron-left" size={16} />Lộ trình AI · Tuần {week.week}</Link></div>
        <h1>{item.title}</h1>
        <div className="row gap-s wrap">
          <Badge tone={KIND[item.kind].tone}>{KIND[item.kind].text}</Badge>
          {item.provider && <Badge>{item.provider}</Badge>}
          <span className="muted small"><Icon name="clock" size={14} /> {item.durationVi}</span>
        </div>
      </div>

      <section className="card">
        <p>{item.whyVi}</p>
        {item.certificateVi && <p className="small"><strong>Chứng chỉ:</strong> {item.certificateVi}</p>}
        {item.links.length > 0 && (
          <div className="row gap-s wrap">
            {item.links.map((l, i) => (
              <a key={l.url} className={`btn ${i === 0 && item.kind === "course" ? "primary" : ""}`} href={l.url} target="_blank" rel="noreferrer">
                {l.label} <Icon name="external-link" size={16} />
              </a>
            ))}
          </div>
        )}
      </section>

      {item.id === "ai-w1-discovery" && (
        <section className="card">
          <h3>Prompt Architecture Discovery</h3>
          <p className="muted small">Dán vào Claude Code hoặc Codex khi đang mở repo KDE Core. AI chỉ đọc, không sửa file.</p>
          <CopyBlock text={DISCOVERY_PROMPT} />
        </section>
      )}

      <section className="card">
        <h3>Việc cần làm</h3>
        <ul className="checklist">
          {item.checklist.map((c, i) => (
            <li key={c}>
              <label className={checks.includes(i) ? "done" : ""}>
                <input type="checkbox" checked={checks.includes(i)} disabled={!ready} onChange={() => toggle(i)} />
                <span>{c}</span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      {item.selfCheck && (
        <section className="card">
          <h3>Tự kiểm tra (trả lời vào vở, không hỏi AI)</h3>
          <ol>{item.selfCheck.map((q) => <li key={q}>{q}</li>)}</ol>
        </section>
      )}

      <NotePad id={item.id} title={`AI · ${item.title}`} rows={12} placeholder={"Ghi chép bài học…\n\nĐiều mới học được:\n- \n\nTrả lời câu tự kiểm tra:\n1. \n\nCòn thắc mắc:\n- "} />

      <div className="row between wrap gap-s">
        {prev ? <Link className="btn ghost" to={`/ai/${prev.id}`}><Icon name="chevron-left" /> {prev.title}</Link> : <span />}
        {next ? <Link className="btn" to={`/ai/${next.id}`}>{next.title} <Icon name="chevron-right" /></Link> : <Link className="btn" to="/ai">Về lộ trình AI</Link>}
      </div>
    </div>
  );
}
