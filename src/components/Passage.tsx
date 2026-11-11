import { useMemo, useRef, useState } from "react";
import type { ReadingSection } from "../../shared/types";
import type { LookupRequest } from "./WordLookup";
import { ReadAloud, tableSpeech } from "./ReadAloud";
import { Translation } from "./Translation";

interface Highlight { start: number; end: number; note: string }

const blankText = (n: number) => `【${n}】`;
const toDisplay = (text: string) => text.replace(/\[\[(\d+)\]\]/g, (_, n) => blankText(Number(n)));

function findRange(hay: string, needle: string): [number, number] | null {
  if (!needle) return null;
  const h = hay.toLowerCase();
  const n = toDisplay(needle).toLowerCase().trim();
  let i = h.indexOf(n);
  if (i >= 0) return [i, i + n.length];
  const head = n.slice(0, 40);
  i = head.length > 12 ? h.indexOf(head) : -1;
  return i >= 0 ? [i, Math.min(hay.length, i + n.length)] : null;
}

export function Passage({
  section, evidence = [], activeEvidence, answers, onVocabAdded, sourceLabel,
}: {
  section: ReadingSection;
  evidence?: string[];
  activeEvidence?: string | null;
  answers?: Record<number, string>; // blank number -> chosen text (shown inline)
  onVocabAdded?: (term: string) => void;
  sourceLabel: string;
}) {
  const display = useMemo(() => toDisplay(section.text), [section.text]);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [sel, setSel] = useState<{ start: number; end: number; text: string } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  if (section.kind === "table" && section.table) {
    const t = section.table;
    return (
      <div className="passage">
        <div className="passage-label">{section.label}</div>
        <ReadAloud text={tableSpeech(t)} />
        <div className="table-wrap">
          <table className="diagram">
            <caption>{t.caption}</caption>
            <thead><tr>{t.headers.map((x, i) => <th key={i}>{x}</th>)}</tr></thead>
            <tbody>{t.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        <Translation texts={[tableSpeech(t)]} />
      </div>
    );
  }

  const evRanges = evidence.map((e) => ({ e, r: findRange(display, e) })).filter((x) => x.r) as { e: string; r: [number, number] }[];
  const blanks = [...display.matchAll(/【(\d+)】/g)].map((m) => ({ n: Number(m[1]), start: m.index!, end: m.index! + m[0].length }));

  const bounds = new Set<number>([0, display.length]);
  for (const hl of highlights) { bounds.add(hl.start); bounds.add(hl.end); }
  for (const { r } of evRanges) { bounds.add(r[0]); bounds.add(r[1]); }
  for (const b of blanks) { bounds.add(b.start); bounds.add(b.end); }
  const points = [...bounds].sort((a, b) => a - b);

  const onMouseUp = () => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || !box.current || !box.current.contains(s.anchorNode)) { setSel(null); return; }
    const range = s.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(box.current);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const text = range.toString();
    if (!text.trim()) { setSel(null); return; }
    setSel({ start, end: start + text.length, text: text.trim() });
  };

  const addHighlight = (withNote: boolean) => {
    if (!sel) return;
    const note = withNote ? window.prompt("Ghi chú cho đoạn này:") ?? "" : "";
    setHighlights((h) => [...h, { start: sel.start, end: sel.end, note }]);
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  // "Từ vựng" opens the shared lookup card: meaning, pronunciation, and saving with this sentence.
  const addVocab = () => {
    if (!sel) return;
    const term = sel.text.slice(0, 80);
    const sentence = display.slice(Math.max(0, display.lastIndexOf(".", sel.start) + 1), display.indexOf(".", sel.end) + 1 || undefined).trim();
    window.getSelection()?.removeAllRanges();
    setSel(null);
    window.dispatchEvent(new CustomEvent<LookupRequest>("lookup", { detail: { term, context: sentence, source: sourceLabel } }));
    onVocabAdded?.(term);
  };

  return (
    <div className="passage">
      <div className="passage-label">{section.label}</div>
      <ReadAloud text={section.text} />
      {sel && (
        <div className="sel-toolbar">
          <span className="muted small">“{sel.text.slice(0, 40)}{sel.text.length > 40 ? "…" : ""}”</span>
          <button className="btn small" onClick={() => addHighlight(false)}>Highlight</button>
          <button className="btn small" onClick={() => addHighlight(true)}>Ghi chú</button>
          <button className="btn small" onClick={addVocab}>Tra nghĩa · Từ vựng</button>
        </div>
      )}
      <div className="passage-text" ref={box} onMouseUp={onMouseUp}>
        {points.slice(0, -1).map((p, i) => {
          const q = points[i + 1];
          const text = display.slice(p, q);
          const blank = blanks.find((b) => b.start === p);
          if (blank) {
            const chosen = answers?.[blank.n];
            return <span key={i} className={`blank ${chosen ? "filled" : ""}`} title={chosen ?? `Câu ${blank.n}`}>{text}</span>;
          }
          const hl = highlights.find((x) => x.start <= p && x.end >= q);
          const ev = evRanges.find(({ r }) => r[0] <= p && r[1] >= q);
          const cls = [hl ? "hl" : "", ev ? "evidence" : "", ev && activeEvidence === ev.e ? "active" : ""].filter(Boolean).join(" ");
          return cls ? <mark key={i} className={cls} title={hl?.note || (ev ? "Bằng chứng cho đáp án" : undefined)}>{text}</mark> : <span key={i}>{text}</span>;
        })}
      </div>
      <Translation texts={[section.text]} />
      {highlights.some((h) => h.note) && (
        <ul className="notes">
          {highlights.filter((h) => h.note).map((h, i) => (
            <li key={i}><mark className="hl">{display.slice(h.start, h.end).slice(0, 50)}</mark> — {h.note}</li>
          ))}
        </ul>
      )}
      {highlights.length > 0 && <button className="btn small ghost" onClick={() => setHighlights([])}>Xóa highlight</button>}
    </div>
  );
}
