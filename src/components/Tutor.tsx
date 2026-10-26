import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Markdown } from "./ui";

type Msg = { role: "user" | "assistant"; content: string };

interface TutorApi {
  setContext: (ctx: Record<string, unknown> | null) => void;
  ask: (question: string, ctx?: Record<string, unknown>) => void;
  open: () => void;
}

const TutorCtx = createContext<TutorApi>({ setContext: () => {}, ask: () => {}, open: () => {} });
export const useTutor = () => useContext(TutorCtx);

/** Registers the current exercise as tutor context while the calling component is mounted. */
export function useTutorContext(ctx: Record<string, unknown> | null, deps: unknown[]) {
  const { setContext } = useTutor();
  useEffect(() => {
    setContext(ctx);
    return () => setContext(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

const QUICK = [
  "Vì sao đáp án của tôi sai?",
  "Giải thích câu này bằng tiếng Việt",
  "Cho tôi 3 câu hỏi tương tự",
  "Làm sao để tránh lỗi này lần sau?",
];

export function TutorProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [ctx, setCtx] = useState<Record<string, unknown> | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ctxKey = useRef<string>("");
  const pendingCtx = useRef<Record<string, unknown> | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  const setContext = useCallback((c: Record<string, unknown> | null) => {
    setCtx(c);
    const key = JSON.stringify(c ?? {});
    // A new exercise starts a new conversation so the context block stays accurate.
    if (key !== ctxKey.current && c) { ctxKey.current = key; setMessages([]); }
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = useCallback(async (text: string, override?: Record<string, unknown>) => {
    if (!text.trim() || busy) return;
    const context = override ?? pendingCtx.current ?? ctx ?? { page: window.location.pathname };
    pendingCtx.current = null;
    const history: Msg[] = [...(override ? [] : messages), { role: "user", content: text.trim() }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/tutor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ context, messages: history }) });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let acc = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const ev of events) {
          const type = ev.match(/^event: (.*)$/m)?.[1];
          const data = ev.match(/^data: (.*)$/m)?.[1];
          if (!type || data === undefined) continue;
          if (type === "delta") acc += JSON.parse(data);
          if (type === "error") acc += `\n\n**Lỗi:** ${JSON.parse(data)}`;
          setMessages([...history, { role: "assistant", content: acc }]);
        }
      }
    } catch (e) {
      setMessages([...history, { role: "assistant", content: `**Lỗi:** ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }, [busy, ctx, messages]);

  const ask = useCallback((q: string, c?: Record<string, unknown>) => {
    setOpen(true);
    if (c) { ctxKey.current = JSON.stringify(c); setCtx(c); }
    void send(q, c);
  }, [send]);

  return (
    <TutorCtx.Provider value={{ setContext, ask, open: () => setOpen(true) }}>
      {children}
      <button className="tutor-fab" onClick={() => setOpen((o) => !o)} title="AI Tutor">💬 Tutor</button>
      {isOpen && (
        <aside className="tutor-drawer">
          <header className="tutor-head">
            <div>
              <strong>AI Tutor</strong>
              <div className="muted small">{ctx ? `Ngữ cảnh: ${String(ctx.exercise ?? ctx.page ?? "bài hiện tại")}` : "Hỏi bất kỳ điều gì về CELPIP"}</div>
            </div>
            <div className="row gap-s">
              <button className="btn small ghost" onClick={() => setMessages([])}>Mới</button>
              <button className="btn small ghost" onClick={() => setOpen(false)}>✕</button>
            </div>
          </header>
          <div className="tutor-body">
            {messages.length === 0 && (
              <div className="muted small">
                Hỏi bằng tiếng Việt hoặc tiếng Anh. Ví dụ: “Why is answer B incorrect?”, “Khác nhau giữa although và despite?”
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>
                {m.role === "assistant" ? (m.content ? <Markdown text={m.content} /> : <span className="spinner" />) : m.content}
              </div>
            ))}
            <div ref={bottom} />
          </div>
          <div className="tutor-quick">
            {QUICK.map((q) => <button key={q} className="chip" disabled={busy} onClick={() => send(q)}>{q}</button>)}
          </div>
          <form className="tutor-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder="Nhập câu hỏi… (Enter để gửi)"
              rows={2}
            />
            <button className="btn primary" disabled={busy || !input.trim()}>Gửi</button>
          </form>
        </aside>
      )}
    </TutorCtx.Provider>
  );
}
