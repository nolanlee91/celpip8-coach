import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, post } from "../api";
import { Icon } from "./Icon";
import { useStatus } from "./Practice";
import { loadVoices, speak, stopSpeaking } from "../lib/speech";

// Select an English word or short phrase anywhere in the study texts (double-click on a computer,
// long-press on a phone) to see its meaning, hear it, and save it to the notebook together with the
// sentence it came from. Other components can open it too: window.dispatchEvent(new CustomEvent("lookup", { detail })).

interface Lookup { term: string; vi: string; definition: string; partOfSpeech: string; libraryExample?: string; from: "library" | "dictionary" | "ai" | "none"; inNotebook: boolean }
interface Picked { term: string; context: string; x: number; y: number; bottom: number; source: string }
export interface LookupRequest { term: string; context?: string; source?: string }

const WORDS = /^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}$/;
// Where selections are left alone: form fields, controls, and passages that have their own toolbar.
const SKIP = "input, textarea, select, button, .passage-text, .word-lookup, .tutor-drawer, .notepad";

const FROM_LABEL: Record<Lookup["from"], string> = {
  library: "Thư viện từ vựng của ứng dụng",
  dictionary: "Từ điển Wiktionary, nghĩa tiếng Việt dịch tự động (MyMemory)",
  ai: "Giải thích bằng AI (Gemini)",
  none: "",
};

/** The sentence around the selection, taken from the nearest block of text. */
function sentenceAround(range: Range): string {
  let el: Node | null = range.startContainer;
  while (el && !(el instanceof HTMLElement && /^(P|LI|BLOCKQUOTE|TD|DD|DIV|SECTION|ARTICLE)$/.test(el.tagName))) el = el.parentNode;
  const block = (el as HTMLElement | null) ?? (range.startContainer.parentElement as HTMLElement);
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const text = block.textContent ?? "";
  const at = pre.toString().length;
  const start = Math.max(text.lastIndexOf(". ", at), text.lastIndexOf("? ", at), text.lastIndexOf("! ", at), text.lastIndexOf("\n", at));
  const ends = [". ", "? ", "! ", "\n"].map((p) => text.indexOf(p, at)).filter((i) => i >= 0);
  const end = ends.length ? Math.min(...ends) + 1 : text.length;
  return text.slice(start < 0 ? 0 : start + 1, end).replace(/\s+/g, " ").trim().slice(0, 300);
}

const VI_CHARS = /[ăâđêôơưàáạảãằắặẳẵầấậẩẫèéẹẻẽềếệểễìíịỉĩòóọỏõồốộổỗờớợởỡùúụủũừứựửữỳýỵỷỹ]/i;

