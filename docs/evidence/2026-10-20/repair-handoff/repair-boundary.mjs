#!/usr/bin/env node
/**
 * One launch of Swarm that starts at the documented repair boundary of run 20261020T045117-41e2cc:
 * the retained incorrect candidate in place, the first repair attempt's recorded calls replayed
 * through the real chokepoint, and the second attempt live.
 *
 * The product runs unmodified from its ordinary command line, with the recorded sealed goal
 * contract (the visible check and the planner's two generated checks, so the gates are the ones the
 * trial had) and no planning. Its model endpoint is a proxy: the first three chat completions are
 * answered by the repository's scripted endpoint with a worker that declares src/rules.ts, writes
 * the candidate's exact bytes and finishes; the next forty are the first repair attempt's recorded
 * responses, in order, each tool call run for real so the attempt's conversation, and so the account
 * the production builder derives from it, is the product's own; every chat completion after that
 * goes to the local model server (live) or to a stub that proposes nothing (rehearsal). Nothing
 * else differs between the arms but the build: the control build's account builder is the
 * previous revision's and the treatment build's carries the recent shell results.
 *
 * The delivered tree is then scored apart: the comparison runner's visible and hidden verdicts,
 * the frozen behaviour probe, and the product's own report, with the product's chains copied out.
 *
 *   node repair-boundary.mjs --arm control|treatment --build <commit> --sessions <restored trial
 *     sessions> --out <dir> --mode rehearsal|live [--wall-minutes 7] [--launch-cap-ms 600000]
 *     [--upstream http://127.0.0.1:11434/v1] [--model qwen3.6:35b-a3b]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  swarmArgv,
  swarmChildHomeName,
  swarmEvidenceDirectory,
  swarmResult,
  swarmTokenCap,
  swarmTokens,
  swarmUsage,
  taskPrompt,
} from "../../../../scripts/comparison/arms.mjs";
import { hiddenVerdict, visibleVerdict } from "../../../../scripts/comparison/checks.mjs";
import { createInferenceLease, establishReadiness } from "../../../../scripts/comparison/inference.mjs";
import { createStallWatch, pollStallWatch } from "../../../../scripts/comparison/stall.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  finalPatch,
  prepare,
  prepareLaunchHome,
  taskEnvironment,
  workRoot,
  writeArmConfiguration,
} from "../../../../scripts/comparison/workspace.mjs";
import { startScriptedEndpoint } from "../../../../src/providers/scripted-endpoint.ts";

const { values } = parseArgs({
  options: {
    arm: { type: "string" },
    build: { type: "string" },
    sessions: { type: "string" },
    out: { type: "string" },
    mode: { type: "string" },
    "wall-minutes": { type: "string", default: "7" },
    "launch-cap-ms": { type: "string", default: "600000" },
    upstream: { type: "string", default: "http://127.0.0.1:11434/v1" },
    model: { type: "string", default: "qwen3.6:35b-a3b" },
  },
});
for (const name of ["arm", "build", "sessions", "out", "mode"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
if (!["control", "treatment"].includes(values.arm)) throw new Error("--arm is control or treatment");
if (!["rehearsal", "live"].includes(values.mode)) throw new Error("--mode is rehearsal or live");
const here = import.meta.dirname;
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const wallMinutes = Number(values["wall-minutes"]);
const launchCapMs = Number(values["launch-cap-ms"]);
const record = {
  schema: "repair-boundary-launch.v1",
  arm: values.arm,
  mode: values.mode,
  build: values.build,
  model: values.model,
  startedAt: new Date().toISOString(),
  wallMinutes,
  launchCapMs,
  notes: [],
};

// The trial's frozen task and the run's recorded sealed goal contract, read and checked.
const trial = resolve(here, "../../2026-10-19/endpoint-readiness-trial");
const manifest = JSON.parse(readFileSync(join(trial, "manifest-plan-checks.json"), "utf8"));
const task = manifest.tasks[0];
if (task.id !== "marked-bugfix-www-case") throw new Error("the trial manifest's task is not the expected one");
const runId = "20261020T045117-41e2cc";
const runDir = join(values.sessions, runId);
const records = readFileSync(join(runDir, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
const payload = (seq) => {
  const r = records[seq];
  const bytes = readFileSync(join(runDir, "blobs", `${r.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== r.payloadDigest) throw new Error(`blob of R ${seq} differs from its record`);
  return JSON.parse(bytes.toString());
};
if (records[3].type !== "goal-contract") throw new Error("R 3 is not the goal contract");
const sealed = payload(3);
record.recordedGoalContractDigest = sealed.digest;
const candidatePatch = readFileSync(join(trial, "launch-1/final.patch"), "utf8");
if (digest(candidatePatch) !== "sha256:8efc2f36d0eff9a9e95eba5e66238c828951be56f9adaad62fd3cfd895077c1b")
  throw new Error("the trial's final.patch is not the recorded one");

// The first repair attempt's forty recorded responses (R 221 to R 489), in order.
const attemptOne = records
  .filter((r) => r.type === "model-call" && r.sequence > 221 && r.sequence < 489)
  .map((r) => payload(r.sequence).response)
  .map((response) => ({
    text: response.text ?? "",
    toolCalls: response.toolCalls.map((one) => ({ name: one.toolName, input: one.input })),
    usage: { promptTokens: response.inputTokens, completionTokens: response.outputTokens },
  }));
if (attemptOne.length !== 40) throw new Error(`expected 40 recorded responses, found ${attemptOne.length}`);
record.replayedAttemptOneTurns = attemptOne.length;

// The workspace: the task's base with the visible check committed, prepared as every launch is.
const log = commandLog(join(comparisonRoot, "blobs"));
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, `repair-handoff-${values.arm}-`));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
record.scratch = scratch;
await cloneAtBase(log, task, task.baseCommit, workspace);
const base = await commitVisibleCheck(log, task, workspace);
record.base = base;
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.failed.join(" ")}\n${prepared.detail}`);

// The candidate's exact bytes: the patch applied to the base's rules.ts, then the file restored,
// so the product's own scripted worker is what puts the candidate in place.
const patchPath = join(scratch, "candidate.patch");
writeFileSync(patchPath, candidatePatch);
const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: workspace });
if (applied.status !== 0) throw new Error(`the candidate does not apply: ${applied.stderr}`);
const candidate = readFileSync(join(workspace, "src/rules.ts"), "utf8");
spawnSync("git", ["checkout", "--", "src/rules.ts"], { cwd: workspace });
record.candidateFileDigest = digest(candidate);
if (record.candidateFileDigest !== "sha256:c695f84b80871fe4f1863a363f1d3cc56228c7ca2bcca6ca7b1a72b9d633533d")
  throw new Error("the candidate's bytes are not the retained workspace's");
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, JSON.stringify(sealed.contract, null, 2));

// The model endpoint the product sees: scripted first, then the live server or the stub.
const scripted = await startScriptedEndpoint({
  modelId: values.model,
  turns: [
    { toolCalls: [{ name: "declare_file_set", input: { files: ["src/rules.ts"] } }] },
    { toolCalls: [{ name: "write", input: { path: "src/rules.ts", content: candidate } }] },
    { text: "The change is in src/rules.ts." },
    ...attemptOne,
  ],
});
const scriptedTurns = 3 + attemptOne.length;
const stub =
  values.mode === "rehearsal"
    ? await startScriptedEndpoint({
        modelId: values.model,
        turns: Array.from({ length: 12 }, () => ({ text: "No repair found." })),
      })
    : null;
const upstream = stub?.url ?? values.upstream;
const routed = [];
let chatCompletions = 0;
const proxy = createServer((request, response) => {
  const path = (request.url ?? "").split("?")[0];
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", async () => {
    const isChat = request.method === "POST" && path === "/v1/chat/completions";
    if (isChat) chatCompletions += 1;
    const sequence = chatCompletions;
    const target = isChat && sequence > scriptedTurns ? upstream : scripted.url;
    const route = target === scripted.url ? "scripted" : values.mode === "rehearsal" ? "stub" : "upstream";
    const started = Date.now();
    const entry = { sequence: isChat ? sequence : null, path, route, startedAt: new Date(started).toISOString() };
    routed.push(entry);
    // The upstream request is abandoned only when the product closes its side before the answer
    // is complete: the request stream's own close fires as soon as its body has been read.
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    try {
      const body = Buffer.concat(chunks);
      if (isChat && sequence === scriptedTurns + 1) {
        const parsed = JSON.parse(body.toString("utf8"));
        const lastUser = [...(parsed.messages ?? [])].reverse().find((one) => one.role === "user");
        entry.firstHandedOverPrompt = typeof lastUser?.content === "string" ? lastUser.content.slice(0, 400) : null;
      }
      const forwarded = await fetch(`${target}${path.replace(/^\/v1/, "")}`, {
        method: request.method,
        headers: { "content-type": request.headers["content-type"] ?? "application/json" },
        body: request.method === "POST" ? body : undefined,
        signal: abort.signal,
      });
      entry.status = forwarded.status;
      entry.firstByteMs = Date.now() - started;
      response.writeHead(forwarded.status, {
        "content-type": forwarded.headers.get("content-type") ?? "application/json",
        "cache-control": "no-cache",
      });
      if (forwarded.body) for await (const chunk of forwarded.body) response.write(chunk);
      response.end();
    } catch (error) {
      entry.error = String(error?.message ?? error);
      if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: entry.error } }));
    } finally {
      entry.wallMs = Date.now() - started;
    }
  });
});
await new Promise((ready) => proxy.listen(0, "127.0.0.1", ready));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}/v1`;
record.endpoint = { proxy: proxyUrl, scripted: scripted.url, upstream, scriptedTurns };

writeArmConfiguration(workspace, "swarm", proxyUrl, values.model, task);
prepareLaunchHome(home);
const lease = createInferenceLease();

// Live only: the server must complete inference, in the product's own wire shape, before dispatch.
if (values.mode === "live") {
  const readiness = await establishReadiness({ endpoint: values.upstream, model: values.model, lease });
  record.readiness = readiness;
  if (!readiness.ok) {
    record.outcome = "not launched: readiness failed";
    finish();
    process.exit(3);
  }
}

const pins = {
  model: values.model,
  endpoint: proxyUrl,
  swarmCli: join(homedir(), `.cache/swarm-comparison/tools/swarm-${values.build}/dist/cli.js`),
  swarmFlags: [],
};
if (!existsSync(pins.swarmCli)) throw new Error(`${pins.swarmCli} is not built`);
record.swarmCliDigest = digest(readFileSync(pins.swarmCli));
record.swarmDistTree = distTreeDigest(join(pins.swarmCli, ".."));
const argv = swarmArgv(pins, task, workspace, base, taskPrompt(task), contractPath, wallMinutes * 60_000, swarmTokenCap);
record.argv = argv.map((word) => (word === taskPrompt(task) ? "<prompt>" : word));

const watch = new AbortController();
const stallWatch = createStallWatch();
let stalled = null;
const stopStallWatch = pollStallWatch(stallWatch, {
  onStall: (reason, at) => {
    stalled = { reason, at: at.toISOString() };
    watch.abort(new Error(`stall: ${reason}`));
  },
});
const release = lease.hold(`${values.arm} launch`);
const launchStarted = Date.now();
let ran;
try {
  ran = await log.run(argv, {
    cwd: workspace,
    timeoutMs: launchCapMs,
    killConfirmMs: 60_000,
    signal: watch.signal,
    onStdout: (chunk) => stallWatch.observe(chunk),
    env: {
      ...process.env,
      PATH: taskEnvironment(task).PATH,
      PWD: workspace,
      PUPPETEER_SKIP_DOWNLOAD: "true",
      [swarmChildHomeName]: home,
    },
  });
} finally {
  stopStallWatch();
  release();
}
const stdout = ran.stdout.toString();
writeFileSync(join(out, "stdout.txt"), stdout);
writeFileSync(join(out, "stderr.txt"), ran.stderr.toString());
record.invocation = {
  exitCode: ran.exitCode,
  signal: ran.signal,
  wallMs: ran.wallMs ?? Date.now() - launchStarted,
  tokens: swarmTokens(stdout),
  usage: swarmUsage(stdout),
  result: swarmResult(stdout),
  stalled,
  termination: ran.termination ?? null,
};
record.proxy = { routed, scriptedPlayed: scripted.played(), stubPlayed: stub?.played() ?? null };

// The product's own chains, copied beside this record.
const evidenceDirectory = swarmEvidenceDirectory(stdout);
record.evidenceDirectory = evidenceDirectory;
if (evidenceDirectory !== null && existsSync(evidenceDirectory)) {
  const name = evidenceDirectory.split("/").at(-1);
  cpSync(evidenceDirectory, join(out, "sessions", name), { recursive: true });
  record.runChain = readChain(join(out, "sessions", name));
}

// The delivered tree, scored apart.
const patch = await finalPatch(log, workspace, base);
writeFileSync(join(out, "final.patch"), patch);
record.finalPatch = { digest: digest(patch), bytes: Buffer.byteLength(patch), sameAsCandidate: digest(patch) === digest(candidatePatch) };
const visible = await visibleVerdict(log, task, task.baseCommit, patch);
record.visible = { passed: visible.passed, checkExit: visible.checkExit, projectTestExit: visible.projectTestExit, detail: visible.detail.slice(0, 2000) };
const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
record.hidden = { verdict: hidden.verdict, basis: hidden.basis, detail: (hidden.detail ?? "").slice(0, 2000) };
const probeOut = join(out, "probe.json");
const probed = spawnSync(
  process.execPath,
  [
    join(here, "../../2026-10-19/requested-example/behaviour-probe.mjs"),
    "--patch",
    join(out, "final.patch"),
    "--reference",
    join(here, "../../2026-10-19/requested-example/probe/upstream.json"),
    "--out",
    probeOut,
  ],
  { encoding: "utf8", cwd: resolve(here, "../../../.."), timeoutMs: 900_000 },
);
record.probe = {
  exitCode: probed.status,
  stderr: (probed.stderr ?? "").slice(-1500),
  summary: existsSync(probeOut) ? summarizeProbe(JSON.parse(readFileSync(probeOut, "utf8"))) : null,
};
record.endedAt = new Date().toISOString();
record.outcome = "launched";
finish();
await scripted.close();
await stub?.close();
proxy.close();
console.log(JSON.stringify({ arm: record.arm, mode: record.mode, exitCode: record.invocation.exitCode, wallMs: record.invocation.wallMs, tokens: record.invocation.tokens, scriptedPlayed: record.proxy.scriptedPlayed, handedOver: record.proxy.routed.find((one) => one.firstHandedOverPrompt)?.firstHandedOverPrompt?.slice(0, 120) ?? null, finalPatchSameAsCandidate: record.finalPatch.sameAsCandidate, visible: record.visible.passed, hidden: record.hidden.verdict, probe: record.probe.summary, loops: record.runChain?.loops ?? null }, null, 1));

function finish() {
  writeFileSync(join(out, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
}

function summarizeProbe(probe) {
  if (!Array.isArray(probe.behaviours)) return null;
  return probe.behaviours.map((one) => ({ id: one.id, matchesUpstream: one.matchesUpstream }));
}

/** What the product's run chain says: each loop's stop, the briefs the repairs were handed, the verdicts. */
function readChain(directory) {
  const lines = readFileSync(join(directory, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const blob = (r) => {
    const bytes = readFileSync(join(directory, "blobs", `${r.payloadDigest.slice(7)}.json`));
    if (digest(bytes) !== r.payloadDigest) throw new Error(`blob of ${r.sequence} differs`);
    return JSON.parse(bytes.toString());
  };
  const loops = lines
    .filter((r) => r.type === "session-stopped")
    .map((r) => {
      const p = blob(r);
      return { sequence: r.sequence, stopReason: p.stopReason, steps: p.steps, tokensUsed: p.tokensUsed, repair: p.repair === true, withheld: p.stopReason === "repair-withheld", priorLoopNotes: p.priorLoopNotes ?? null };
    });
  const briefs = lines
    .filter((r) => r.type === "transcript-component")
    .map((r) => ({ sequence: r.sequence, p: blob(r) }))
    .filter(({ p }) => p.kind === "message" && p.value.role === "user" && /This is attempt \d+ of \d+/.test(p.value.text))
    .map(({ sequence, p }) => ({ sequence, attempt: Number(/This is attempt (\d+) of/.exec(p.value.text)[1]), text: p.value.text }));
  for (const brief of briefs) writeFileSync(join(out, `attempt-${brief.attempt}-brief.txt`), `${brief.text}\n`);
  const goalContract = lines.find((r) => r.type === "goal-contract");
  const ratchets = lines.filter((r) => r.type === "ratchet-decision").map((r) => ({ sequence: r.sequence, ...pick(blob(r), ["accepted", "decision", "attempt", "reason"]) }));
  const escalation = lines.filter((r) => r.type === "escalation").map((r) => pick(blob(r), ["attemptsUsed", "cap", "gateId", "attemptsRejectedByRatchet"]));
  const assessments = lines.filter((r) => r.type === "run-assessment").map((r) => blob(r));
  const edits = lines
    .filter((r) => r.type === "tool-call")
    .map((r) => blob(r))
    .filter((p) => p.decision === "allowed" && (p.toolName === "edit" || p.toolName === "write"))
    .map((p) => ({ toolName: p.toolName, path: p.input?.path, output: String(p.output).slice(0, 120) }));
  return {
    records: lines.length,
    goalContractDigest: goalContract ? blob(goalContract).digest : null,
    loops,
    briefs: briefs.map((one) => ({ sequence: one.sequence, attempt: one.attempt, chars: one.text.length, carriesRecentShellResults: one.text.includes("printed something and exited 0") })),
    ratchets,
    escalation,
    assessments: assessments.map((one) => pick(one, ["rule", "status", "task", "behavioral", "regression", "outcome", "verdict"])),
    edits,
    modelCalls: lines.filter((r) => r.type === "model-call").length,
  };
}

/** The sorted per-file SHA-256 list of `dist/`, hashed: the whole built tree's identity. */
function distTreeDigest(root) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  files.sort();
  const list = files.map((path) => `${digest(readFileSync(path))}  ${relative(root, path)}`).join("\n");
  return { digest: digest(`${list}\n`), files: files.length };
}

function pick(object, keys) {
  return Object.fromEntries(keys.filter((key) => key in (object ?? {})).map((key) => [key, object[key]]));
}
