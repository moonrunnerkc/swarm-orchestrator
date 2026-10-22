#!/usr/bin/env node
/**
 * One launch of Swarm that starts at the repair boundary of the 2026-10-21 alias launch (session
 * 20261021T214114-aa33a0): the retained faulty candidate in place, every repair live.
 *
 * The product runs unmodified from its ordinary command line, with the launch's recorded sealed
 * goal contract (the visible check) and the same 9-minute wall, 40-step loops and 3 attempts. Its
 * model endpoint is a proxy: the first three chat completions are answered by the repository's
 * scripted endpoint with a worker that declares the two files the launch declared, writes the
 * candidate's exact bytes to lib/cli/parse-args.js and finishes; every chat completion after that
 * goes to the local model server. The arms differ in one flag: `treatment` passes --repair-trace.
 *
 * The delivered tree is scored apart: the comparison runner's visible and hidden verdicts (the
 * frozen evaluation), the 2026-10-22 expanded preservation check, the regression-test scorer, and
 * the product's own report, with the product's chain copied out.
 *
 *   node alias-repair-boundary.mjs --arm control|treatment --build <commit> --session <restored
 *     launch-3 session directory> --out <dir> [--wall-minutes 9] [--launch-cap-ms 600000]
 *     [--upstream http://127.0.0.1:11434/v1] [--model qwen3.6:35b-a3b]
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
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
    "treatment-flag": { type: "string", default: "repair-trace" },
    session: { type: "string" },
    out: { type: "string" },
    "wall-minutes": { type: "string", default: "9" },
    "launch-cap-ms": { type: "string", default: "600000" },
    upstream: { type: "string", default: "http://127.0.0.1:11434/v1" },
    model: { type: "string", default: "qwen3.6:35b-a3b" },
  },
});
for (const name of ["arm", "build", "session", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
if (!["control", "treatment"].includes(values.arm)) throw new Error("--arm is control or treatment");
if (!["repair-trace", "repair-finish"].includes(values["treatment-flag"])) throw new Error("unsupported treatment flag");
const here = import.meta.dirname;
const stage = resolve(here, "../../2026-10-21/fresh-comparison");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const wallMinutes = Number(values["wall-minutes"]);
const launchCapMs = Number(values["launch-cap-ms"]);
const record = {
  schema: "alias-repair-boundary-launch.v1",
  arm: values.arm,
  build: values.build,
  model: values.model,
  startedAt: new Date().toISOString(),
  wallMinutes,
  launchCapMs,
};

// The stage's frozen task, and the launch's recorded sealed goal contract, read and checked.
const manifest = JSON.parse(readFileSync(join(stage, "manifest.json"), "utf8"));
const task = manifest.tasks.find((one) => one.id === "mocha-bugfix-long-prefix-short-alias");
if (task === undefined) throw new Error("the stage manifest has no alias task");
const records = readFileSync(join(values.session, "ledger.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
const payload = (sequence) => {
  const entry = records[sequence];
  const bytes = readFileSync(join(values.session, "blobs", `${entry.payloadDigest.slice(7)}.json`));
  if (digest(bytes) !== entry.payloadDigest) throw new Error(`blob of R ${sequence} differs from its record`);
  return JSON.parse(bytes.toString());
};
if (records[2].type !== "goal-contract") throw new Error("R 2 is not the goal contract");
const sealed = payload(2);
record.recordedGoalContractDigest = sealed.digest;

// The retained candidate: the launch's delivered patch, which is its first candidate.
const candidatePatch = readFileSync(
  join(values.session, "../../patches/mocha-bugfix-long-prefix-short-alias.swarm.patch"),
  "utf8",
);
if (digest(candidatePatch) !== "sha256:fa5bce2fd91a7fe83cc604c99bf6cdadfa33d6884d43d0a92c8fc1c1de8bc2af")
  throw new Error("the retained patch is not the published one");

// The workspace: the task's base with the visible check committed, prepared as every launch is.
const log = commandLog(join(comparisonRoot, "blobs"));
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, `alias-repair-${values.arm}-`));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
record.scratch = scratch;
await cloneAtBase(log, task, task.baseCommit, workspace);
const base = await commitVisibleCheck(log, task, workspace);
record.base = base;
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.failed.join(" ")}\n${prepared.detail}`);

// The candidate's exact bytes, put in place by the product's own scripted worker.
const patchPath = join(scratch, "candidate.patch");
writeFileSync(patchPath, candidatePatch);
const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: workspace });
if (applied.status !== 0) throw new Error(`the candidate does not apply: ${applied.stderr}`);
const candidate = readFileSync(join(workspace, "lib/cli/parse-args.js"), "utf8");
spawnSync("git", ["checkout", "--", "lib/cli/parse-args.js"], { cwd: workspace });
record.candidateFileDigest = digest(candidate);
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, JSON.stringify(sealed.contract, null, 2));

const scripted = await startScriptedEndpoint({
  modelId: values.model,
  turns: [
    {
      toolCalls: [
        {
          name: "declare_file_set",
          input: { files: ["lib/cli/parse-args.js", "test/node-unit/cli/parse-args.spec.js"] },
        },
      ],
    },
    { toolCalls: [{ name: "write", input: { path: "lib/cli/parse-args.js", content: candidate } }] },
    { text: "The change is in lib/cli/parse-args.js." },
  ],
});
const scriptedTurns = 3;
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
    const target = isChat && sequence > scriptedTurns ? values.upstream : scripted.url;
    const entry = {
      sequence: isChat ? sequence : null,
      path,
      route: target === scripted.url ? "scripted" : "upstream",
      startedAt: new Date().toISOString(),
    };
    routed.push(entry);
    const started = Date.now();
    const abort = new AbortController();
    response.on("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    try {
      const body = Buffer.concat(chunks);
      const forwarded = await fetch(`${target}${path.replace(/^\/v1/, "")}`, {
        method: request.method,
        headers: { "content-type": request.headers["content-type"] ?? "application/json" },
        body: request.method === "POST" ? body : undefined,
        signal: abort.signal,
      });
      entry.status = forwarded.status;
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
record.endpoint = { proxy: proxyUrl, scripted: scripted.url, upstream: values.upstream, scriptedTurns };

writeArmConfiguration(workspace, "swarm", proxyUrl, values.model, task);
prepareLaunchHome(home);
const lease = createInferenceLease();
const readiness = await establishReadiness({ endpoint: values.upstream, model: values.model, lease });
record.readiness = readiness;
if (!readiness.ok) {
  record.outcome = "not launched: readiness failed";
  finish();
  process.exit(3);
}

const pins = {
  model: values.model,
  endpoint: proxyUrl,
  swarmCli: join(homedir(), `.cache/swarm-comparison/tools/swarm-${values.build}/dist/cli.js`),
  swarmFlags: values.arm === "treatment" ? [`--${values["treatment-flag"]}`] : [],
};
if (!existsSync(pins.swarmCli)) throw new Error(`${pins.swarmCli} is not built`);
record.swarmCliDigest = digest(readFileSync(pins.swarmCli));
record.swarmDistTree = distTreeDigest(join(pins.swarmCli, ".."));
const prompt = taskPrompt(task);
const argv = swarmArgv(pins, task, workspace, base, prompt, contractPath, wallMinutes * 60_000, swarmTokenCap);
record.argv = argv.map((word) => (word === prompt ? "<prompt>" : word));
record.promptDigest = digest(prompt);

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
record.proxy = { routed, scriptedPlayed: scripted.played() };

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
record.finalPatch = {
  digest: digest(patch),
  bytes: Buffer.byteLength(patch),
  // Whether the delivered source file is still the retained candidate, byte for byte.
  candidateSourceKept:
    digest(readFileSync(join(workspace, "lib/cli/parse-args.js"), "utf8")) === record.candidateFileDigest,
};
const visible = await visibleVerdict(log, task, task.baseCommit, patch);
record.visible = {
  passed: visible.passed,
  checkExit: visible.checkExit,
  projectTestExit: visible.projectTestExit,
  detail: visible.detail.slice(0, 2000),
};
const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
record.hidden = { verdict: hidden.verdict, basis: hidden.basis, detail: (hidden.detail ?? "").slice(0, 2000) };
record.endedAt = new Date().toISOString();
record.outcome = "launched";
finish();
await scripted.close();
proxy.close();
console.log(
  JSON.stringify(
    {
      arm: record.arm,
      exitCode: record.invocation.exitCode,
      wallMs: record.invocation.wallMs,
      tokens: record.invocation.tokens,
      finalPatchDigest: record.finalPatch.digest,
      visible: record.visible.passed,
      hidden: record.hidden.verdict,
      loops: record.runChain?.loops ?? null,
    },
    null,
    1,
  ),
);

function finish() {
  writeFileSync(join(out, "record.json"), `${JSON.stringify(record, null, 2)}\n`);
}

/** What the product's chain says: each loop's stop, the briefs, the trace notices, the edits, the comparisons. */
function readChain(directory) {
  const lines = readFileSync(join(directory, "ledger.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const blob = (entry) => {
    const bytes = readFileSync(join(directory, "blobs", `${entry.payloadDigest.slice(7)}.json`));
    if (digest(bytes) !== entry.payloadDigest) throw new Error(`blob of ${entry.sequence} differs`);
    return JSON.parse(bytes.toString());
  };
  const loops = lines
    .filter((entry) => entry.type === "session-stopped")
    .map((entry) => {
      const p = blob(entry);
      return { sequence: entry.sequence, stopReason: p.stopReason, steps: p.steps, tokensUsed: p.tokensUsed, repair: p.repair === true };
    });
  const briefs = lines
    .filter((entry) => entry.type === "transcript-component")
    .map((entry) => ({ sequence: entry.sequence, p: blob(entry) }))
    .filter(({ p }) => p.kind === "message" && p.value.role === "user" && /This is attempt \d+ of \d+/.test(p.value.text))
    .map(({ sequence, p }) => ({ sequence, attempt: Number(/This is attempt (\d+) of/.exec(p.value.text)[1]), text: p.value.text }));
  for (const brief of briefs) writeFileSync(join(out, `attempt-${brief.attempt}-brief.txt`), `${brief.text}\n`);
  const calls = lines
    .filter((entry) => entry.type === "tool-call")
    .map((entry) => ({ sequence: entry.sequence, p: blob(entry) }))
    .filter(({ p }) => p.decision === "allowed");
  return {
    records: lines.length,
    loops,
    briefs: briefs.map((one) => ({
      sequence: one.sequence,
      attempt: one.attempt,
      chars: one.text.length,
      carriesTrace: one.text.includes("preservation-trace-v1"),
    })),
    traceNotices: lines
      .filter((entry) => entry.type === "verification-command")
      .map((entry) => blob(entry))
      .filter((p) => p.rule === "preservation-trace-v1")
      .map((p) => ({ attempt: p.attempt, passingAtBase: p.passingAtBase })),
    comparedWithBase: calls.filter(({ p }) => p.toolName === "run_check" && p.input?.compare_base === true).length,
    ratchets: lines
      .filter((entry) => entry.type === "ratchet-decision")
      .map((entry) => ({ sequence: entry.sequence, ...pick(blob(entry), ["accepted", "attempt", "detail"]) })),
    assessments: lines
      .filter((entry) => entry.type === "run-assessment")
      .map((entry) => pick(blob(entry), ["inputs", "verdict"])),
    edits: calls
      .filter(({ p }) => p.toolName === "edit" || p.toolName === "write")
      .map(({ sequence, p }) => ({ sequence, toolName: p.toolName, path: p.input?.path })),
    modelCalls: lines.filter((entry) => entry.type === "model-call").length,
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
