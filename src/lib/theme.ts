// Light/dark choice for this device only (a phone and a work laptop can differ), kept in localStorage.
// index.html applies the saved choice before the app loads, so there is no flash of the wrong theme.

import { useEffect, useState } from "react";

export type Theme = "auto" | "light" | "dark";

const KEY = "theme";
// The browser bar matches the top bar (--rail) of each theme.
const BAR = { light: "#0d3a40", dark: "#16292d" };

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function setTheme(t: Theme) {
  try {
    if (t === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch { /* storage unavailable: the choice lasts until reload */ }
  const root = document.documentElement;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = m.media.includes("dark") ? "dark" : "light";
    m.content = BAR[t === "auto" ? scheme : t];
  }
  window.dispatchEvent(new Event("themechange"));
}

/** The theme actually on screen: the saved choice, or the device's when the choice is "auto". */
export function effectiveTheme(t: Theme = getTheme()): "light" | "dark" {
  if (t !== "auto") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Current choice and what it resolves to, kept in sync between the top-bar switch and Settings. */
export function useTheme() {
  const [theme, set] = useState<Theme>(getTheme);
  const [, rerender] = useState(0);
  useEffect(() => {
    const sync = () => { set(getTheme()); rerender((n) => n + 1); };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    window.addEventListener("themechange", sync);
    mq.addEventListener("change", sync);
    return () => { window.removeEventListener("themechange", sync); mq.removeEventListener("change", sync); };
  }, []);
  return { theme, effective: effectiveTheme(theme), setTheme };
}
