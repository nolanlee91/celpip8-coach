// Human review of generated drafts.
//
//   npm run content:review -- --job <jobId>                       # list drafts with validation + AI review
//   npm run content:review -- --job <jobId> --show <draftId>      # print a draft (JSON)
//   npm run content:review -- --job <jobId> --approve <draftId> [--notes "..."]
//   npm run content:review -- --job <jobId> --reject <draftId> [--notes "..."]
//
// Approval is refused while a draft still has validation errors. The same actions are available
// on the Admin page (/admin) of the running app.

import { decide, getJob, listJobs, readDraft } from "../server/pipeline";

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const jobId = opt("job") ?? listJobs()[0]?.id;
if (!jobId) { console.log("No generation jobs yet."); process.exit(0); }

if (opt("show")) {
  console.log(JSON.stringify(readDraft(jobId, opt("show")!), null, 2));
  process.exit(0);
}
if (opt("approve") || opt("reject")) {
  const id = (opt("approve") ?? opt("reject"))!;
  decide(jobId, id, opt("approve") ? "approved" : "rejected", opt("notes") ?? "");
  console.log(`${id}: ${opt("approve") ? "approved" : "rejected"}`);
  process.exit(0);
}

const job = getJob(jobId);
console.log(`Job ${job.id} — ${job.skill}/${job.taskType || "-"} ${job.setType}`);
for (const d of job.drafts) {
  const errors = d.issues.filter((i) => i.severity === "error");
  console.log(`\n${d.id}  [${d.status}] decision=${d.decision}${d.imported ? " (imported)" : ""}  topic=${d.topic} difficulty=${d.difficulty}`);
  if (d.error) console.log(`  generation error: ${d.error}`);
  for (const i of d.issues) console.log(`  ${i.severity === "error" ? "✗" : "!"} ${i.message}`);
  if (d.aiReview) {
    console.log(`  AI review: ${d.aiReview.verdict}${d.aiReview.wrongKeys.length ? ` · wrong keys: Q${d.aiReview.wrongKeys.join(", Q")}` : ""}${d.aiReview.ambiguousQuestions.length ? ` · ambiguous: Q${d.aiReview.ambiguousQuestions.join(", Q")}` : ""}`);
    for (const s of d.aiReview.issues) console.log(`    - ${s}`);
  }
  if (!errors.length && d.status === "generated" && d.decision === "pending") console.log("  → ready for human review (--show / --approve / --reject)");
}
