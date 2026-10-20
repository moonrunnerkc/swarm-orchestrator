#!/usr/bin/env node
/**
 * The 2026-10-19 development launch's planning and admission, replayed through a build of Swarm
 * with no live model. Adapted from ../outcome-coverage/d1-replay.mjs: the launch's recorded planner
 * responses instead of D1's, its manifest, its delivered src/rules.ts. Where this says D1 below,
 * read the launch.
 *
 * The planner's 40 recorded responses (text, tool calls and usage, each held for its recorded
 * response time, so planning spends what D1's did on the model) are served in order by the
 * repository's scripted OpenAI-compatible endpoint; the build runs its ordinary command line on a
 * fresh workspace the comparison runner's own helpers prepare from D1's frozen manifest, with D1's
 * flags. Admission runs the recorded check programs for real, on a fresh checkout of the marked
 * base. A revision or review round the build asks for, which D1 never had, is answered by a turn
 * that declares nothing, and is reported. The worker's 40 recorded steps are not replayed: the
 * worker declares src/rules.ts and writes D1's delivered file whole, so the final checks run
 * on D1's exact patch (its digest is compared). That makes this a focused reproduction of
 * planning, admission, the brief, the final checks and the report, not of the worker's search.
 *
 *   node launch-replay.mjs <restored launch sessions> <swarm dist/cli.js> <out directory>
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
if (out === undefined) throw new Error("usage: launch-replay.mjs <restored launch sessions> <dist/cli.js> <out>");
const here = import.meta.dirname;
const d1 = resolve(here, "../outcome-coverage/launch");
const runId = "20261019T234011-b6b0a1";
const manifest = JSON.parse(readFileSync(join(d1, "manifest.json"), "utf8"));
const task = manifest.tasks[0];
const patch = readFileSync(join(d1, "final.patch"), "utf8");
const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
if (digest(patch) !== "sha256:3905e48f32392dd2895a5107c3d682314afe573954cee85a33c6cd84733e26dd")
  throw new Error("the launch's final.patch is not the recorded one");

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
const scratch = mkdtempSync(join(tmpdir(), "launch-replay-"));
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
const delivered = readFileSync(join(patched, "src/rules.ts"), "utf8");

const seen = { planner: 0, revision: 0, review: 0, worker: 0, followUp: 0, other: 0 };
const workerTurns = [
  { toolCalls: [{ name: "declare_file_set", input: { files: ["src/rules.ts"] } }] },
  { toolCalls: [{ name: "write", input: { path: "src/rules.ts", content: delivered } }] },
  { text: "Replayed the launch's delivered change." },
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
  if (text.includes("follow-up the controller owes")) {
    seen.followUp += 1;
    return { text: "No change (scripted: the launch's worker had no follow-up)." };
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
  const child = spawn("node", [resolve(here, "../outcome-coverage/read-launch.mjs"), join(homedir(), ".swarm/sessions"), result?.runId ?? "none"]);
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
const runRecords = (() => {
  try {
    return readFileSync(join(runDir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
      .map((record) => JSON.parse(readFileSync(join(runDir, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8")));
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
  patchMatchesLaunch: digest(delivery) === digest(patch),
  deliveredPatchDigest: digest(delivery),
  status: result?.outcome?.status ?? null,
  plannedChecks: result?.plannedChecks ?? null,
  outcomeUnresolved: result?.outcome?.unresolvedOutcomes ?? null,
  admissions: planRecords.filter((one) => /^planned-check-admission-v\d+$/.test(one?.rule ?? "")).map((one) =>
    one.decisions.map((decision) => ({
      check: decision.check, finding: decision.finding, admitted: decision.admitted,
      thrown: decision.thrown ?? null, disagreements: decision.disagreements, reason: decision.reason,
    }))),
  outcomesRecorded: rule("planned-outcomes-v1"),
  reconciled: planRecords.filter((one) => /^planned-coverage-reconciled-v\d+$/.test(one?.rule ?? "")).at(-1) ?? null,
  revision: planRecords.filter((one) => /^planned-check-revision-v\d+$/.test(one?.rule ?? "")),
  followUp: runRecords.filter((one) => /^outcome-follow-up-v\d+$/.test(one?.rule ?? "")),
  brief: brief.slice(brief.indexOf("Sealed objective:")),
  report: plainLines.some((line) => line.startsWith("outcome:")) ? report : [],
  reading,
};
writeFileSync(join(out, "replay.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ exitCode: ran.code, status: summary.status, patchMatchesLaunch: summary.patchMatchesLaunch, turns: summary.turns, wallMs: summary.wallMs }));
process.exit(ran.code !== null && summary.patchMatchesLaunch ? 0 : 1);