/** Lesson notes mix Vietnamese and English: keep only the English stretch that holds the term. */
function englishPart(sentence: string, term: string): string {
  if (!VI_CHARS.test(sentence)) return sentence;
  const t = term.toLowerCase();
  const piece = sentence.split(/[:;()“”"*]/).map((x) => x.trim())
    .find((x) => x.toLowerCase().includes(t) && !VI_CHARS.test(x));
  return piece ?? sentence;
}

/** Where a saved word came from, in the notebook's usual "kind:id" form (lesson:rd-01, reading:R1…). */
function sourceOf(pathname: string): string {
  const [, a, b] = pathname.split("/");
  if (a === "learn" && b) return `lesson:${b}`;
  const task = new URLSearchParams(location.search).get("task");
  return a ? `${a}${task ? `:${task}` : ""}` : "lookup";
}

const say = async (t: string) => { stopSpeaking(); await loadVoices(); void speak(t, "narrator", { rate: 0.9 }); };

/** The sentence with the looked-up term in bold. */
function Highlighted({ sentence, term }: { sentence: string; term: string }) {
  const i = sentence.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return <>{sentence}</>;
  return <>{sentence.slice(0, i)}<strong>{sentence.slice(i, i + term.length)}</strong>{sentence.slice(i + term.length)}</>;
}

export function WordLookup() {
  const status = useStatus();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Lookup | null>(null);
  const [busy, setBusy] = useState<"look" | "ai" | "save" | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const card = useRef<HTMLDivElement>(null);

  const close = useCallback(() => { setPicked(null); setOpen(false); setData(null); setMsg(null); }, []);

  const lookUp = useCallback(async (p: Picked, ai = false) => {
    setOpen(true); setBusy(ai ? "ai" : "look"); setMsg(null);
    try {
      const q = new URLSearchParams({ term: p.term, context: p.context, ...(ai ? { ai: "1" } : {}) });
      setData(await api<Lookup>(`/api/vocab/lookup?${q}`));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  // A finished selection of 1-4 English words inside the page offers a lookup.
  useEffect(() => {
    let timer: number | undefined;
    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (open) return;
        const s = window.getSelection();
        const text = s?.toString().replace(/\s+/g, " ").trim() ?? "";
        if (!s || s.isCollapsed || !WORDS.test(text) || text.length > 40) { setPicked(null); return; }
        const range = s.getRangeAt(0);
        const host = range.commonAncestorContainer instanceof HTMLElement ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        if (!host?.closest("main") || host.closest(SKIP)) { setPicked(null); return; }
        const r = range.getBoundingClientRect();
        setPicked({ term: text, context: englishPart(sentenceAround(range), text), x: r.left + r.width / 2, y: r.top, bottom: r.bottom, source: sourceOf(location.pathname) });
      }, 180);
    };
    document.addEventListener("selectionchange", check);
    return () => { document.removeEventListener("selectionchange", check); window.clearTimeout(timer); };
  }, [open]);

  // Opened directly by another component (the passage toolbar's "Từ vựng").
  useEffect(() => {
    const onLookup = (e: Event) => {
      const d = (e as CustomEvent<LookupRequest>).detail;
      const p = { term: d.term, context: d.context ?? "", x: window.innerWidth / 2, y: 120, bottom: 120, source: d.source ?? "lookup" };
      setPicked(p); void lookUp(p);
    };
    window.addEventListener("lookup", onLookup);
    return () => window.removeEventListener("lookup", onLookup);
  }, [lookUp]);

  // Esc and a click outside close the card; scrolling moves the selection, so the small button hides.
  useEffect(() => {
    if (!picked) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    const onDown = (e: PointerEvent) => { if (open && card.current && !card.current.contains(e.target as Node)) close(); };
    const onScroll = () => { if (!open) setPicked(null); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pointerdown", onDown); window.removeEventListener("scroll", onScroll); };
  }, [picked, open, close]);

  useEffect(() => { if (open) card.current?.focus(); }, [open]);

  if (!picked) return null;

  const save = async () => {
    if (!data) return;
    setBusy("save");
    try {
      const r = await post<{ from: string }>("/api/vocab", { term: data.term, context: picked.context, source: picked.source, vi: data.vi, definition: data.definition });
      setData({ ...data, inNotebook: true });
      setMsg(r.from === "notebook" ? "Từ này đã có trong sổ." : "Đã thêm vào sổ từ, kèm câu trong bài.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    const left = Math.min(Math.max(picked.x, 70), window.innerWidth - 70);
    // On touch screens the system's copy menu sits above the selection, so the button goes below it.
    const below = window.matchMedia("(pointer: coarse)").matches;
    return (
      <button className="word-lookup word-chip" style={{ left, top: below ? Math.min(window.innerHeight - 120, picked.bottom + 10) : Math.max(8, picked.y - 46) }}
        onPointerDown={(e) => e.preventDefault()} onClick={() => void lookUp(picked)}>
        <Icon name="book-open" size={15} /> Tra nghĩa
      </button>
    );
  }

  const example = picked.context || data?.libraryExample || "";
  return (
    <div className="word-lookup word-card" role="dialog" aria-label={`Nghĩa của ${picked.term}`} tabIndex={-1} ref={card}>
      <div className="row between">
        <div className="row gap-s">
          <strong className="term big-ish">{data?.term ?? picked.term}</strong>
          <button className="icon-btn" aria-label="Nghe phát âm" title="Nghe phát âm" onClick={() => void say(data?.term ?? picked.term)}><Icon name="volume-2" /></button>
          {data?.partOfSpeech && <span className="muted small">{data.partOfSpeech}</span>}
        </div>
        <button className="icon-btn" aria-label="Đóng" onClick={close}><Icon name="x" /></button>
      </div>

      {busy === "look" || busy === "ai" ? <p className="muted small">Đang tra nghĩa…</p> : data && (
        <>
          {data.from === "none"
            ? <p className="muted small">Không tìm thấy nghĩa trong thư viện hay từ điển. Bạn vẫn có thể lưu từ này kèm câu trong bài.</p>
            : <>
                {data.vi && <p className="word-vi">{data.vi}</p>}
                {data.definition && <p className="small">{data.definition}</p>}
              </>}
          {example && (
            <div className="word-example">
              <span className="muted tiny">{picked.context ? "Câu trong bài" : "Câu mẫu"}</span>
              <p className="small"><em><Highlighted sentence={example} term={picked.term} /></em>
                {" "}<button className="icon-btn" aria-label="Nghe câu" title="Nghe câu" onClick={() => void say(example)}><Icon name="volume-2" /></button></p>
            </div>
          )}
          {FROM_LABEL[data.from] && <p className="muted tiny">Nguồn: {FROM_LABEL[data.from]}</p>}
        </>
      )}

      <div className="row gap-s wrap">
        {data?.inNotebook
          ? <Link className="btn small" to="/vocabulary" onClick={close}>Xem trong sổ từ</Link>
          : <button className="btn primary small" disabled={!data || busy !== null} onClick={() => void save()}><Icon name="plus" size={15} /> Thêm vào sổ từ</button>}
        {status?.aiConfigured && data && data.from !== "library" && data.from !== "ai" && (
          <button className="btn small ghost" disabled={busy !== null} onClick={() => void lookUp(picked, true)}><Icon name="sparkles" size={15} /> Giải thích bằng AI</button>
        )}
      </div>
      {msg && <p className="small ok-msg" role="status">{msg}</p>}
    </div>
  );
}
