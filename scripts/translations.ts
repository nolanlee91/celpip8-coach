// Pre-made Vietnamese translations (content/translations/vi.json).
//
//   npm run translations -- --status
//   npm run translations -- --export <dir> [--chars 25000]   # untranslated texts → <dir>/batch-NN.json ({key: english})
//   npm run translations -- --import <dir>                   # <dir>/batch-NN.vi.json ({key: vietnamese}) → vi.json
//
// Keys are hashes of the exact English text; entries whose English text no longer exists are dropped on import.

import fs from "node:fs";
import path from "node:path";
import { translatableTexts, translationKey, translations, TRANSLATIONS_FILE } from "../server/translations";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const texts = new Map(translatableTexts().map((t) => [translationKey(t), t]));
const have = translations();
const missing = [...texts].filter(([k]) => !have[k]);
console.log(`${texts.size} texts · ${texts.size - missing.length} translated · ${missing.length} missing (${missing.reduce((n, [, t]) => n + t.length, 0)} chars)`);

const exportDir = opt("export");
if (exportDir) {
  fs.mkdirSync(exportDir, { recursive: true });
  const max = Number(opt("chars") ?? 25000);
  const batches: Record<string, string>[] = [{}];
  let size = 0;
  for (const [k, t] of missing) {
    if (size && size + t.length > max) { batches.push({}); size = 0; }
    batches[batches.length - 1][k] = t;
    size += t.length;
  }
  batches.filter((b) => Object.keys(b).length).forEach((b, i) =>
    fs.writeFileSync(path.join(exportDir, `batch-${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(b, null, 1)));
  console.log(`Wrote ${batches.length} batch file(s) to ${exportDir}`);
}

const importDir = opt("import");
if (importDir) {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(have)) if (texts.has(k)) merged[k] = v;
  let added = 0, unknown = 0;
  for (const f of fs.readdirSync(importDir).filter((f) => f.endsWith(".vi.json"))) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(importDir, f), "utf8")) as Record<string, string>)) {
      if (!texts.has(k)) { unknown++; continue; }
      if (typeof v === "string" && v.trim()) { if (!merged[k]) added++; merged[k] = v.trim(); }
    }
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)));
  fs.mkdirSync(path.dirname(TRANSLATIONS_FILE), { recursive: true });
  fs.writeFileSync(TRANSLATIONS_FILE, JSON.stringify(sorted, null, 1) + "\n");
  console.log(`Imported ${added} new translation(s), ignored ${unknown} unknown key(s). ${Object.keys(sorted).length}/${texts.size} translated.`);
}
