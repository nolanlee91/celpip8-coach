import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { NotebookEntry } from "../../shared/types";
import { api, put } from "../api";
import { Icon } from "./Icon";

// The learner's notebook ("quyển vở"): one page of notes per section, saved on the server
// (progress.json) and kept as a local draft so nothing typed is lost when offline.

type Book = Record<string, NotebookEntry>;
let book: Book | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const DRAFT = (id: string) => `notebook-draft:${id}`;
const readDraft = (id: string): string | null => { try { return localStorage.getItem(DRAFT(id)); } catch { return null; } };
const writeDraft = (id: string, text: string | null) => {
  try { if (text === null) localStorage.removeItem(DRAFT(id)); else localStorage.setItem(DRAFT(id), text); } catch { /* storage unavailable */ }
};

export function loadNotebook(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = api<Book>("/api/notebook").then((b) => { book = b; emit(); }).catch(() => { book = book ?? {}; emit(); });
  return loading;
}

export function useNotebook(): Book | null {
  const b = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => book);
  useEffect(() => { void loadNotebook(); }, []);
  return b;
}

export async function saveNote(id: string, patch: { text?: string; checks?: number[]; title?: string }): Promise<NotebookEntry> {
  const saved = await put<NotebookEntry>(`/api/notebook/${encodeURIComponent(id)}`, patch);
  book = { ...(book ?? {}) };
  if (!saved.text.trim() && saved.checks.length === 0) delete book[id];
  else book[id] = saved;
  emit();
  return saved;
}

/** Ticked checklist lines of one section, saved immediately. */
export function useChecks(id: string, title: string) {
  const b = useNotebook();
  const checks = b?.[id]?.checks ?? [];
  const toggle = (i: number) => {
    const next = checks.includes(i) ? checks.filter((x) => x !== i) : [...checks, i];
    void saveNote(id, { checks: next, title });
  };
  return { checks, toggle, ready: b !== null };
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "offline";

const fmtTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });

/** A lined notebook page with autosave. */
export function NotePad({ id, title, heading = "Vở ghi", placeholder, rows = 8 }: { id: string; title: string; heading?: string; placeholder?: string; rows?: number }) {
  const b = useNotebook();
  const entry = b?.[id];
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("idle");
  const timer = useRef<number | null>(null);
  const latest = useRef("");

  const [loadedId, setLoadedId] = useState<string | null>(null);

  // Load once per section. A local draft that differs from the server copy wins (it was typed while offline).
  useEffect(() => {
    if (b === null || loadedId === id) return;
    const draft = readDraft(id);
    const initial = draft ?? entry?.text ?? "";
    setLoadedId(id);
    setText(initial);
    latest.current = initial;
    setState("idle");
    if (draft !== null && draft !== (entry?.text ?? "")) { setState("dirty"); schedule(draft); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, id, loadedId]);

  const flush = async () => {
    const value = latest.current;
    setState("saving");
    try {
      await saveNote(id, { text: value, title });
      writeDraft(id, null);
      setState(latest.current === value ? "saved" : "dirty");
    } catch {
      setState("offline");
    }
  };

  function schedule(value: string) {
    latest.current = value;
    writeDraft(id, value);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 900);
  }

  // Save on leave.
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); void flush(); } }, // eslint-disable-line react-hooks/exhaustive-deps
    [id]);

  const status = {
    idle: entry ? `Lưu lần cuối ${fmtTime(entry.updatedAt)}` : "Tự động lưu khi bạn gõ",
    dirty: "Đang gõ…",
    saving: "Đang lưu…",
    saved: "Đã lưu",
    offline: "Chưa lưu lên máy chủ. Bản nháp vẫn giữ trên máy này.",
  }[state];

  return (
    <section className="notepad" aria-label={heading}>
      <header className="notepad-head">
        <h3><Icon name="notebook" /> {heading}</h3>
        <span className={`notepad-status ${state === "offline" ? "warn" : ""}`} role="status">{status}</span>
      </header>
      {text === null || loadedId !== id ? <div className="notepad-paper muted">Đang mở vở…</div> : (
        <textarea aria-label="Vở ghi"
          className="notepad-paper"
          rows={rows}
          value={text}
          placeholder={placeholder ?? "Ghi lại điều bạn học được, câu hỏi còn thắc mắc, lỗi đã gặp…"}
          onChange={(e) => { setText(e.target.value); setState("dirty"); schedule(e.target.value); }}
          onBlur={() => { if (timer.current && state === "dirty") { window.clearTimeout(timer.current); timer.current = null; void flush(); } }}
          spellCheck
        />
      )}
      {state === "offline" && <button className="btn small" onClick={() => void flush()}><Icon name="rotate-ccw" /> Thử lưu lại</button>}
    </section>
  );
}
