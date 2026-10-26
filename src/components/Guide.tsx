import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Settings } from "../../shared/types";
import { SKILL_LABEL, SKILLS, type Skill } from "../../shared/spec";
import { api, post } from "../api";
import { Icon } from "./Icon";

interface GuideApi {
  settings: Settings | null;
  openOnboarding: () => void;
  helpSeen: (key: string) => boolean;
  dismissHelp: (key: string) => void;
  resetHelp: () => void;
}

const GuideCtx = createContext<GuideApi>({ settings: null, openOnboarding: () => {}, helpSeen: () => true, dismissHelp: () => {}, resetHelp: () => {} });
export const useGuide = () => useContext(GuideCtx);

/** Loads onboarding/help state once; shows the welcome guide automatically until it is finished or skipped. */
export function GuideProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api<Settings>("/api/settings").then((s) => { setSettings(s); if (!s.onboarding?.completed) setOpen(true); }).catch(() => {});
  }, []);

  const dismissHelp = useCallback((key: string) => {
    setSettings((s) => (s ? { ...s, helpSeen: [...new Set([...(s.helpSeen ?? []), key])] } : s));
    void post("/api/help/seen", { key }).catch(() => {});
  }, []);
  const resetHelp = useCallback(() => {
    setSettings((s) => (s ? { ...s, helpSeen: [] } : s));
    void post("/api/help/seen", { reset: true }).catch(() => {});
  }, []);

  const api_: GuideApi = {
    settings,
    openOnboarding: () => setOpen(true),
    helpSeen: (key) => !settings || (settings.helpSeen ?? []).includes(key),
    dismissHelp,
    resetHelp,
  };

  return (
    <GuideCtx.Provider value={api_}>
      {children}
      {open && settings && <Onboarding initial={settings} onClose={(s) => { setSettings(s); setOpen(false); }} />}
    </GuideCtx.Provider>
  );
}

