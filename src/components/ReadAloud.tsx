import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { post } from "../api";
import { loadVoices, speak, splitSentences, stopSpeaking } from "../lib/speech";
import { speechText } from "../../shared/read-aloud";

export { tableSpeech } from "../../shared/read-aloud";

/**
 * "Nghe bài đọc" button for any passage. Uses the server's cached neural voice;
 * falls back to the browser's own voice when the server cannot synthesize.
 */
export function ReadAloud({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "loading" | "ready" | "browser">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [rate, setRate] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLAudioElement>(null);
  const spoken = speechText(text);

  // A new passage resets the player.
  useEffect(() => { setState("idle"); setUrl(null); setError(null); stopSpeaking(); }, [spoken]);
  useEffect(() => () => stopSpeaking(), []);
  useEffect(() => { if (ref.current) ref.current.playbackRate = rate; }, [rate, url]);

  if (!spoken) return null;

  const start = async () => {
    setState("loading");
    setError(null);
    try {
      const r = await post<{ url: string }>("/api/read-aloud", { text: spoken });
      setUrl(r.url);
      setState("ready");
    } catch (e) {
      setError(`Giọng đọc máy chủ lỗi (${(e as Error).message}); đang dùng giọng của trình duyệt.`);
      setState("browser");
      await loadVoices();
      for (const s of splitSentences(spoken)) await speak(s, "narrator", { rate });
    }
  };

  return (
    <div className="read-aloud">
      {state === "idle" && <button className="btn small" onClick={start}><Icon name="volume-2" /> Nghe bài đọc</button>}
      {state === "loading" && <span className="muted small"><Icon name="volume-2" /> Đang tạo giọng đọc…</span>}
      {state === "ready" && url && <audio ref={ref} className="audio" controls autoPlay src={url} />}
      {state === "browser" && <button className="btn small ghost" onClick={() => { stopSpeaking(); setState("idle"); }}><Icon name="x" /> Dừng đọc</button>}
      {(state === "ready" || state === "browser") && (
        <select aria-label="Tốc độ đọc" value={rate} onChange={(e) => setRate(Number(e.target.value))} title="Tốc độ" disabled={state === "browser"}>
          {[0.75, 0.9, 1, 1.15].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
      )}
      {error && <div className="muted small">{error}</div>}
    </div>
  );
}
