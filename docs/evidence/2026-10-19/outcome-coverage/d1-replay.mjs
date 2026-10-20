#!/usr/bin/env node
/**
 * D1's planning and admission, replayed through a build of Swarm with no live model.
 *
 * The planner's 40 recorded responses (text, tool calls and usage, each held for its recorded
 * response time, so planning spends what D1's did on the model) are served in order by the
 * repository's scripted OpenAI-compatible endpoint; the build runs its ordinary command line on a
 * fresh workspace the comparison runner's own helpers prepare from D1's frozen manifest, with D1's
 * flags. Admission runs the recorded check programs for real, on a fresh checkout of the marked
 * base. A revision or review round the build asks for, which D1 never had, is answered by a turn
 * that declares nothing, and is reported. The worker's 40 recorded steps are not replayed: the
 * worker declares src/Tokenizer.ts and writes D1's delivered file whole, so the final checks run
 * on D1's exact patch (its digest is compared). That makes this a focused reproduction of
 * planning, admission, the brief, the final checks and the report, not of the worker's search.
 *
 *   node d1-replay.mjs <restored D1 sessions> <swarm dist/cli.js> <out directory>
 *
 * Writes <out>/replay.json (read-launch.mjs over the new chains, plus what this script saw), and
 * <out>/stdout.txt, <out>/stderr.txt. Exits 0 when the run finished and the patch matched.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  swarmArgv,
  swarmChildHomeName,
  swarmContract,
  taskPrompt,
} from "../../../../scripts/comparison/arms.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  finalPatch,
  prepare,
  prepareLaunchHome,
  taskEnvironment,
  writeArmConfiguration,
} from "../../../../scripts/comparison/workspace.mjs";
import { startScriptedEndpoint } from "../../../../src/providers/scripted-endpoint.ts";

const [sessions, cli, out] = process.argv.slice(2);
if (out === undefined) throw new Error("usage: d1-replay.mjs <restored D1 sessions> <dist/cli.js> <out>");
const here = import.meta.dirname;
const d1 = resolve(here, "../coverage-and-reserve/d1");
const runId = "20261019T215306-b22bb8";
const manifest = JSON.parse(readFileSync(join(d1, "manifest.json"), "utf8"));
const task = manifest.tasks[0];
const patch = readFileSync(join(d1, "final.patch"), "utf8");
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
if (digest(patch) !== "sha256:a8f585bcf11619e8403a1ec3c48c5f424019e278b910af3715d063a97e445912")
  throw new Error("D1's final.patch is not the recorded one");

// D1's planner responses, in order, from its own planning chain.
const planDir = join(sessions, `${runId}-plan`);
const records = readFileSync(join(planDir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const payload = (record) => {
  const bytes = readFileSync(join(planDir, "blobs", `${record.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== record.payloadDigest) throw new Error(`blob ${record.payloadDigest} differs`);
  return JSON.parse(bytes.toString());
};
const recorded = records
  .filter((record) => record.type === "model-call")
  .map(payload)
  .map((call) => ({
    text: call.response.text ?? "",
    toolCalls: call.response.toolCalls.map((one) => ({ name: one.toolName, input: one.input })),
    delayMs: Math.round(call.response.performance?.responseTimeMs ?? 0),
    usage: { promptTokens: call.response.inputTokens, completionTokens: call.response.outputTokens },
  }));

const log = commandLog(join(homedir(), ".cache/swarm-comparison/blobs"));
const scratch = mkdtempSync(join(tmpdir(), "d1-replay-"));
const workspace = join(scratch, "workspace");
await cloneAtBase(log, task, task.baseCommit, workspace);
const base = await commitVisibleCheck(log, task, workspace);
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);

// D1's delivered Tokenizer.ts, made by applying its patch to a second checkout of the same base.
const patched = join(scratch, "patched");
await cloneAtBase(log, task, task.baseCommit, patched);
writeFileSync(join(scratch, "d1.patch"), patch);
const applied = await log.run(["git", "apply", join(scratch, "d1.patch")], { cwd: patched, timeoutMs: 60_000 });
if (applied.exitCode !== 0) throw new Error("D1's patch does not apply to the base");
const delivered = readFileSync(join(patched, "src/Tokenizer.ts"), "utf8");

const seen = { planner: 0, revision: 0, review: 0, worker: 0, other: 0 };
const workerTurns = [
  { toolCalls: [{ name: "declare_file_set", input: { files: ["src/Tokenizer.ts"] } }] },
  { toolCalls: [{ name: "write", input: { path: "src/Tokenizer.ts", content: delivered } }] },
  { text: "Replayed D1's delivered change." },
];
const answer = (request) => {
  const text = JSON.stringify(request);
  if (text.includes("You write the acceptance checks")) {
    if (text.includes("were each run once on a fresh checkout of the unchanged base. These were")) {
      seen.revision += 1;
      return { text: "No replacement declared (scripted: D1 had no revision)." };
    }
    if (text.includes("Planning cannot finish until every requirement has a coverage review")) {
      seen.review += 1;
      return { text: "No review declared (scripted: D1 had no review round)." };
    }
    const turn = recorded[seen.planner];
    seen.planner += 1;
    return turn ?? { text: "The recorded planner turns are exhausted." };
  }
  const turn = workerTurns[seen.worker];
  seen.worker += 1;
  return turn ?? { text: "Done." };
};
const endpoint = await startScriptedEndpoint({
  modelId: manifest.pins.model,
  turns: Array.from({ length: 400 }, () => answer),
});

writeArmConfiguration(workspace, "swarm", endpoint.url, manifest.pins.model, task, {});
const home = join(scratch, "home");
prepareLaunchHome(home);
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
const argv = swarmArgv(
  { ...manifest.pins, swarmCli: cli, endpoint: endpoint.url },
  task,
  workspace,
  base,
  taskPrompt(task),
  contractPath,
  manifest.budgets.wallMsPerInvocation,
  manifest.budgets.swarmTokenCap,
);
const started = Date.now();
const ran = await new Promise((done) => {
  const child = spawn(argv[0], argv.slice(1), {
    cwd: workspace,
    env: {
      ...process.env,
      PATH: taskEnvironment(task).PATH,
      PWD: workspace,
      PUPPETEER_SKIP_DOWNLOAD: "true",
      [swarmChildHomeName]: home,
    },
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("close", (code) => done({ code, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }));
});
await endpoint.close();
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "stdout.txt"), ran.stdout);
writeFileSync(join(out, "stderr.txt"), ran.stderr);
const result = ran.stdout.trim().split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } })
  .findLast((line) => line?.schema !== "swarm.event.v1" && line?.runId !== undefined) ?? null;
const delivery = await finalPatch(log, workspace, base);
const reading = await new Promise((done) => {
  const child = spawn("node", [resolve(here, "../coverage-and-reserve/read-launch.mjs"), join(homedir(), ".swarm/sessions"), result?.runId ?? "none"]);
  const chunks = [];
  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.on("close", (code) => done(code === 0 ? JSON.parse(Buffer.concat(chunks).toString()) : null));
});
const runDir = join(homedir(), ".swarm/sessions", result?.runId ?? "none");
const planRecords = (() => {
  try {
    const dir = `${runDir}-plan`;
    return readFileSync(join(dir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
      .map((record) => JSON.parse(readFileSync(join(dir, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8")));
  } catch { return []; }
})();
const brief = (() => {
  try {
    const started = readFileSync(join(runDir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
      .find((record) => record.type === "session-started");
    return JSON.parse(readFileSync(join(runDir, "blobs", `${started.payloadDigest.slice(7)}.json`), "utf8")).task ?? "";
  } catch { return ""; }
})();
// The outcome block the product printed, as plain lines among the JSON events.
const plainLines = ran.stdout.split("\n").filter((line) => !line.startsWith("{"));
const report = plainLines.slice(plainLines.findIndex((line) => line.startsWith("outcome:")));
const rule = (name) => planRecords.filter((one) => one?.rule === name);
const summary = {
  build: cli,
  wallMs: Date.now() - started,
  exitCode: ran.code,
  turns: { ...seen, recordedPlanner: recorded.length },
  patchMatchesD1: digest(delivery) === digest(patch),
  deliveredPatchDigest: digest(delivery),
  status: result?.outcome?.status ?? null,
  plannedChecks: result?.plannedChecks ?? null,
  outcomeUnresolved: result?.outcome?.unresolvedOutcomes ?? null,
  admissions: [...rule("planned-check-admission-v3"), ...rule("planned-check-admission-v4")].map((one) =>
    one.decisions.map((decision) => ({
      check: decision.check, finding: decision.finding, admitted: decision.admitted,
      thrown: decision.thrown ?? null, disagreements: decision.disagreements, reason: decision.reason,
    }))),
  outcomesRecorded: rule("planned-outcomes-v1"),
  reconciled: [...rule("planned-coverage-reconciled-v1"), ...rule("planned-coverage-reconciled-v2")].at(-1) ?? null,
  revision: rule("planned-check-revision-v1"),
  brief: brief.slice(brief.indexOf("Sealed objective:")),
  report: plainLines.some((line) => line.startsWith("outcome:")) ? report : [],
  reading,
};
writeFileSync(join(out, "replay.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ exitCode: ran.code, status: summary.status, patchMatchesD1: summary.patchMatchesD1, turns: summary.turns, wallMs: summary.wallMs }));
process.exit(ran.code !== null && summary.patchMatchesD1 ? 0 : 1);
