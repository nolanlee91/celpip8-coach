import { useEffect, useState } from "react";
import type { Settings } from "../../shared/types";
import { SKILL_LABEL, SKILLS, taskName } from "../../shared/spec";
import { api, post, put } from "../api";
import { Card, ErrorBox, Loading } from "../components/ui";
import { loadVoices, speak } from "../lib/speech";

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<{ aiConfigured: boolean; model: string } | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then(setS).catch((e) => setError(e.message));
    api<{ aiConfigured: boolean; model: string }>("/api/status").then(setStatus).catch(() => {});
    void loadVoices().then(setVoices);
  }, []);

  if (!s) return <Loading />;
  const total = SKILLS.reduce((n, k) => n + Number(s.weights[k]), 0);
  const upd = (patch: Partial<Settings>) => setS({ ...s, ...patch });

  const saveAll = async () => {
    setError(null);
    try { setS(await put<Settings>("/api/settings", s)); setMsg("Đã lưu."); setTimeout(() => setMsg(null), 2500); }
    catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="page">
      <h1>⚙️ Cài đặt</h1>
      <ErrorBox error={error} />
      <Card title="Kết nối AI">
        {status?.aiConfigured
          ? <p>✅ Đã cấu hình API key · model <code>{status.model}</code></p>
          : <p>❌ Chưa có <code>GEMINI_API_KEY</code>. Tạo file <code>.env</code> trong thư mục app (xem <code>.env.example</code>) rồi khởi động lại server.</p>}
        <label className="field">Mức suy nghĩ khi tạo đề Reading/Listening
          <select value={s.effort} onChange={(e) => upd({ effort: e.target.value as Settings["effort"] })}>
            <option value="low">Nhanh (low)</option><option value="medium">Cân bằng (medium)</option><option value="high">Kỹ nhất (high, chậm hơn)</option>
          </select>
        </label>
      </Card>

      <Card title="Hồ sơ & mục tiêu">
        <div className="form-grid">
          <label className="field">Tên<input value={s.learnerName} onChange={(e) => upd({ learnerName: e.target.value })} /></label>
          <label className="field">Ngày thi chính thức gần nhất<input type="date" value={s.officialTestDate} onChange={(e) => upd({ officialTestDate: e.target.value })} /></label>
          <label className="field">Mục tiêu (mỗi kỹ năng)<input type="number" min={5} max={12} value={s.targetLevel} onChange={(e) => upd({ targetLevel: Number(e.target.value) })} /></label>
          {SKILLS.map((k) => (
            <label key={k} className="field">Điểm chính thức {SKILL_LABEL[k]}
              <input type="number" min={1} max={12} value={s.officialScores[k]} onChange={(e) => upd({ officialScores: { ...s.officialScores, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Card>

      <Card title="Kế hoạch học">
        <div className="form-grid">
          <label className="field">Ngày bắt đầu<input type="date" value={s.startDate} onChange={(e) => upd({ startDate: e.target.value })} /></label>
          <label className="field">Số tuần<input type="number" min={4} max={52} value={s.planWeeks} onChange={(e) => upd({ planWeeks: Number(e.target.value) })} /></label>
          <label className="field">Thời gian mỗi ngày
            <select value={s.dailyMinutes} onChange={(e) => upd({ dailyMinutes: Number(e.target.value) as Settings["dailyMinutes"] })}>
              {[30, 60, 90, 120].map((m) => <option key={m} value={m}>{m} phút</option>)}
            </select>
          </label>
          {SKILLS.map((k) => (
            <label key={k} className="field">Tỷ trọng {SKILL_LABEL[k]} (%)
              <input type="number" min={0} max={100} value={s.weights[k]} onChange={(e) => upd({ weights: { ...s.weights, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
        <p className={total === 100 ? "muted small" : "error-box small"}>Tổng: {total}% {total !== 100 && "— phải bằng 100%"}</p>
        <label className="row gap-s"><input type="checkbox" checked={s.autoAdjust} onChange={(e) => upd({ autoAdjust: e.target.checked })} /> Tự động điều chỉnh tỷ trọng sau mỗi đánh giá tuần</label>
      </Card>

      <Card title="Độ khó hiện tại theo dạng bài (5–10, tự điều chỉnh)">
        <div className="form-grid compact">
          {Object.entries(s.difficulty).map(([k, v]) => (
            <label key={k} className="field" title={taskName(k)}>{k} · {taskName(k)}
              <input type="number" min={5} max={10} value={v} onChange={(e) => upd({ difficulty: { ...s.difficulty, [k]: Number(e.target.value) } })} />
            </label>
          ))}
        </div>
      </Card>

      <Card title="Giọng đọc">
        <p className="small muted">Bài Listening dùng nhiều giọng khác nhau cho từng người nói (ưu tiên en-CA). Chọn giọng mặc định cho người dẫn/tin tức:</p>
        <div className="row gap-s wrap">
          <select value={s.preferredVoice ?? ""} onChange={(e) => upd({ preferredVoice: e.target.value || null })}>
            <option value="">Tự động (ưu tiên en-CA)</option>
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>)}
          </select>
          <button className="btn small" onClick={() => speak("Welcome to your CELPIP practice. The next bus to Metrotown leaves at four fifteen.", "narrator", { preferred: s.preferredVoice })}>🔊 Nghe thử</button>
        </div>
        {voices.length === 0 && <p className="error-box small">Trình duyệt không cung cấp giọng tiếng Anh nào.</p>}
      </Card>

      <div className="row gap-s"><button className="btn primary big" disabled={total !== 100} onClick={saveAll}>Lưu cài đặt</button>{msg && <span className="ok-msg">{msg}</span>}</div>

      <Card title="Dữ liệu">
        <p className="small muted">Toàn bộ dữ liệu được lưu cục bộ trong <code>data/db.json</code> trên máy bạn.</p>
        <div className="row gap-s wrap">
          <a className="btn" href="/api/export">⬇ Xuất bản sao lưu (JSON)</a>
          <label className="btn">⬆ Nhập bản sao lưu
            <input type="file" accept="application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f || !confirm("Thay thế toàn bộ dữ liệu hiện tại bằng file này?")) return;
              try { await post("/api/import", JSON.parse(await f.text())); location.reload(); } catch (err) { setError((err as Error).message); }
            }} />
          </label>
          <button className="btn bad" onClick={async () => { if (confirm("Xóa TOÀN BỘ dữ liệu luyện tập? Không thể hoàn tác.") && confirm("Chắc chắn?")) { await post("/api/reset"); location.reload(); } }}>Xóa toàn bộ dữ liệu</button>
        </div>
      </Card>
    </div>
  );
}
