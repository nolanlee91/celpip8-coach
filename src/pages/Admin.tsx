import { Fragment, useCallback, useEffect, useState } from "react";
import type { ValidationIssue } from "../../shared/content";
import { CATEGORIES, LISTENING_PARTS, READING_PARTS, SPEAKING_TASKS, WRITING_TASKS, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Badge, Card, Empty, ErrorBox, Loading, ProgressBar, Segmented } from "../components/ui";

interface LibraryInfo {
  counts: Record<string, Record<string, { active: number; inactive: number }>>;
  totals: { reading: number; listening: number; writing: number; speaking: number; vocabulary: number; mocks: number };
  targets: { reading: number; listening: number; writing: number; speaking: number; vocabulary: number };
  completeSets: { reading: number; listening: number };
  audioReady: number;
  audioPending: number;
  listening: { id: string; title: string; ready: boolean; chunks: number; durationSec: number }[];
  issues: ValidationIssue[];
  loadedAt: string;
  packages: { id: string; title: string; valid: boolean; available: boolean; problems: string[] }[];
}
interface AudioJob { provider?: string; providerReady?: boolean; running: boolean; total: number; done: number; failed: { file: string; error: string }[]; stoppedReason: string | null; current: string | null; finishedAt: string | null }
interface Draft { id: string; status: string; error: string | null; topic: string; difficulty: number; issues: ValidationIssue[]; aiReview: { verdict: string; issues: string[]; wrongKeys: number[]; ambiguousQuestions: number[] } | null; decision: string; imported: boolean }
interface Job { id: string; createdAt: string; skill: string; taskType: string; setType: string; count: number; drafts: Draft[]; usage: { calls: number; totalTokens: number }; running: boolean; lastError: string | null }
interface Usage {
  availability: { configured: boolean; model: string; ttsModel: string; lastSuccessAt: string | null; lastError: { message: string; at: string } | null; rateLimitedUntil: string | null };
  byDay: { day: string; calls: number; failed: number; cached: number; tokens: number }[];
  byKind: { kind: string; calls: number; failed: number; tokens: number }[];
  recent: { at: string; kind: string; model: string; ok: boolean; totalTokens: number; error: string | null }[];
  cacheEntries: number;
  pendingSubmissions: number;
}

const TASKS: Record<Skill, string[]> = {
  reading: READING_PARTS.map((p) => p.id), listening: LISTENING_PARTS.map((p) => p.id),
  writing: WRITING_TASKS.map((t) => t.id), speaking: SPEAKING_TASKS.map((t) => t.id),
};

export function AdminPage() {
  const [tab, setTab] = useState<"library" | "audio" | "generate" | "ai">("library");
  return (
    <div className="page">
      <h1>🛠 Quản trị nội dung</h1>
      <p className="muted">Khu vực dành cho quản trị — không thuộc luồng học. Mọi thao tác dùng AI ở đây đều phải bấm chủ động.</p>
      <Segmented value={tab} onChange={setTab} options={[
        { value: "library", label: "Thư viện" }, { value: "audio", label: "Audio Listening" }, { value: "generate", label: "Sinh nội dung" }, { value: "ai", label: "Sử dụng AI" },
      ]} />
      {tab === "library" && <LibraryTab />}
      {tab === "audio" && <AudioTab />}
      {tab === "generate" && <GenerateTab />}
      {tab === "ai" && <UsageTab />}
    </div>
  );
}

