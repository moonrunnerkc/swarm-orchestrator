#!/usr/bin/env node
/**
 * Seeded-candidate fault injection on a live run: one ordinary `swarm --plan-checks` invocation on
 * the original base of an exposed development task, through a recording proxy in front of the
 * local model server.
 *
 * - **Live:** every planner request (check planning, its revision) and every repair request goes
 *   to the real model unchanged, and its answer comes back unchanged.
 * - **Seeded:** the requests of the first implementation loop only are answered by the proxy
 *   itself, with a `declare_file_set` and `write` of the files Swarm's own retained faulty patch
 *   produced, then "Done.". The candidate is therefore the retained patch, written through the
 *   product's tools onto the original base, so the run's diff against that base is the real one.
 * - **Captured before the candidate exists:** when the first seeded request arrives, planning and
 *   admission are over; the proxy then copies the planning chain's admitted contract and the
 *   planner's declarations into the output before answering.
 *
 * This shows whether live planning finds the omission the retained patch made and whether a live
 * repair fixes it from the product's own failure feedback. It does not show that an unseeded run
 * would take that trajectory: the first candidate is injected.
 *
 *   node run.mjs --swarm-cli <dist/cli.js> --task mime|tar --out <dir>
 *     [--endpoint http://127.0.0.1:11434/v1] [--model qwen3.6:35b-a3b] [--deadline-minutes 15]
 */
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { commandLog } from "../../../../../scripts/campaign/exec.mjs";
import { swarmContract, swarmTokenCap } from "../../../../../scripts/comparison/arms.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  resolveFull,
  swarmConfigurationText,
  taskEnvironment,
  workRoot,
} from "../../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../../scripts/pilot/tasks-2026-10-17.mjs";

const { values } = parseArgs({
  options: {
    "swarm-cli": { type: "string" },
    task: { type: "string" },
    out: { type: "string" },
    endpoint: { type: "string", default: "http://127.0.0.1:11434/v1" },
    model: { type: "string", default: "qwen3.6:35b-a3b" },
    "deadline-minutes": { type: "string", default: "15" },
  },
});
const cases = {
  mime: {
    id: "mime-bugfix-gettype-line-terminators",
    faulty: "2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
    gates: { lint: { command: "npm run --loglevel=error lint", severity: "advisory" } },
  },
  tar: {
    id: "tar-bugfix-negative-size",
    faulty: "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r2.swarm.patch",
    gates: {},
  },
};
const chosen = cases[values.task ?? ""];
if (values["swarm-cli"] === undefined || values.out === undefined || chosen === undefined)
  throw new Error("usage: run.mjs --swarm-cli <dist/cli.js> --task mime|tar --out <dir>");
const swarmCli = resolve(values["swarm-cli"]);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);
const deadlineMs = Number(values["deadline-minutes"]) * 60_000;
const task = tasks.find((one) => one.id === chosen.id);
const faultyPatch = readFileSync(new URL(`../../../${chosen.faulty}`, import.meta.url), "utf8");
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
);

const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, `seeded-${values.task}-`));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
mkdirSync(home, { recursive: true, mode: 0o700 });

// The files the retained patch produces, read from a throwaway copy of the same base.
const copy = join(scratch, "faulty-copy");
await cloneAtBase(log, task, resolved.base, copy);
if (!(await applyPatch(log, copy, faultyPatch))) throw new Error("the retained patch does not apply");
const seededFiles = [...faultyPatch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
const seededWrites = seededFiles.map((path) => ({
  name: "write",
  input: { path, content: readFileSync(join(copy, path), "utf8") },
}));

await cloneAtBase(log, task, resolved.base, workspace);
const base = await commitVisibleCheck(log, task, workspace);
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);

// The seeded first loop: what the proxy answers in place of the model, and nothing else.
const seeded = await startScriptedEndpoint({
  modelId: values.model,
  turns: [
    {
      text: "Writing the change.",
      toolCalls: [{ name: "declare_file_set", input: { files: seededFiles } }, ...seededWrites],
    },
    { text: "Done." },
  ],
});

const firstUser = (body) =>
  (body?.messages ?? []).find((message) => message.role === "user")?.content ?? "";
const systemOf = (body) =>
  (body?.messages ?? []).find((message) => message.role === "system")?.content ?? "";
