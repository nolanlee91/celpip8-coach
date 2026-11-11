// Dev-only: fills a running server with realistic worst-case learner data through the public API,
// so screens can be checked against long names, unbreakable terms, empty fields and a 1,000-word notebook.
// Run against a throwaway data dir, never the real one:
//   $env:DATA_DIR="data-worst"; $env:PORT="8788"; npx tsx server/index.ts
//   npx tsx scripts/seed-worst-case.ts http://localhost:8788
//   $env:API_PORT="8788"; npx vite --port 5174

const base = (process.argv[2] ?? "http://localhost:8788").replace(/\/$/, "");
if (/:8787\b/.test(base)) {
  console.error("Refusing to seed the default server (port 8787): point it at a throwaway DATA_DIR instead.");
  process.exit(1);
}

async function call(path: string, method: string, body?: unknown) {
  const r = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

// Terms a learner can type into "Thêm từ"; none are in the curated library, so they stay un-enriched (empty vi/definition).
const manualTerms: { term: string; context?: string }[] = [
  { term: "counterintuitively-understated-reimbursement-eligibility-requirements" },
  { term: "Đặng Thị Ngọc Hân nói “bring it up with the landlord”" },
  { term: "a" },
  { term: "https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents/language-requirements.html" },
  { term: "<b>notwithstanding</b> &amp; **bold**" },
  { term: "take something into account", context: "The committee will take your previous experience into account when it reviews the application, so please list every position you have held over the past ten years, including volunteer work, part-time roles and any short contracts that relate to customer service, logistics or community outreach in Canada or abroad." },
  { term: "Benachrichtigungseinstellungen" },
  { term: "🏠 rent-to-own" },
];

const settings = await call("/api/settings", "GET");
await call("/api/settings", "PUT", { ...settings, learnerName: "Aleksandra Wiśniewska-Kowalczyk Nguyễn Thị Phương Thảo" });
for (const t of manualTerms) await call("/api/vocab", "POST", t);
const lib = await call("/api/vocab/library", "GET") as { rows: { id: string }[] };
const { added } = await call("/api/vocab/pack", "POST", { ids: lib.rows.map((r) => r.id) }) as { added: number };
const vocab = await call("/api/vocab", "GET") as unknown[];
console.log(`Seeded ${base}: learner name, ${manualTerms.length} manual terms, ${added} library words (notebook now ${vocab.length}).`);

export {};