function LibraryTab() {
  const [d, setD] = useState<LibraryInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<LibraryInfo>("/api/admin/library").then(setD).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const errors = d.issues.filter((i) => i.severity === "error");
  const warnings = d.issues.filter((i) => i.severity === "warning");
  const rows: [string, number, number, string?][] = [
    ["Reading (mọi loại set)", d.totals.reading, d.targets.reading, `${d.completeSets.reading} part đầy đủ/mock`],
    ["Listening", d.totals.listening, d.targets.listening, `${d.completeSets.listening} part đầy đủ/mock · ${d.audioReady} có audio`],
    ["Writing", d.totals.writing, d.targets.writing],
    ["Speaking", d.totals.speaking, d.targets.speaking],
    ["Từ vựng", d.totals.vocabulary, d.targets.vocabulary],
  ];
  return (
    <>
      <Card title="Tiến độ thư viện (chỉ tính nội dung đã duyệt + hợp lệ)" actions={<button className="btn small" onClick={async () => { await post("/api/admin/library/reload"); void load(); }}>↻ Nạp lại từ đĩa</button>}>
        {rows.map(([label, n, target, note]) => (
          <div key={label} className="bar-row fixed">
            <span>{label}</span>
            <ProgressBar value={n} max={target} />
            <span className="small">{n}/{target}{note ? <span className="muted"> · {note}</span> : null}</span>
          </div>
        ))}
        <p className="muted tiny">Mục tiêu dài hạn 200/150/100/160/2000 — mở rộng dần theo lô nhỏ đã kiểm duyệt. Nạp lúc {new Date(d.loadedAt).toLocaleString()}.</p>
      </Card>
      <Card title="Số lượng theo dạng bài">
        <table className="table">
          <thead><tr><th>Dạng</th><th>full</th><th>drill</th><th>mock</th><th>practice</th><th>Không hoạt động</th></tr></thead>
          <tbody>
            {Object.entries(d.counts).sort().map(([t, c]) => (
              <tr key={t}>
                <td>{t}</td>
                {["full", "drill", "mock", "practice"].map((k) => <td key={k}>{c[k]?.active ?? "–"}</td>)}
                <td>{Object.values(c).reduce((n, x) => n + x.inactive, 0) || "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted tiny">“Không hoạt động” = bản nháp chưa duyệt hoặc còn lỗi kiểm tra — không bao giờ được dùng khi luyện.</p>
      </Card>
      <Card title="Gói đề thi thử">
        {d.packages.length === 0 ? <Empty>Chưa có gói đề.</Empty> : d.packages.map((p) => (
          <div key={p.id} className="row between" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
            <span><strong>{p.title}</strong> <span className="muted tiny">{p.id}</span></span>
            <span>{p.available ? <Badge tone="good">sẵn sàng</Badge> : <Badge tone="bad">chưa sẵn sàng</Badge>} <span className="tiny muted">{p.problems.join(" ")}</span></span>
          </div>
        ))}
      </Card>
      <Card title={`Kiểm tra tự động: ${errors.length} lỗi · ${warnings.length} cảnh báo`}>
        <p className="muted small">Kiểm tra cấu trúc: đủ trường, ID duy nhất, đúng số đáp án, đáp án hợp lệ, trích dẫn bằng chứng có thật trong bài, đúng định dạng part, không trùng lặp. Qua kiểm tra ≠ đảm bảo chất lượng đề thi.</p>
        {d.issues.length === 0 ? <p className="ok-msg">Không có vấn đề.</p> : (
          <table className="table">
            <tbody>{[...errors, ...warnings].slice(0, 200).map((i, k) => (
              <tr key={k}><td>{i.severity === "error" ? <Badge tone="bad">lỗi</Badge> : <Badge tone="warn">cảnh báo</Badge>}</td><td className="small">{i.id}</td><td className="small">{i.message}</td><td className="tiny muted">{i.file}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function AudioTab() {
  const [d, setD] = useState<LibraryInfo | null>(null);
  const [job, setJob] = useState<AudioJob | null>(null);
  const [limit, setLimit] = useState(10);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<LibraryInfo>("/api/admin/library").then(setD).catch((e) => setError(e.message));
    api<AudioJob>("/api/admin/audio").then(setJob).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!job?.running) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [job?.running, load]);
  if (!d) return <Loading />;
  return (
    <>
      <Card title={`Audio Listening: ${d.audioReady} sẵn sàng · ${d.audioPending} chờ tạo`}>
        <p className="small muted">Audio được tạo MỘT lần (nguồn: <strong>{job?.provider === "gemini" ? "Gemini TTS — cần GEMINI_API_KEY" : "Edge TTS — giọng neural en-CA, không cần API key"}</strong>), lưu vào thư mục dữ liệu bền vững (<code>$DATA_DIR/audio-assets</code>, không nằm trong git) và dùng lại mãi mãi. Có thể dừng và chạy tiếp — phần đã tạo không bị tạo lại. Edge TTS là dịch vụ không chính thức của Microsoft: có thể thay đổi hoặc ngừng bất cứ lúc nào, nên hãy tạo audio sớm và sao lưu thư mục này.</p>
        <div className="row gap-s wrap">
          <label className="row gap-s small">Số đoạn tối đa lô này <input type="number" min={1} max={200} value={limit} onChange={(e) => setLimit(Number(e.target.value))} style={{ width: 80 }} /></label>
          <button className="btn primary" disabled={job?.running} onClick={async () => { setError(null); try { await post("/api/admin/audio/generate", { limit }); setTimeout(load, 800); } catch (e) { setError((e as Error).message); } }}>▶ Tạo audio còn thiếu</button>
          {job?.running && <button className="btn" onClick={() => post("/api/admin/audio/stop").then(load)}>⏹ Dừng</button>}
        </div>
        <ErrorBox error={error} />
        {job && (job.running || job.finishedAt) && (
          <div style={{ marginTop: 10 }}>
            <ProgressBar value={job.done} max={job.total || 1} />
            <p className="small">{job.running ? `Đang tạo: ${job.current ?? "…"}` : "Lô gần nhất đã kết thúc"} — {job.done}/{job.total} đoạn{job.failed.length ? `, ${job.failed.length} lỗi` : ""}{job.stoppedReason ? ` · dừng: ${job.stoppedReason}` : ""}</p>
            {job.failed.slice(-5).map((f) => <div key={f.file} className="tiny muted">✗ {f.file}: {f.error}</div>)}
          </div>
        )}
      </Card>
      <Card title="Từng bài Listening">
        <table className="table">
          <thead><tr><th>Bài</th><th>Đoạn</th><th>Thời lượng</th><th>Audio</th></tr></thead>
          <tbody>{d.listening.map((l) => (
            <tr key={l.id}><td>{l.id}<div className="tiny muted">{l.title}</div></td><td>{l.chunks}</td><td>{l.ready ? `${Math.round(l.durationSec)}s` : "–"}</td><td>{l.ready ? <Badge tone="good">sẵn sàng</Badge> : <Badge tone="bad">chờ tạo</Badge>}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}

function GenerateTab() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [form, setForm] = useState({ skill: "reading" as Skill | "vocabulary", taskType: "R4", setType: "full", count: 2, topic: "", focus: "", difficulty: "", aiReview: true });
  const [open, setOpen] = useState<{ job: string; item: string; data: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<Job[]>("/api/admin/jobs").then(setJobs).catch((e) => setError(e.message)), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!jobs?.some((j) => j.running)) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [jobs, load]);

  const objective = form.skill === "reading" || form.skill === "listening";
  const create = async () => {
    setError(null);
    try {
      await post("/api/admin/jobs", {
        skill: form.skill, taskType: form.skill === "vocabulary" ? undefined : form.taskType, setType: form.skill === "vocabulary" ? undefined : form.setType,
        count: form.count, topic: form.topic || null, focus: form.focus || null, difficulty: form.difficulty ? Number(form.difficulty) : null, aiReview: form.aiReview,
      });
      setTimeout(() => void load(), 500);
    } catch (e) { setError((e as Error).message); }
  };
  const decide = async (job: string, item: string, decision: string) => {
    try { await post(`/api/admin/jobs/${job}/items/${item}/decision`, { decision }); void load(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      <Card title="Tạo lô nội dung mới (cần Gemini)">
        <p className="small muted">Quy trình: sinh từng mục → kiểm tra tự động → AI rà soát độc lập (lượt gọi riêng) → <strong>bạn duyệt</strong> → nhập vào thư viện. Lô nhỏ (≤ 25). Bản nháp lưu ở <code>$DATA_DIR/content-drafts</code>; job bị gián đoạn có thể chạy tiếp.</p>
        <div className="form-grid compact">
          <label className="field">Kỹ năng
            <select value={form.skill} onChange={(e) => { const skill = e.target.value as Skill | "vocabulary"; setForm({ ...form, skill, taskType: skill === "vocabulary" ? "" : TASKS[skill][0], setType: skill === "reading" || skill === "listening" ? "full" : "practice", focus: "" }); }}>
              <option value="reading">Reading</option><option value="listening">Listening</option><option value="writing">Writing</option><option value="speaking">Speaking</option><option value="vocabulary">Từ vựng</option>
            </select>
          </label>
          {form.skill !== "vocabulary" && (
            <>
              <label className="field">Dạng bài<select value={form.taskType} onChange={(e) => setForm({ ...form, taskType: e.target.value })}>{TASKS[form.skill as Skill].map((t) => <option key={t}>{t}</option>)}</select></label>
              <label className="field">Loại set<select value={form.setType} onChange={(e) => setForm({ ...form, setType: e.target.value })}>{(objective ? ["full", "drill", "mock"] : ["practice", "mock"]).map((t) => <option key={t}>{t}</option>)}</select></label>
            </>
          )}
          <label className="field">{form.skill === "vocabulary" ? "Số mục từ" : "Số bài"}<input type="number" min={1} max={25} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} /></label>
          <label className="field">Chủ đề (trống = xoay vòng)<select value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}><option value="">Tự động</option>{["workplace", "housing", "transportation", "customer-service", "community-services", "education", "healthcare", "shopping", "banking", "social", "environment", "recreation", "government"].map((t) => <option key={t}>{t}</option>)}</select></label>
          {objective && form.setType === "drill" && <label className="field">Trọng tâm drill<select value={form.focus} onChange={(e) => setForm({ ...form, focus: e.target.value })}><option value="">—</option>{Object.keys(CATEGORIES[form.skill as Skill]).filter((c) => c !== "time_management").map((c) => <option key={c}>{c}</option>)}</select></label>}
          {form.skill !== "vocabulary" && <label className="field">Độ khó (trống = hiện tại)<input type="number" min={5} max={10} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} /></label>}
        </div>
        <label className="row gap-s small"><input type="checkbox" checked={form.aiReview} onChange={(e) => setForm({ ...form, aiReview: e.target.checked })} />AI rà soát độc lập sau khi sinh (thêm 1 lượt gọi/bài)</label>
        <div className="row gap-s" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={create}>Tạo job</button>
          <button className="btn" onClick={async () => { try { const r = await post<{ imported: string[]; skipped: string[] }>("/api/admin/import", {}); setMsg(`Đã nhập ${r.imported.length} mục vào thư viện${r.skipped.length ? `, bỏ qua ${r.skipped.length}` : ""}.`); void load(); } catch (e) { setError((e as Error).message); } }}>⬇ Nhập mọi bản đã duyệt vào thư viện</button>
        </div>
        <ErrorBox error={error} />
        {msg && <p className="ok-msg small">{msg}</p>}
      </Card>
      {!jobs ? <Loading /> : jobs.length === 0 ? <Empty>Chưa có job nào.</Empty> : jobs.map((j) => (
        <Card key={j.id} title={`${j.skill}/${j.taskType || "-"} · ${j.setType} × ${j.count}`} actions={
          <span className="row gap-s">
            {j.running ? <Badge tone="info">đang chạy</Badge> : j.drafts.some((d) => d.status !== "generated") && <button className="btn small" onClick={() => post(`/api/admin/jobs/${j.id}/run`).then(() => setTimeout(() => void load(), 500))}>▶ Chạy tiếp</button>}
            <span className="tiny muted">{j.usage.calls} lượt · {j.usage.totalTokens.toLocaleString()} token</span>
          </span>
        }>
          {j.lastError && <ErrorBox error={j.lastError} />}
          <table className="table">
            <thead><tr><th>Bản nháp</th><th>Trạng thái</th><th>Kiểm tra</th><th>AI rà soát</th><th>Quyết định</th><th /></tr></thead>
            <tbody>
              {j.drafts.map((d) => {
                const errs = d.issues.filter((i) => i.severity === "error");
                return (
                  <Fragment key={d.id}>
                    <tr>
                      <td className="small">{d.id}<div className="tiny muted">{d.topic} · độ khó {d.difficulty || "–"}</div></td>
                      <td>{d.status === "generated" ? <Badge tone="good">đã sinh</Badge> : d.status === "failed" ? <Badge tone="bad">lỗi</Badge> : <Badge>chờ</Badge>}{d.error && <div className="tiny muted">{d.error}</div>}</td>
                      <td>{d.status === "generated" ? (errs.length ? <Badge tone="bad">{errs.length} lỗi</Badge> : <Badge tone="good">hợp lệ</Badge>) : "–"}</td>
                      <td>{d.aiReview ? <Badge tone={d.aiReview.verdict === "pass" ? "good" : "bad"}>{d.aiReview.verdict}</Badge> : "–"}</td>
                      <td>{d.imported ? <Badge tone="good">đã nhập</Badge> : d.decision === "pending" ? "chờ duyệt" : d.decision}</td>
                      <td className="row gap-s">
                        {d.status === "generated" && <button className="btn small ghost" onClick={async () => setOpen(open?.item === d.id ? null : { job: j.id, item: d.id, data: await api(`/api/admin/jobs/${j.id}/items/${d.id}`) })}>Xem</button>}
                        {d.status === "generated" && !d.imported && <>
                          <button className="btn small" disabled={errs.length > 0} onClick={() => decide(j.id, d.id, "approved")}>Duyệt</button>
                          <button className="btn small bad" onClick={() => decide(j.id, d.id, "rejected")}>Loại</button>
                        </>}
                      </td>
                    </tr>
                    {open?.item === d.id && (
                      <tr className="detail-row"><td colSpan={6}>
                        {d.issues.map((i, k) => <div key={k} className="small">{i.severity === "error" ? "✗" : "!"} {i.message}</div>)}
                        {d.aiReview?.issues.map((x, k) => <div key={k} className="small">🤖 {x}</div>)}
                        <pre className="pre" style={{ maxHeight: 420, overflow: "auto" }}>{JSON.stringify(open.data, null, 2)}</pre>
                      </td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </>
  );
}

function UsageTab() {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => { api<Usage>("/api/ai/usage").then(setU).catch(() => {}); }, []);
  if (!u) return <Loading />;
  const a = u.availability;
  return (
    <>
      <Card title="Trạng thái AI">
        <p>{a.configured ? "✅ Đã cấu hình" : "❌ Chưa cấu hình GEMINI_API_KEY"} · model <code>{a.model}</code> · TTS <code>{a.ttsModel}</code></p>
        <p className="small">Lần thành công gần nhất: {a.lastSuccessAt ? new Date(a.lastSuccessAt).toLocaleString() : "–"}{a.rateLimitedUntil && Date.parse(a.rateLimitedUntil) > Date.now() ? ` · ⚠︎ đang bị giới hạn tốc độ đến ${new Date(a.rateLimitedUntil).toLocaleTimeString()}` : ""}</p>
        {a.lastError && <p className="small">Lỗi gần nhất ({new Date(a.lastError.at).toLocaleString()}): {a.lastError.message}</p>}
        <p className="small muted">Bộ nhớ đệm nhận xét: {u.cacheEntries} mục · Bài nộp chưa chấm: {u.pendingSubmissions}</p>
      </Card>
      <div className="grid-2">
        <Card title="Theo loại tác vụ">
          {u.byKind.length === 0 ? <Empty>Chưa có lượt gọi nào.</Empty> : (
            <table className="table"><thead><tr><th>Tác vụ</th><th>Lượt</th><th>Lỗi</th><th>Token</th></tr></thead>
              <tbody>{u.byKind.map((k) => <tr key={k.kind}><td>{k.kind}</td><td>{k.calls}</td><td>{k.failed}</td><td>{k.tokens.toLocaleString()}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Theo ngày (30 ngày)">
          {u.byDay.length === 0 ? <Empty>Chưa có dữ liệu.</Empty> : (
            <table className="table"><thead><tr><th>Ngày</th><th>Lượt</th><th>Lỗi</th><th>Token</th></tr></thead>
              <tbody>{u.byDay.slice().reverse().map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.calls}</td><td>{d.failed}</td><td>{d.tokens.toLocaleString()}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>
      <Card title="Lượt gọi gần đây">
        {u.recent.length === 0 ? <Empty>Chưa có.</Empty> : (
          <table className="table"><tbody>{u.recent.map((r, i) => <tr key={i}><td className="small">{new Date(r.at).toLocaleString()}</td><td>{r.kind}</td><td>{r.ok ? <Badge tone="good">ok</Badge> : <Badge tone="bad">lỗi</Badge>}</td><td>{r.totalTokens.toLocaleString()}</td><td className="tiny muted">{r.error}</td></tr>)}</tbody></table>
        )}
        <p className="muted tiny">Số token lấy từ usageMetadata mà Gemini trả về; một số lỗi không có số token.</p>
      </Card>
    </>
  );
}
