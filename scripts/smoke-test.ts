// End-to-end smoke test (npm run test:smoke). Starts the real server WITHOUT a Gemini key in a
// temporary DATA_DIR seeded with a legacy db.json, then verifies the offline-first guarantees:
// migration, library-based practice, vocabulary, prebuilt mocks, AI-optional evaluation, persistence.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PORT = 8811;
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "celpip8-smoke-"));
let server: ChildProcess | null = null;
let passed = 0;
let failed = 0;
const results: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++; else failed++;
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`;
  results.push(line);
  console.log(line);
}

async function call<T = any>(url: string, body?: unknown, method?: string): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + url, body !== undefined || method ? { method: method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) } : undefined);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null };
}

async function start() {
  const env = { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), GEMINI_API_KEY: "", APP_PASSWORD: "" };
  server = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "server/index.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  server.stdout?.on("data", (d) => { log += d; });
  server.stderr?.on("data", (d) => { log += d; });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return log; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`server did not start:\n${log}`);
}

async function stop() {
  if (!server) return;
  const s = server;
  server = null;
  await new Promise<void>((resolve) => { s.once("exit", () => resolve()); s.kill(); setTimeout(resolve, 3000); });
}

function seedLegacyDb() {
  // Shape of the pre-refactor single-file store (one AI-generated item + an attempt + an evaluation).
  const legacy = {
    version: 1,
    settings: { learnerName: "Legacy", officialScores: { listening: 6, reading: 5, writing: 7, speaking: 6 }, officialTestDate: "2026-04-01", targetLevel: 8, planWeeks: 12, dailyMinutes: 90, weights: { reading: 35, listening: 30, speaking: 25, writing: 10 }, autoAdjust: true, startDate: "2026-10-01", difficulty: { R1: 6 }, preferredVoice: null, effort: "medium" },
    content: { rd_legacy: { id: "rd_legacy", kind: "reading", taskType: "R1", difficulty: 6, title: "Legacy AI set", sections: [{ label: "Letter", kind: "text", text: "Hello there, this is a legacy letter.", table: null }], questions: [], vocabulary: [], createdAt: "2026-10-01", focus: [] } },
    attempts: [{ id: "at_legacy", skill: "reading", taskType: "R1", mode: "learn", contentId: "rd_legacy", difficulty: 6, startedAt: "2026-10-01T10:00:00Z", finishedAt: "2026-10-01T10:10:00Z", durationSec: 600, correct: 7, total: 11, items: [], estimatedBand: null, evaluationId: null, mockExamId: null }],
    mistakes: [], vocab: [], evaluations: { ev_legacy: { id: "ev_legacy" } }, studyLog: [{ date: "2026-10-01", minutes: 10, skill: "reading" }],
    mockExams: [], weekly: [], planCompletions: {},
  };
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(legacy));
}

async function main() {
  seedLegacyDb();
  const log = await start();

  // --- migration
  const files = fs.readdirSync(dataDir);
  check("legacy db.json migrated to progress.json + ai.json", files.includes("progress.json") && files.includes("ai.json") && !files.includes("db.json"), files.join(", "));
  check("legacy backup kept", files.some((f) => f.startsWith("db.json.migrated-")));
  const ai = JSON.parse(fs.readFileSync(path.join(dataDir, "ai.json"), "utf8"));
  const prog = JSON.parse(fs.readFileSync(path.join(dataDir, "progress.json"), "utf8"));
  check("evaluations stored separately from progress", Boolean(ai.evaluations?.ev_legacy) && !("evaluations" in prog));
  const hist = await call("/api/history");
  check("legacy attempt still visible", hist.data.some((a: { id: string }) => a.id === "at_legacy"));

  // --- status & library
  const st = await call("/api/status");
  check("AI reported as not configured", st.data.ai.configured === false);
  check("library loaded with active items", st.data.library.items > 0, `${st.data.library.items} items, ${st.data.library.vocab} vocab, ${st.data.library.errors} validation errors`);

  // --- reading without AI
  const t0 = Date.now();
  const next = await call("/api/practice/next", { skill: "reading", mode: "learn" });
  const ms = Date.now() - t0;
  check("reading exercise loads instantly without API key", next.status === 200 && Boolean(next.data.item?.questions?.length), `${next.data.item?.id ?? next.data.error} in ${ms} ms`);
  if (next.status === 200) {
    const item = next.data.item;
    const answers = Object.fromEntries(item.questions.map((q: { id: string }) => [q.id, 0]));
    const sub = await call("/api/attempts/objective", { contentId: item.id, mode: "learn", answers, durationSec: 300 });
    check("reading answers scored locally", sub.status === 200 && sub.data.attempt.total === item.questions.length, `${sub.data.attempt?.correct}/${sub.data.attempt?.total}`);
    check("explanations returned after submit", sub.data.content.questions.every((q: { explanationVi: string; evidence: string }) => q.explanationVi && q.evidence));
    check("mistakes recorded", Array.isArray(sub.data.mistakes));
    const again = await call("/api/practice/next", { skill: "reading", mode: "learn", taskType: item.taskType });
    check("selector avoids the exercise just completed", again.status !== 200 || again.data.item.id !== item.id || again.data.repeated, again.data.item?.id ?? again.data.error);
  }
  const drill = await call("/api/practice/next", { skill: "reading", mode: "drill", focus: "inference" });
  check("weakness-focused drill selected from library", drill.status === 200, drill.data.item?.id ?? drill.data.error);
  const lib = await call("/api/library/reading?status=new");
  check("library browser lists reading sets with filters", lib.status === 200 && lib.data.rows.length > 0, `${lib.data.rows?.length} new sets`);

  // --- listening: pending audio must not silently become text practice
  const ln = await call("/api/practice/next", { skill: "listening", mode: "learn" });
  if (ln.status === 200) {
    check("listening set served only with audio", ln.data.item.audio?.ready === true || ln.data.browserVoice === true, ln.data.item.id);
  } else {
    check("listening without audio is excluded with a clear message", ln.status === 404 && /audio/i.test(ln.data.error), ln.data.error);
  }
  const set = await call("/api/settings");
  await call("/api/settings", { ...set.data, allowBrowserVoice: true }, "PUT");
  const ln2 = await call("/api/practice/next", { skill: "listening", mode: "learn" });
  check("explicit browser-voice opt-in enables listening (labelled)", ln2.status === 200 && (ln2.data.browserVoice === true || ln2.data.item.audio?.ready), ln2.data.item?.id ?? ln2.data.error);

  // --- vocabulary without AI
  const vl = await call("/api/vocab/library");
  check("vocabulary library available", vl.data.total > 0, `${vl.data.total} entries`);
  if (vl.data.rows?.length) {
    const term = vl.data.rows[0].term;
    const add = await call("/api/vocab", { term });
    check("adding a library word needs no AI", add.status === 200 && add.data.from === "library", `${term} → ${add.data.from}`);
    const rev = await call(`/api/vocab/${add.data.item.id}/review`, { quality: 4 });
    check("vocabulary SRS review works", rev.status === 200 && rev.data.reviews === 1);
  }
  const unknown = await call("/api/vocab", { term: "zzqx-not-a-word" });
  check("unknown word saved without calling AI", unknown.status === 200 && unknown.data.from === "manual");

  // --- writing: offline submit, AI evaluation optional and fails gracefully
  const wn = await call("/api/practice/next", { skill: "writing", mode: "learn" });
  check("writing prompt loads instantly with model response", wn.status === 200 && Boolean(wn.data.item?.modelResponse), wn.data.item?.id ?? wn.data.error);
  if (wn.status === 200) {
    const text = "Dear Ms. Lee, I am writing to ask about the noise in our building. ".repeat(4);
    const s = await call("/api/submissions", { skill: "writing", contentId: wn.data.item.id, response: text, durationSec: 900 });
    check("writing submission saved without AI", s.status === 200 && s.data.submission.status === "pending");
    const ev = await call(`/api/submissions/${s.data.submission.id}/evaluate`, {});
    check("AI evaluation without key fails gracefully (503, retry later)", ev.status === 503 && /GEMINI_API_KEY/.test(ev.data.error), ev.data.error);
  }
  const sp = await call("/api/practice/next", { skill: "speaking", mode: "learn", taskType: "S3" });
  check("speaking prompt with visual loads from library", sp.status === 200 && typeof sp.data.item?.svg === "string" && sp.data.item.svg.startsWith("<svg"), sp.data.item?.id ?? sp.data.error);

  // --- prebuilt mock exam
  const pk = await call("/api/mock/packages");
  check("mock packages listed", Array.isArray(pk.data) && pk.data.length > 0, pk.data.map?.((p: { id: string; available: boolean }) => `${p.id}:${p.available ? "available" : "unavailable"}`).join(", "));
  const avail = (pk.data as { id: string; available: boolean }[]).find((p) => p.available);
  if (avail) {
    const m0 = Date.now();
    const mock = await call("/api/mock", { packageId: avail.id });
    const mms = Date.now() - m0;
    check("mock exam starts instantly from a package (no generation)", mock.status === 200 && mock.data.status === "ready" && mock.data.reading.length === 4 && mms < 2000, `${mms} ms`);
    const rc = await call(`/api/content/${mock.data.reading[0]}?mode=exam`);
    check("exam mode strips answer keys", rc.data.questions.every((q: { answerIndex: number; explanationVi: string }) => q.answerIndex === -1 && !q.explanationVi));
    const fin = await call(`/api/mock/${mock.data.id}/finish`, {});
    check("mock finishes without waiting on AI", fin.status === 200 && fin.data.status === "done");
  } else {
    check("mock packages report why they are unavailable", (pk.data as { problems: string[] }[]).every((p) => p.problems.length > 0));
  }

  // --- other engine endpoints
  for (const url of ["/api/dashboard", "/api/plan?minutes=60", "/api/analytics", "/api/mistakes?status=due", "/api/weakness", "/api/admin/library", "/api/ai/usage"]) {
    const r = await call(url);
    check(`GET ${url}`, r.status === 200);
  }

  // --- persistence across restart
  const before = (await call("/api/history")).data.length;
  const vocabBefore = (await call("/api/vocab")).data.length;
  await stop();
  await start();
  const after = (await call("/api/history")).data.length;
  const vocabAfter = (await call("/api/vocab")).data.length;
  const settingsAfter = (await call("/api/settings")).data;
  check("progress persists after restart", before === after && vocabBefore === vocabAfter && settingsAfter.allowBrowserVoice === true, `${after} attempts, ${vocabAfter} vocab`);

  await stop();
  console.log(`\n${passed} passed, ${failed} failed. Temp data: ${dataDir}`);
  if (!failed) fs.rmSync(dataDir, { recursive: true, force: true });
  if (log && failed) console.log("\nServer log:\n" + log.slice(0, 3000));
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => { console.error(e); await stop(); process.exit(1); });