/** A small first-visit note. Dismissed once, remembered on the server. */
export function HelpTip({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const g = useGuide();
  if (g.helpSeen(id)) return null;
  return (
    <aside className="helptip" aria-label={title}>
      <Icon name="lightbulb" size={20} className="helptip-icon" />
      <div className="grow">
        <strong>{title}</strong>
        <div className="helptip-body">{children}</div>
      </div>
      <button className="btn small ghost" onClick={() => g.dismissHelp(id)}>Đã hiểu</button>
    </aside>
  );
}

const STEPS = ["Điểm xuất phát", "Thời gian học", "Cách học"];

/** Three-step welcome guide. Each step is saved as you go; finishing opens the coach's first lesson. */
function Onboarding({ initial, onClose }: { initial: Settings; onClose: (s: Settings) => void }) {
  const [step, setStep] = useState(Math.min(2, initial.onboarding?.step ?? 0));
  const [scores, setScores] = useState<Record<Skill, number>>({ ...initial.officialScores });
  const [target, setTarget] = useState(initial.targetLevel);
  const [minutes, setMinutes] = useState<number>(initial.dailyMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") void skip(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const weakest = [...SKILLS].sort((a, b) => scores[a] - scores[b]).slice(0, 2);

  async function go(next: number) {
    setError(null);
    setBusy(true);
    try {
      const body: Record<string, unknown> = { step: next };
      if (step === 0) Object.assign(body, { officialScores: scores, targetLevel: target });
      if (step === 1) Object.assign(body, { dailyMinutes: minutes });
      await post<Settings>("/api/onboarding", body);
      setStep(next);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function skip() {
    const s = await post<Settings>("/api/onboarding", { finish: "skipped" }).catch(() => null);
    onClose(s ?? { ...initial, onboarding: { ...initial.onboarding, completed: true, skipped: true } });
  }

  async function finish() {
    setBusy(true);
    try {
      const s = await post<Settings>("/api/onboarding", { finish: "completed", step: 2 });
      // The first lesson comes from the coach, never a hard-coded id.
      const coach = await api<{ recommendations: { lessonId: string | null; route: string }[] }>("/api/coach");
      const first = coach.recommendations.find((r) => r.lessonId);
      onClose(s);
      nav(first ? first.route : "/learn");
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="onb-backdrop" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="onb">
        <div className="onb-top">
          <ol className="onb-steps" aria-label="Các bước">
            {STEPS.map((t, i) => <li key={t} className={i === step ? "on" : i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}><span>{i + 1}</span>{t}</li>)}
          </ol>
          <button className="btn small ghost" onClick={() => void skip()}>Bỏ qua</button>
        </div>

        {step === 0 && (
          <section>
            <h2 id="onb-title">Chào mừng đến CELPIP 8 Coach</h2>
            <p>Ứng dụng này dạy bạn kỹ thuật làm bài, cho luyện dạng thi và nhắc ôn đúng lúc, để đưa cả bốn kỹ năng lên mục tiêu. Kiểm tra lại điểm CELPIP gần nhất của bạn:</p>
            <div className="onb-scores">
              {SKILLS.map((k) => (
                <label key={k} className="field">
                  {SKILL_LABEL[k]}
                  <input type="number" inputMode="numeric" min={1} max={12} value={scores[k]} onChange={(e) => setScores({ ...scores, [k]: Number(e.target.value) })} />
                </label>
              ))}
              <label className="field onb-target">
                Mục tiêu cho mỗi kỹ năng
                <input type="number" inputMode="numeric" min={4} max={12} value={target} onChange={(e) => setTarget(Number(e.target.value))} />
              </label>
            </div>
            <p className="muted small">
              Lúc đầu, {weakest.map((k) => SKILL_LABEL[k]).join(" và ")} sẽ được dành nhiều thời gian hơn vì đó là hai kỹ năng thấp nhất.
              Khi bạn tiến bộ, tỷ lệ sẽ tự điều chỉnh.
            </p>
          </section>
        )}

        {step === 1 && (
          <section>
            <h2 id="onb-title">Mỗi ngày bạn học được bao lâu?</h2>
            <div className="onb-minutes" role="radiogroup" aria-label="Thời gian học mỗi ngày">
              {[30, 60, 90, 120].map((m) => (
                <button key={m} role="radio" aria-checked={minutes === m} className={`onb-min ${minutes === m ? "on" : ""}`} onClick={() => setMinutes(m)}>
                  <strong>{m}</strong><span>phút</span>
                </button>
              ))}
            </div>
            <p>Mỗi ngày, huấn luyện viên xếp sẵn một kế hoạch vừa đúng thời gian này: một bài học mới, phần luyện tập ngay sau đó, ôn lại những gì sắp quên và một ít luyện dạng thi. Bạn đổi thời gian bất cứ lúc nào ở trang Hôm nay.</p>
          </section>
        )}

        {step === 2 && (
          <section>
            <h2 id="onb-title">Bạn sẽ học như thế nào</h2>
            <ul className="onb-modes">
              <li><Icon name="graduation-cap" size={22} /><div><strong>Học</strong><span>Học từng kỹ thuật qua bài giảng ngắn, ví dụ mẫu và bài tập có gợi ý.</span></div></li>
              <li><Icon name="dumbbell" size={22} /><div><strong>Luyện thi</strong><span>Áp dụng kỹ thuật vào câu hỏi giống đề CELPIP thật.</span></div></li>
              <li><Icon name="rotate-ccw" size={22} /><div><strong>Ôn tập</strong><span>Làm lại câu sai, ôn từ vựng và kỹ năng đã học, đúng lúc sắp quên.</span></div></li>
              <li><Icon name="target" size={22} /><div><strong>Huấn luyện viên</strong><span>Tự chọn việc nên làm tiếp và nói rõ vì sao. Bạn chỉ cần mở trang Hôm nay.</span></div></li>
            </ul>
          </section>
        )}

        {error && <p className="bad-msg small">{error}</p>}

        <div className="onb-actions">
          {step > 0 ? <button className="btn" disabled={busy} onClick={() => setStep(step - 1)}><Icon name="chevron-left" /> Quay lại</button> : <span />}
          {step < 2
            ? <button className="btn primary" disabled={busy} onClick={() => void go(step + 1)}>Tiếp tục <Icon name="chevron-right" /></button>
            : <button className="btn primary big" disabled={busy} onClick={() => void finish()}><Icon name="play" /> Bắt đầu bài học đầu tiên</button>}
        </div>
      </div>
    </div>
  );
}
