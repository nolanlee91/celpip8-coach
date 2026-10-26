import { Icon } from "../components/Icon";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { CategoryStat, McqQuestion, MistakeRecord, SkillSummary } from "../../shared/types";
import { CATEGORIES, SKILL_LABEL, SKILLS, TRAPS, taskName, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, Markdown, Segmented } from "../components/ui";
import { Heatmap } from "./Dashboard";
import { useTutor } from "../components/Tutor";

type Row = MistakeRecord & { original: McqQuestion | null; contentTitle: string };

export function MistakesPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"review" | "list" | "profile">(params.get("review") ? "review" : "list");
  return (
    <div className="page">
      <h1>Sổ lỗi & phân tích điểm yếu</h1>
      <p className="muted">Mỗi câu sai/điểm yếu trở thành một thẻ lỗi có lịch ôn lặp lại ngắt quãng. Thẻ được đánh dấu “đã khắc phục” sau khi bạn làm đúng nhiều lần với khoảng cách ≥ 2 tuần.</p>
      <Segmented value={tab} onChange={setTab} options={[
        { value: "review", label: "Ôn thẻ đến hạn" }, { value: "list", label: "Tất cả lỗi" }, { value: "profile", label: "Hồ sơ điểm yếu" },
      ]} />
      {tab === "review" && <ReviewSession />}
      {tab === "list" && <MistakeList />}
      {tab === "profile" && <Profile />}
    </div>
  );
}

