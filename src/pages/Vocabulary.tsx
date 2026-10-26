import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { VocabItem } from "../../shared/types";
import { api, post } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, Segmented } from "../components/ui";
import { loadVoices, speak } from "../lib/speech";

type V = VocabItem & { due: boolean };
type ReviewMode = "mixed" | "flash" | "mcq" | "fill" | "listen";

const say = async (t: string) => { await loadVoices(); void speak(t, "narrator", { rate: 0.9 }); };
const shuffle = <T,>(a: T[]) => [...a].sort(() => Math.random() - 0.5);

export function VocabularyPage() {
  const [params] = useSearchParams();
  const [items, setItems] = useState<V[] | null>(null);
  const [reviewing, setReviewing] = useState<{ mode: ReviewMode; queue: V[] } | null>(null);
  const [mode, setMode] = useState<ReviewMode>("mixed");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "due" | "new" | "mastered">("all");
  const [newTerm, setNewTerm] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api<V[]>("/api/vocab").then(setItems).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (params.get("review") && items && !reviewing) {
      const due = items.filter((v) => v.due);
      if (due.length) setReviewing({ mode: "mixed", queue: shuffle(due) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered = useMemo(() => (items ?? [])
    .filter((v) => !q || v.term.toLowerCase().includes(q.toLowerCase()) || v.vi.toLowerCase().includes(q.toLowerCase()))
    .filter((v) => filter === "all" || (filter === "due" && v.due) || (filter === "new" && v.reviews === 0) || (filter === "mastered" && v.srs.interval >= 21))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items, q, filter]);

  if (!items) return <div className="page"><Loading /></div>;
  if (reviewing) return <div className="page"><Review pool={items} queue={reviewing.queue} mode={reviewing.mode} onDone={() => { setReviewing(null); void load(); }} /></div>;

  const due = items.filter((v) => v.due);
  const pending = items.filter((v) => !v.enriched).length;

  return (
    <div className="page">
      <h1>📚 Sổ từ vựng thông minh</h1>
      <p className="muted">Tự động thu thập từ câu sai, bài đọc, transcript nghe và phần sửa bài Writing/Speaking. Ôn theo lịch lặp lại ngắt quãng (SM-2).</p>
      <ErrorBox error={error} />
      <div className="grid-2">
        <Card title="Ôn tập">
          <p><strong>{due.length}</strong> từ đến hạn · {items.length} từ tổng · {items.filter((v) => v.srs.interval >= 21).length} đã thuộc</p>
          <Segmented value={mode} onChange={setMode} options={[
            { value: "mixed", label: "Trộn" }, { value: "flash", label: "Flashcard" }, { value: "mcq", label: "Chọn nghĩa" }, { value: "fill", label: "Điền từ" }, { value: "listen", label: "Nghe" },
          ]} />
          <div className="row gap-s" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!due.length} onClick={() => setReviewing({ mode, queue: shuffle(due) })}>Ôn {due.length} từ đến hạn</button>
            <button className="btn" disabled={!items.length} onClick={() => setReviewing({ mode, queue: shuffle(items).slice(0, 20) })}>Ôn thêm 20 từ ngẫu nhiên</button>
          </div>
        </Card>
        <Card title="Thêm từ / cụm từ">
          <form className="row gap-s" onSubmit={async (e) => {
            e.preventDefault();
            if (!newTerm.trim()) return;
            setBusy("add"); setError(null);
            try { await post("/api/vocab", { term: newTerm, source: "manual" }); setNewTerm(""); await load(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
          }}>
            <input value={newTerm} onChange={(e) => setNewTerm(e.target.value)} placeholder="vd: be eligible for" className="grow" />
            <button className="btn primary" disabled={busy === "add"}>{busy === "add" ? "Đang tra…" : "Thêm (AI tra)"}</button>
          </form>
          {pending > 0 && (
            <div className="row gap-s" style={{ marginTop: 10 }}>
              <span className="small muted">{pending} từ chưa có collocation/từ đồng nghĩa.</span>
              <button className="btn small" disabled={busy === "enrich"} onClick={async () => {
                setBusy("enrich");
                try { await post("/api/vocab/enrich"); await load(); } catch (err) { setError((err as Error).message); } finally { setBusy(null); }
              }}>{busy === "enrich" ? "Đang bổ sung…" : "Bổ sung chi tiết bằng AI"}</button>
            </div>
          )}
        </Card>
      </div>

      <Card title={`${filtered.length} từ`} actions={
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm…" />
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">Tất cả</option><option value="due">Đến hạn</option><option value="new">Chưa ôn</option><option value="mastered">Đã thuộc</option>
          </select>
        </>
      }>
        {filtered.length === 0 ? <Empty>Chưa có từ nào. Từ vựng sẽ tự xuất hiện khi bạn làm bài.</Empty> : (
          <div className="vocab-grid">
            {filtered.map((v) => (
              <div key={v.id} className="vocab-card">
                <div className="row between">
                  <strong className="term">{v.term} <button className="icon-btn" onClick={() => say(v.term)} title="Phát âm">🔊</button></strong>
                  {v.due ? <Badge tone="warn">đến hạn</Badge> : v.srs.interval >= 21 ? <Badge tone="good">đã thuộc</Badge> : <Badge>ôn {v.srs.due.slice(5)}</Badge>}
                </div>
                <div>🇻🇳 {v.vi}</div>
                <div className="muted small">{v.definition}</div>
                <div className="small"><em>{v.example}</em> <button className="icon-btn" onClick={() => say(v.example)}>🔊</button></div>
                {v.collocations.length > 0 && <div className="tiny"><strong>Collocations:</strong> {v.collocations.join(" · ")}</div>}
                {v.synonyms.length > 0 && <div className="tiny"><strong>Đồng nghĩa / paraphrase:</strong> {v.synonyms.join(", ")}</div>}
                {v.celpipUsage && <div className="tiny muted">🎯 {v.celpipUsage}</div>}
                <div className="row between tiny muted">
                  <span>{v.source} · {v.reviews ? `${Math.round((v.correctReviews / v.reviews) * 100)}% đúng / ${v.reviews} lượt` : "chưa ôn"}</span>
                  <button className="icon-btn" title="Xóa" onClick={async () => { if (confirm(`Xóa “${v.term}”?`)) { await api(`/api/vocab/${v.id}`, { method: "DELETE" }); void load(); } }}>🗑</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Review({ pool, queue, mode, onDone }: { pool: V[]; queue: V[]; mode: ReviewMode; onDone: () => void }) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [score, setScore] = useState({ right: 0, total: 0 });
  const shownAt = useRef(Date.now());

  const v = queue[i];
  const kind: Exclude<ReviewMode, "mixed"> = useMemo(() => {
    if (!v) return "flash";
    if (mode !== "mixed") return mode;
    const kinds: Exclude<ReviewMode, "mixed">[] = pool.length >= 4 ? ["flash", "mcq", "fill", "listen"] : ["flash", "fill"];
    return kinds[i % kinds.length];
  }, [i, mode, pool.length, v]);

  const choices = useMemo(() => {
    if (!v) return [];
    const others = shuffle(pool.filter((x) => x.id !== v.id)).slice(0, 3);
    return shuffle([v, ...others]);
  }, [v, pool]);

  useEffect(() => { if (v && kind === "listen") void say(v.term); }, [v, kind]);

  if (!v) return (
    <Card title="Hoàn thành!">
      <p>Đúng {score.right}/{score.total}. Lịch ôn tiếp theo đã được cập nhật.</p>
      <button className="btn primary" onClick={onDone}>Quay lại sổ từ vựng</button>
    </Card>
  );

  const blanked = v.example.replace(new RegExp(v.term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "_____");
  const canBlank = blanked !== v.example;

  const grade = async (quality: number) => {
    await post(`/api/vocab/${v.id}/review`, { quality, seconds: (Date.now() - shownAt.current) / 1000 });
    setScore((s) => ({ right: s.right + (quality >= 3 ? 1 : 0), total: s.total + 1 }));
    setI(i + 1); setRevealed(false); setPicked(null); setTyped(""); shownAt.current = Date.now();
  };

  const answerBlock = (
    <div className="flash-back">
      <div className="term">{v.term} <button className="icon-btn" onClick={() => say(v.term)}>🔊</button></div>
      <div>🇻🇳 {v.vi}</div>
      <div className="muted">{v.definition}</div>
      <div><em>{v.example}</em></div>
      {v.collocations.length > 0 && <div className="small">{v.collocations.join(" · ")}</div>}
    </div>
  );

  const correctNow = kind === "mcq" || kind === "listen" ? picked === v.id : kind === "fill" ? typed.trim().toLowerCase() === v.term.toLowerCase() : null;

  return (
    <Card title={`Ôn từ vựng ${i + 1}/${queue.length}`} actions={<><Badge>{{ flash: "Flashcard", mcq: "Chọn nghĩa", fill: "Điền từ", listen: "Nghe nhận diện" }[kind]}</Badge><button className="btn small ghost" onClick={onDone}>Dừng</button></>}>
      <div className="flash">
        {kind === "flash" && (
          <>
            <div className="term big">{v.term} <button className="icon-btn" onClick={() => say(v.term)}>🔊</button></div>
            {!revealed ? <button className="btn primary" onClick={() => setRevealed(true)}>Lật thẻ</button> : (
              <>
                {answerBlock}
                <div className="row gap-s">
                  <button className="btn bad" onClick={() => grade(1)}>Quên</button>
                  <button className="btn" onClick={() => grade(3)}>Khó</button>
                  <button className="btn" onClick={() => grade(4)}>Nhớ</button>
                  <button className="btn good" onClick={() => grade(5)}>Dễ</button>
                </div>
              </>
            )}
          </>
        )}
        {(kind === "mcq" || kind === "listen") && (
          <>
            {kind === "mcq" ? <div className="term big">{v.term}</div> : <button className="btn" onClick={() => say(v.term)}>🔊 Nghe lại</button>}
            <p className="muted">{kind === "mcq" ? "Chọn nghĩa đúng:" : "Bạn vừa nghe từ nào?"}</p>
            <div className="options">
              {choices.map((c) => (
                <label key={c.id} className={`option ${picked === c.id ? "chosen" : ""} ${revealed && c.id === v.id ? "answer" : ""} ${revealed && picked === c.id && c.id !== v.id ? "wrong" : ""}`}>
                  <input type="radio" disabled={revealed} checked={picked === c.id} onChange={() => { setPicked(c.id); setRevealed(true); }} />
                  <span>{kind === "mcq" ? c.vi : c.term}</span>
                </label>
              ))}
            </div>
          </>
        )}
        {kind === "fill" && (
          <>
            <p className="big-text">{canBlank ? blanked : v.definition}</p>
            <p className="muted small">🇻🇳 {v.vi} — gõ từ/cụm từ còn thiếu:</p>
            <form onSubmit={(e) => { e.preventDefault(); setRevealed(true); }} className="row gap-s">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} disabled={revealed} autoFocus className="grow" />
              {!revealed && <button className="btn primary">Kiểm tra</button>}
            </form>
          </>
        )}
        {revealed && kind !== "flash" && (
          <>
            <div className={correctNow ? "ok-msg" : "bad-msg"}>{correctNow ? "✓ Chính xác!" : "✗ Chưa đúng."}</div>
            {answerBlock}
            <button className="btn primary" onClick={() => grade(correctNow ? 4 : 1)}>Tiếp →</button>
          </>
        )}
      </div>
    </Card>
  );
}
