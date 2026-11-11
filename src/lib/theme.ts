// Light/dark choice for this device only (a phone and a work laptop can differ), kept in localStorage.
// index.html applies the saved choice before the app loads, so there is no flash of the wrong theme.

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
}
