// Text normalisation for the "Nghe bài đọc" button. Shared by the client (what it sends) and the
// pre-generation script (what it bundles), so both produce the same text and therefore the same file hash.

/** Plain text for speech: blanks become "blank", Markdown marks are dropped. */
export function speechText(text: string): string {
  return text
    .replace(/\[\[\d+\]\]|【\d+】/g, " blank ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+|^\s*[-*>]\s+/gm, "")
    .replace(/[*_`|]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Table sections read row by row: "Header: cell, Header: cell." */
export function tableSpeech(t: { caption?: string; headers: string[]; rows: string[][] }): string {
  const rows = t.rows.map((r) => r.map((c, j) => (t.headers[j] ? `${t.headers[j]}: ${c}` : c)).join(", ") + ".");
  return [t.caption ? `${t.caption}.` : "", ...rows].filter(Boolean).join("\n\n");
}
