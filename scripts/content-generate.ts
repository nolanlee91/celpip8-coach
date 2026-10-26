// Admin-only batch generation (never part of the study flow). Requires GEMINI_API_KEY.
//
//   npm run content:generate -- --skill reading --task R4 --count 3 [--set-type full|drill|mock|practice]
//                               [--focus inference] [--topic housing] [--difficulty 7] [--no-review]
//   npm run content:generate -- --skill vocabulary --topic banking --count 25
//   npm run content:generate -- --resume <jobId>          # continue an interrupted job
//   npm run content:generate -- --list                    # list jobs
//
// Results are drafts in $DATA_DIR/content-drafts/<jobId>/ — validated automatically and (optionally)
// reviewed by a separate AI reviewer call. Nothing enters the library until approved + imported:
//   npm run content:review  /  npm run content:import

import "dotenv/config";
import { createJob, listJobs, runJob, type JobSkill } from "../server/pipeline";
import { aiConfigured } from "../server/ai";
import { load } from "../server/db";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

function printJob(j: ReturnType<typeof listJobs>[number]) {
  const gen = j.drafts.filter((d) => d.status === "generated").length;
  const valid = j.drafts.filter((d) => d.status === "generated" && !d.issues.some((i) => i.severity === "error")).length;
  const pass = j.drafts.filter((d) => d.aiReview?.verdict === "pass").length;
  console.log(`${j.id}  ${j.skill}/${j.taskType || "-"} ${j.setType} ×${j.count}  generated ${gen}/${j.drafts.length}, valid ${valid}, AI-review pass ${pass}, approved ${j.drafts.filter((d) => d.decision === "approved").length}, imported ${j.drafts.filter((d) => d.imported).length}  tokens ${j.usage.totalTokens} (${j.usage.calls} calls)${j.lastError ? `  last error: ${j.lastError}` : ""}`);
}

async function main() {
  if (args.includes("--list")) { listJobs().forEach(printJob); return; }
  if (!aiConfigured()) { console.error("GEMINI_API_KEY is not set (.env)."); process.exit(1); }
  const db = load();
  const difficultyFor = (t: string) => db.settings.difficulty[t] ?? 7;
  const resume = opt("resume");
  const jobId = resume ?? createJob({
    skill: (opt("skill") ?? "reading") as JobSkill,
    taskType: opt("task"),
    setType: opt("set-type"),
    count: Number(opt("count") ?? 1),
    focus: opt("focus") ?? null,
    topic: opt("topic") ?? null,
    difficulty: opt("difficulty") ? Number(opt("difficulty")) : null,
    aiReview: !args.includes("--no-review"),
    effort: (opt("effort") as "low" | "medium" | "high") ?? "medium",
  }).id;
  console.log(`${resume ? "Resuming" : "Created"} job ${jobId}`);
  const job = await runJob(jobId, { log: console.log, difficultyFor });
  printJob(job);
  console.log("\nNext: review drafts with `npm run content:review -- --job " + jobId + "`, then `npm run content:import`.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