/** The first implementation loop's requests, by their brief: the task itself, not a planner's or a repair's. */
const isInitialImplementation = (body) =>
  typeof firstUser(body) === "string" &&
  firstUser(body).startsWith(task.taskText.trim().slice(0, 80)) &&
  !String(systemOf(body)).startsWith("You write the acceptance checks") &&
  !JSON.stringify(body?.messages ?? []).includes("A quality gate is failing");

const exchanges = [];
let captured = null;
let seededDone = false;
const upstream = new URL(values.endpoint);
const seededUrl = new URL(seeded.url);

/** The planning chain's declarations and admission, copied the moment the candidate is first asked for. */
function captureGeneratedChecks() {
  const sessions = join(home, ".swarm", "sessions");
  const planning = readdirSync(sessions).filter((name) => name.endsWith("-plan"));
  if (planning.length !== 1) return { error: `expected one planning chain, found ${planning.length}` };
  const chain = join(sessions, planning[0]);
  const payload = (digest) => JSON.parse(readFileSync(join(chain, "blobs", `${digest.slice(7)}.json`), "utf8"));
  const records = readFileSync(join(chain, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const declarations = records
    .filter((record) => record.type === "tool-call")
    .map((record) => payload(record.payloadDigest))
    .filter((call) => call.toolName?.startsWith("declare_planned_check") && call.decision !== "requested");
  const verification = records
    .filter((record) => record.type === "verification-command")
    .map((record) => ({ at: record.timestamp ?? null, ...payload(record.payloadDigest) }));
  // The run chain seals the contract the implementation answers to before its first model call.
  const run = planning[0].replace(/-plan$/, "");
  const runRecords = readFileSync(join(sessions, run, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const sealed = runRecords
    .filter((record) => record.type === "goal-contract")
    .map((record) => JSON.parse(readFileSync(join(sessions, run, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8")));
  return { capturedAt: new Date().toISOString(), chain: planning[0], declarations, verification, sealed };
}

const proxy = createServer((incoming, answer) => {
  const chunks = [];
  incoming.on("data", (chunk) => chunks.push(chunk));
  incoming.on("end", () => {
    const raw = Buffer.concat(chunks);
    let body = null;
    try {
      body = raw.length === 0 ? null : JSON.parse(raw.toString("utf8"));
    } catch {
      body = null;
    }
    const isCompletion = incoming.method === "POST" && (incoming.url ?? "").endsWith("/chat/completions");
    const route = isCompletion && !seededDone && isInitialImplementation(body) ? "seeded" : "live";
    if (route === "seeded" && captured === null) {
      captured = captureGeneratedChecks();
      writeFileSync(join(out, "generated-checks.json"), `${JSON.stringify(captured, null, 2)}\n`);
    }
    const target = route === "seeded" ? seededUrl : upstream;
    const exchange = {
      sequence: exchanges.length + 1,
      route,
      method: incoming.method,
      path: incoming.url,
      startedAt: new Date().toISOString(),
      request: body,
      response: "",
      status: null,
    };
    exchanges.push(exchange);
    const forwarded = httpRequest(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        method: incoming.method,
        path: `${target.pathname.replace(/\/v1$/, "")}${incoming.url}`,
        headers: { ...incoming.headers, host: target.host, "content-length": raw.length },
        // A fresh connection per request: the first live launch's retry after a server 500 went
        // out on a reused upstream socket and was never answered.
        agent: false,
      },
      (response) => {
        exchange.status = response.statusCode;
        answer.writeHead(response.statusCode ?? 502, response.headers);
        response.on("data", (chunk) => {
          exchange.response += chunk.toString("utf8");
          answer.write(chunk);
        });
        response.on("end", () => {
          exchange.endedAt = new Date().toISOString();
          // The seeded loop is its two scripted turns; every later request is live.
          if (route === "seeded" && seeded.played() >= 2) seededDone = true;
          answer.end();
        });
      },
    );
    // An upstream that never answers reaches the product as a failed call, not as a hang.
    forwarded.setTimeout(10 * 60_000, () => forwarded.destroy(new Error("upstream gave no answer in 10 minutes")));
    forwarded.on("error", (error) => {
      exchange.error = String(error);
      answer.writeHead(502);
      answer.end();
    });
    forwarded.end(raw);
  });
});
await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
const proxyUrl = `http://127.0.0.1:${proxy.address().port}/v1`;

writeFileSync(join(workspace, "swarm.toml"), swarmConfigurationText(proxyUrl, task, chosen.gates));
writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", { flag: "a" });
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, `${JSON.stringify(swarmContract(task), null, 2)}\n`);
const argv = [
  swarmCli, task.taskText.trim(),
  "--model", `local:${values.model}`, "--local-endpoint", proxyUrl,
  "--workspace", workspace, "--base", base,
  "--goal-contract", contractPath, "--plan-checks",
  "--install", "--lockfile", "package-lock.json",
  "--max-tokens", String(swarmTokenCap),
  // The product keeps 30 s of its wall for the final verification; a minute of the deadline is
  // left beyond that, as the launcher leaves it.
  "--max-wall-minutes", String(Math.floor((deadlineMs - 60_000) / 60_000)),
  "--approve", "auto", "--no-tui", "--no-open-evidence", "--json",
];
const started = Date.now();
const child = spawn(process.execPath, argv, {
  cwd: workspace,
  env: { PATH: taskEnvironment(task).PATH, HOME: home, NO_COLOR: "1" },
  detached: true,
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
let killed = false;
const timer = setTimeout(() => {
  killed = true;
  process.kill(-child.pid, "SIGKILL");
}, deadlineMs);
const exitCode = await new Promise((done) => child.on("close", (code) => done(code)));
clearTimeout(timer);
const elapsedMs = Date.now() - started;
proxy.closeAllConnections();
proxy.close();
await seeded.close();

const finalPatch = await log.run(["git", "diff", "--binary", base, "--", ".", ":(exclude)acceptance/visible"], {
  cwd: workspace,
  timeoutMs: 60_000,
});
const result = stdout
  .split("\n")
  .filter((line) => line.startsWith('{"schema":"swarm.result.v1"'))
  .map((line) => JSON.parse(line))[0] ?? null;
const usage = exchanges
  .filter((one) => one.route === "live" && one.path?.endsWith("/chat/completions"))
  .map((one) => {
    const last = [...one.response.matchAll(/"usage":(\{[^}]*\})/g)].at(-1);
    return last === undefined ? null : JSON.parse(last[1]);
  });
writeFileSync(join(out, "exchanges.json.gz"), gzipSync(JSON.stringify(exchanges)));
writeFileSync(join(out, "stdout.txt.gz"), gzipSync(stdout));
writeFileSync(join(out, "stderr.txt.gz"), gzipSync(stderr));
writeFileSync(join(out, "final.patch"), finalPatch.stdout.toString());
writeFileSync(join(out, "seeded.patch"), faultyPatch);
const sessions = join(home, ".swarm", "sessions");
const summary = {
  schema: "swarm-seeded-planned-repair.v1",
  kind: "seeded-candidate fault injection: live planning and live repair, injected first candidate",
  task: task.id,
  baseCommit: resolved.base,
  workspaceBase: base,
  swarmCli,
  model: values.model,
  endpoint: values.endpoint,
  argv: argv.slice(1).map((word) => (word === task.taskText.trim() ? "<task text>" : word)),
  startedAt: new Date(started).toISOString(),
  elapsedMs,
  killedAtDeadline: killed,
  exitCode,
  acceptable: result?.verdict?.acceptable ?? null,
  plannedChecks: result?.plannedChecks ?? null,
  requirements: result?.outcome?.requirements ?? null,
  uncheckedRequirements: result?.outcome?.uncheckedRequirements ?? [],
  repairAttempts: result?.outcome?.interventions?.repairAttempts ?? null,
  setup: result?.outcome?.setup ?? null,
  exchanges: {
    live: exchanges.filter((one) => one.route === "live" && one.path?.endsWith("/chat/completions")).length,
    seeded: exchanges.filter((one) => one.route === "seeded").length,
  },
  liveTokens: {
    prompt: usage.reduce((sum, one) => sum + (one?.prompt_tokens ?? 0), 0),
    completion: usage.reduce((sum, one) => sum + (one?.completion_tokens ?? 0), 0),
    callsWithoutUsage: usage.filter((one) => one === null).length,
  },
  generatedChecksCaptured: captured !== null,
  sessions: existsSync(sessions) ? readdirSync(sessions) : [],
  scratch,
};
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
for (const name of summary.sessions) {
  const ledger = join(sessions, name, "ledger.jsonl");
  if (existsSync(ledger)) copyFileSync(ledger, join(out, `${name}.ledger.jsonl`));
}
console.log(JSON.stringify(summary, null, 2));
// Nothing this driver owns is left running: the proxy and the seeded endpoint are closed above.
process.exit(0);
