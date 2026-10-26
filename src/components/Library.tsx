import { Icon } from "./Icon";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Mode } from "../../shared/types";
import { CATEGORIES, taskName, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading } from "./ui";

export interface CandidateRow {
  id: string; taskType: string; setType: string; title: string; topic: string; difficulty: number; estimatedMinutes: number;
  questions: number; focusShare: number; attempts: number; lastAttemptAt: string | null; lastScore: string | null;
  audio: "ready" | "pending" | "browser-voice" | null;
}

export interface Picked<T> { item: T; reason: string | null; repeated: boolean; browserVoice: boolean; mode: Mode }

/**
 * Loads exercises from the prebuilt library (no AI). Handles planner deep links:
 * ?task=R2 · ?mode=drill&focus=inference · ?mode=weekly&task=R4 · ?id=r1-full-01
 */
export function useLibraryPick<T extends { id: string }>(skill: Skill) {
  const [params, setParams] = useSearchParams();
  const [picked, setPicked] = useState<Picked<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = useCallback(async (opts: { mode?: Mode; taskType?: string; focus?: string; topic?: string; status?: string } = {}) => {
    setBusy(true); setError(null);
    try {
      const mode = opts.mode ?? "learn";
      const r = await post<{ item: T; reason: string; repeated: boolean; browserVoice: boolean }>("/api/practice/next", { skill, ...opts, mode });
      setPicked({ ...r, mode });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [skill]);

  const open = useCallback(async (id: string, mode: Mode = "learn") => {
    setBusy(true); setError(null);
    try {
      const item = await api<T & { audio?: { ready: boolean } }>(`/api/content/${id}`);
      const settings = await api<{ allowBrowserVoice: boolean }>("/api/settings");
      setPicked({ item, reason: null, repeated: false, browserVoice: Boolean(item.audio && !item.audio.ready && settings.allowBrowserVoice), mode });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  const started = useRef("");
  useEffect(() => {
    const key = params.toString();
    if (!key || started.current === key) return;
    started.current = key;
    const id = params.get("id");
    if (id) void open(id, (params.get("mode") as Mode) || "learn");
    else void next({ mode: (params.get("mode") as Mode) || "learn", taskType: params.get("task") ?? undefined, focus: params.get("focus") ?? undefined });
  }, [params, next, open]);

  const exit = () => { setPicked(null); setParams({}); started.current = ""; };
  return { picked, busy, error, next, open, exit };
}

export function PickReason({ reason, repeated, browserVoice }: { reason: string | null; repeated: boolean; browserVoice?: boolean }) {
  if (!reason && !browserVoice) return null;
  return (
    <div className={`pick-reason ${repeated ? "repeat" : ""}`}>
      {reason && <><Icon name="target" /> Vì sao chọn bài này: {reason}</>}
      {browserVoice && <div className="small">Bài này chưa có audio dựng sẵn — đang dùng <strong>giọng đọc trình duyệt</strong> theo lựa chọn của bạn trong Cài đặt (chất lượng thấp hơn bài thi thật).</div>}
    </div>
  );
}

/** Filterable list of library items with history; picking starts the exercise instantly. */
export function LibraryBrowser({ skill, tasks, onOpen, mode = "learn" }: { skill: Skill; tasks: string[]; onOpen: (id: string) => void; mode?: Mode }) {
  const [rows, setRows] = useState<CandidateRow[] | null>(null);
  const [topics, setTopics] = useState<Record<string, string>>({});
  const [f, setF] = useState({ taskType: "", difficulty: "", topic: "", status: "any", focus: "" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams({ mode: f.focus ? "drill" : mode, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
    api<{ rows: CandidateRow[]; topics: Record<string, string> }>(`/api/library/${skill}?${q}`)
      .then((r) => { setRows(r.rows); setTopics(r.topics); })
      .catch((e) => setError(e.message));
  }, [skill, mode, f]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const objective = skill === "reading" || skill === "listening";

  return (
    <Card title="Thư viện bài luyện" actions={
      <div className="row gap-s wrap">
        <select value={f.taskType} onChange={set("taskType")}><option value="">Mọi dạng</option>{tasks.map((t) => <option key={t} value={t}>{t} · {taskName(t)}</option>)}</select>
        <select value={f.difficulty} onChange={set("difficulty")}><option value="">Mọi độ khó</option>{[5, 6, 7, 8, 9, 10].map((d) => <option key={d} value={d}>Độ khó {d}</option>)}</select>
        <select value={f.topic} onChange={set("topic")}><option value="">Mọi chủ đề</option>{Object.entries(topics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select value={f.status} onChange={set("status")}><option value="any">Tất cả</option><option value="new">Chưa làm</option><option value="done">Đã làm</option></select>
        {objective && <select value={f.focus} onChange={set("focus")}><option value="">Không lọc điểm yếu</option>{Object.entries(CATEGORIES[skill]).filter(([k]) => k !== "time_management").map(([k, v]) => <option key={k} value={k}>Drill: {v}</option>)}</select>}
      </div>
    }>
      <ErrorBox error={error} />
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>Không có bài nào khớp bộ lọc.</Empty> : (
        <table className="table">
          <thead><tr><th>Dạng</th><th>Loại</th><th>Tiêu đề</th><th>Chủ đề</th><th>Độ khó</th>{objective && <th>Câu</th>}{f.focus && <th>% trọng tâm</th>}<th>Lịch sử</th>{skill === "listening" && <th>Audio</th>}<th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.taskType}</td>
                <td><Badge tone={r.setType === "drill" ? "info" : "neutral"}>{r.setType === "full" ? "part đầy đủ" : r.setType === "drill" ? "drill" : r.setType}</Badge></td>
                <td className="ellipsis" title={r.title}>{r.title}</td>
                <td className="small">{topics[r.topic] ?? r.topic}</td>
                <td>{r.difficulty}</td>
                {objective && <td>{r.questions}</td>}
                {f.focus && <td>{Math.round(r.focusShare * 100)}%</td>}
                <td className="small">{r.attempts ? `${r.attempts}× · ${r.lastScore}` : <Badge tone="good">mới</Badge>}</td>
                {skill === "listening" && <td>{r.audio === "ready" ? <Badge tone="good">sẵn sàng</Badge> : r.audio === "browser-voice" ? <Badge tone="warn">giọng trình duyệt</Badge> : <Badge tone="bad">chờ audio</Badge>}</td>}
                <td><button className="btn small" disabled={r.audio === "pending"} onClick={() => onOpen(r.id)}>Làm</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
