// npm run content:validate [-- --filter <path-substring>] [--dir <root>] [--quiet]
// Validates the content library (content/ + $DATA_DIR/library) and prints a summary.
// Exit code 1 when any error is found (in the filtered scope).

import { CONTENT_DIR, LIBRARY_DIR, scanLibrary } from "../server/library";
import { audioStatus } from "../server/audio";
import { LESSONS_DIR, scanCurriculum } from "../server/lessons";
import { lessonAudioStatus } from "../server/audio";

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const filter = opt("filter");
const dir = opt("dir");
const quiet = args.includes("--quiet");

const lib = scanLibrary(dir ? [dir] : [CONTENT_DIR, LIBRARY_DIR]);
const cur = scanCurriculum(dir ? `${dir}/lessons` : LESSONS_DIR);
const issues = [...lib.issues, ...cur.issues].filter((i) => !filter || i.file.includes(filter) || i.id.includes(filter));
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");

if (!quiet) {
  const byFile = new Map<string, typeof issues>();
  for (const i of issues) byFile.set(i.file, [...(byFile.get(i.file) ?? []), i]);
  for (const [file, list] of byFile) {
    console.log(`\n${file}`);
    for (const i of list) console.log(`  ${i.severity === "error" ? "✗ ERROR" : "! warn "} [${i.id}] ${i.message}`);
  }
}

const rows = new Map<string, Record<string, number>>();
let audioReady = 0;
let listeningTotal = 0;
for (const { item, active } of lib.all.values()) {
  const st = (item as { setType?: string }).setType ?? "?";
  const r = rows.get(item.taskType) ?? {};
  const key = active ? st : `${st} (inactive)`;
  r[key] = (r[key] ?? 0) + 1;
  rows.set(item.taskType, r);
  if (item.kind === "listening" && active) {
    listeningTotal++;
    if (audioStatus(item).ready) audioReady++;
  }
}
console.log("\n=== Library summary (active = approved and error-free) ===");
for (const t of [...rows.keys()].sort()) console.log(`  ${t.padEnd(4)} ${Object.entries(rows.get(t)!).map(([k, v]) => `${k}: ${v}`).join(", ")}`);
console.log(`  vocabulary entries (valid): ${lib.vocab.length}`);
console.log(`  mock packages: ${lib.mocks.length} (${lib.mocks.filter((m) => m.valid).length} valid)`);
console.log(`  listening audio ready: ${audioReady}/${listeningTotal}`);
console.log("\n=== Learn Mode curriculum ===");
for (const skill of ["reading", "listening", "speaking", "writing"]) {
  const planned = cur.order[skill].length;
  const files = [...cur.all.values()].filter((x) => x.lesson.skill === skill);
  const active = files.filter((x) => x.active);
  const ex = active.reduce((n, x) => n + x.lesson.guided.length + x.lesson.independent.length, 0);
  console.log(`  ${skill.padEnd(10)} planned ${planned}, files ${files.length}, active (approved + valid) ${active.length}, exercises ${ex}`);
}
const withAudio = [...cur.lessons.values()].map((l) => lessonAudioStatus(l)).filter((s) => s.chunks.length);
console.log(`  lessons with audio clips: ${withAudio.length} (${withAudio.filter((s) => s.ready).length} fully generated, ${withAudio.reduce((n, s) => n + s.chunks.filter((c) => c.file).length, 0)}/${withAudio.reduce((n, s) => n + s.chunks.length, 0)} clips)`);
console.log(`\n${errors.length} error(s), ${warnings.length} warning(s)${filter ? ` matching "${filter}"` : ""}.`);
process.exit(errors.length ? 1 : 0);