function ReviewSession() {
  const [queue, setQueue] = useState<Row[] | null>(null);
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [stats, setStats] = useState({ right: 0, wrong: 0 });
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const tutor = useTutor();

  useEffect(() => { api<Row[]>("/api/mistakes?status=due").then(setQueue).catch((e) => setError(e.message)); }, []);

  if (error) return <ErrorBox error={error} />;
  if (!queue) return <Loading />;
  if (queue.length === 0) return <Empty>Không có thẻ lỗi nào đến hạn. Quay lại vào ngày mai, hoặc làm thêm bài luyện tập.</Empty>;
  if (i >= queue.length) return (
    <Card title="Hoàn thành phiên ôn">
      <p>Đúng {stats.right} · Sai {stats.wrong}. Thẻ sai sẽ quay lại vào ngày mai; thẻ đúng được giãn khoảng cách.</p>
      <Link to="/" className="btn primary">Về Dashboard</Link>
    </Card>
  );

  const m = queue[i];
  const objective = Boolean(m.original);
  const grade = async (correct: boolean) => {
    await post(`/api/mistakes/${m.id}/review`, { correct, seconds: (Date.now() - shownAt.current) / 1000 });
    setStats((s) => ({ right: s.right + (correct ? 1 : 0), wrong: s.wrong + (correct ? 0 : 1) }));
    setI(i + 1); setPicked(null); setRevealed(false); shownAt.current = Date.now();
  };

  return (
    <Card title={`Thẻ ${i + 1}/${queue.length}`} actions={<span className="row gap-s"><Badge>{SKILL_LABEL[m.skill]}</Badge><Badge tone="info">{CATEGORIES[m.skill][m.category] ?? m.category}</Badge>{m.repeatCount > 1 && <Badge tone="warn">lặp {m.repeatCount}×</Badge>}</span>}>
      <p className="muted small">{taskName(m.taskType)} · {m.contentTitle}</p>
      {objective ? (
        <>
          <p><strong>{m.original!.prompt}</strong></p>
          <div className="options">
            {m.original!.options.map((o, k) => (
              <label key={k} className={`option ${picked === k ? "chosen" : ""} ${revealed && k === m.original!.answerIndex ? "answer" : ""} ${revealed && picked === k && k !== m.original!.answerIndex ? "wrong" : ""}`}>
                <input type="radio" disabled={revealed} checked={picked === k} onChange={() => setPicked(k)} />
                <span className="opt-letter">{"ABCDE"[k]}</span><span>{o.text}{revealed && <span className="why">{o.whyVi}</span>}</span>
              </label>
            ))}
          </div>
          {m.skill === "reading" || m.skill === "listening" ? <p className="muted tiny">Bằng chứng trong bài sẽ hiện sau khi trả lời.</p> : null}
          {!revealed ? (
            <button className="btn primary" disabled={picked === null} onClick={() => setRevealed(true)}>Kiểm tra</button>
          ) : (
            <>
              <blockquote>“{m.original!.evidence}”</blockquote>
              <Markdown text={m.explanation} />
              <div className="row gap-s">
                <button className="btn primary" onClick={() => grade(picked === m.original!.answerIndex)}>{picked === m.original!.answerIndex ? "✓ Đúng — tiếp" : "✗ Sai — tiếp"}</button>
                <button className="btn ghost" onClick={() => tutor.ask("Giải thích lại giúp tôi lỗi này và cách tránh lần sau.", { exercise: "Mistake review", ...m, original: undefined, options: m.original!.options.map((o) => o.text) })}><Icon name="message-circle" /> Hỏi tutor</button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <p className="muted small">Câu bạn đã viết/nói:</p>
          <p className="original">✗ {m.learnerResponse}</p>
          <p>Hãy tự sửa lại trong đầu (hoặc nói to), rồi bấm “Xem cách sửa”.</p>
          {!revealed ? <button className="btn primary" onClick={() => setRevealed(true)}>Xem cách sửa</button> : (
            <>
              <p className="improved">✓ {m.correctAnswer}</p>
              <Markdown text={m.explanation} />
              <div className="row gap-s">
                <button className="btn primary" onClick={() => grade(true)}>Mình đã sửa đúng</button>
                <button className="btn" onClick={() => grade(false)}>Chưa đúng</button>
              </div>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function MistakeList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skill, setSkill] = useState<Skill | "all">("all");
  const [status, setStatus] = useState<"open" | "all">("open");
  const [open, setOpen] = useState<string | null>(null);

  const load = () => api<Row[]>(`/api/mistakes?status=${status}`).then(setRows);
  useEffect(() => { void load(); }, [status]);

  const filtered = useMemo(() => (rows ?? []).filter((r) => skill === "all" || r.skill === skill), [rows, skill]);
  if (!rows) return <Loading />;

  return (
    <Card title={`${filtered.length} thẻ lỗi`} actions={
      <>
        <select value={skill} onChange={(e) => setSkill(e.target.value as Skill | "all")}>
          <option value="all">Mọi kỹ năng</option>{SKILLS.map((s) => <option key={s} value={s}>{SKILL_LABEL[s]}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as "open" | "all")}>
          <option value="open">Chưa khắc phục</option><option value="all">Tất cả</option>
        </select>
      </>
    }>
      {filtered.length === 0 ? <Empty>Chưa có lỗi nào.</Empty> : (
        <table className="table">
          <thead><tr><th>Kỹ năng</th><th>Loại lỗi</th><th>Câu hỏi</th><th>Độ khó</th><th>Ưu tiên</th><th>Lặp</th><th>Ôn tiếp</th><th /></tr></thead>
          <tbody>
            {filtered.map((m) => (
              <Fragment key={m.id}>
                <tr className="clickable" onClick={() => setOpen(open === m.id ? null : m.id)}>
                  <td>{SKILL_LABEL[m.skill]}</td>
                  <td><Badge tone="info">{CATEGORIES[m.skill][m.category] ?? m.category}</Badge>{m.trap && m.trap !== "none" && <div className="tiny muted">{TRAPS[m.trap]}</div>}</td>
                  <td className="ellipsis">{m.question}</td>
                  <td>{m.difficulty}</td>
                  <td>{"★".repeat(m.priority)}</td>
                  <td>{m.repeatCount}</td>
                  <td>{m.resolved ? <Badge tone="good">Đã khắc phục</Badge> : m.srs.due}</td>
                  <td>{open === m.id ? "▲" : "▼"}</td>
                </tr>
                {open === m.id && (
                  <tr className="detail-row">
                    <td colSpan={8}>
                      <div className="grid-2">
                        <div><p className="muted small">Bạn trả lời</p><p className="original">{m.learnerResponse}</p></div>
                        <div><p className="muted small">Đáp án / cách sửa</p><p className="improved">{m.correctAnswer}</p></div>
                      </div>
                      <Markdown text={m.explanation} />
                      {m.vocabulary.length > 0 && <p className="small">Từ vựng liên quan: {m.vocabulary.join(", ")}</p>}
                      <button className="btn small" onClick={async () => { await post(`/api/mistakes/${m.id}/resolve`, { resolved: !m.resolved }); void load(); }}>
                        {m.resolved ? "Mở lại thẻ" : "Đánh dấu đã khắc phục"}
                      </button>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function Profile() {
  const [data, setData] = useState<{ stats: CategoryStat[]; profile: string; skills: SkillSummary[] } | null>(null);
  useEffect(() => { api<typeof data>("/api/weakness").then(setData); }, []);
  if (!data) return <Loading />;
  const insights = data.skills.filter((s) => s.accuracy !== null).flatMap((s) => {
    const worst = data.stats.filter((c) => c.skill === s.skill && c.total >= 3).sort((a, b) => a.accuracy - b.accuracy)[0];
    if (!worst || worst.accuracy >= s.accuracy! - 0.1) return [];
    return [`${SKILL_LABEL[s.skill]}: độ chính xác chung ${Math.round(s.accuracy! * 100)}%, nhưng “${CATEGORIES[s.skill][worst.category]}” chỉ ${Math.round(worst.accuracy * 100)}% (${worst.correct}/${worst.total}).`];
  });
  return (
    <>
      <Card title="Nhận định">
        {insights.length ? <ul>{insights.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="muted">Cần thêm dữ liệu (≥ 3 câu mỗi loại) để đưa ra nhận định.</p>}
        <details><summary className="small muted">Hồ sơ gửi cho AI (dùng để tạo bài & tutor)</summary><pre className="pre">{data.profile}</pre></details>
      </Card>
      <Card title="Bản đồ điểm yếu"><Heatmap stats={data.stats} /></Card>
    </>
  );
}
