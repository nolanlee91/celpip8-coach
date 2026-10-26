// Imports APPROVED drafts into the active library.
//
//   npm run content:import                       # all approved drafts → content/ (commit them to git)
//   npm run content:import -- --job <jobId>
//   npm run content:import -- --target library   # → $DATA_DIR/library instead (server-only, not in git)
//
// Every item is re-validated on import; drafts with errors are skipped.

import { importApproved } from "../server/pipeline";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const { imported, skipped } = importApproved({ jobId: opt("job"), target: opt("target") === "library" ? "library" : "content" });
console.log(`Imported ${imported.length}: ${imported.join(", ") || "-"}`);
if (skipped.length) console.log(`Skipped ${skipped.length} (missing or invalid): ${skipped.join(", ")}`);
console.log("Run `npm run content:validate` to confirm the library is clean.");
