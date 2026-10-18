#!/usr/bin/env node
/**
 * One live launch of the exposed mime task under [protocol.md](protocol.md), through a recording
 * proxy in front of the local model server. Adapted from `../../2026-10-17/repair-detection-live/
 * run.mjs`; what is new is the development contract and the OpenCode arm.
 *
 * - `--arm swarm --mode development`: the workspace's base commit holds the visible check and the
 *   development checks ([development-checks.mjs](development-checks.mjs)); the supplied contract
 *   holds all four, no --plan-checks. The proxy answers the first implementation loop with the
 *   retained faulty patch's files, then "Done."; every repair and the final verification are live.
 * - `--arm opencode --mode development`: the same base commit, and the retained faulty patch
 *   applied to the working tree, which is the tree Swarm's first loop leaves. OpenCode's `run`,
 *   configured as the comparison harness configures it, is told the task, every check's command
 *   and that the working tree holds an earlier attempt's change that fails some of them.
 * - `--arm swarm --mode seeded`: the injected first candidate, the visible check only, and
 *   --plan-checks: live planning must find the omission for a repair to be asked for.
 * - `--arm swarm --mode ordinary`: nothing injected, the visible check only, --plan-checks.
 *
 * The evaluator (the frozen oracle and its 113-case audit) is never in a workspace or a request;
 * it scores the exact final patch afterwards, apart (`../../2026-10-17/repair-trust-live/score.mjs`).
 *
 *   node run.mjs --swarm-cli <dist/cli.js> --arm swarm|opencode --mode development|seeded|ordinary
 *     --out <dir> [--endpoint http://127.0.0.1:11434/v1] [--model qwen3.6:35b-a3b] [--deadline-minutes 15]
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  opencodeArgv,
  opencodeTokens,
  opencodeUsage,
  swarmContract,
  swarmTokenCap,
  taskPrompt,
} from "../../../../scripts/comparison/arms.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  prepareLaunchHome,
  resolveFull,
  swarmConfigurationText,
  taskEnvironment,
  workRoot,
  writeArmConfiguration,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { compactExchanges } from "../../2026-10-17/planned-check-live/seeded/exchange-record.mjs";
import {
  developmentChecks,
  developmentDirectory,
  developmentFiles,
  withDevelopmentChecks,
} from "./development-checks.mjs";

const { values } = parseArgs({
  options: {
    "swarm-cli": { type: "string" },
    arm: { type: "string", default: "swarm" },
    mode: { type: "string", default: "development" },
    out: { type: "string" },
    endpoint: { type: "string", default: "http://127.0.0.1:11434/v1" },
    model: { type: "string", default: "qwen3.6:35b-a3b" },
    "deadline-minutes": { type: "string", default: "15" },
  },
});
const arm = values.arm;
const mode = values.mode;
if (!["swarm", "opencode"].includes(arm)) throw new Error("--arm is swarm or opencode");
if (!["development", "seeded", "ordinary"].includes(mode))
  throw new Error("--mode is development, seeded or ordinary");
if (arm === "opencode" && mode !== "development")
  throw new Error("the OpenCode arm runs only the matched development mode");
if (values.out === undefined || (arm === "swarm" && values["swarm-cli"] === undefined))
  throw new Error("usage: run.mjs --swarm-cli <dist/cli.js> --arm swarm|opencode --mode <mode> --out <dir>");
const seeding = mode !== "ordinary";
const planning = arm === "swarm" && mode !== "development";
const development = mode === "development";
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);
const deadlineMs = Number(values["deadline-minutes"]) * 60_000;
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const faultyPatch = readFileSync(
  new URL(
    "../../2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
    import.meta.url,
  ),
  "utf8",
);
const swarmCli = arm === "swarm" ? resolve(values["swarm-cli"]) : null;

const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, `generated-check-control-${arm}-${mode}-`));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
prepareLaunchHome(home);

await cloneAtBase(log, task, resolved.base, workspace);
let base = await commitVisibleCheck(log, task, workspace);
if (development) {
  // The development checks, committed beside the visible check as the project would keep them.
  for (const [path, content] of Object.entries(developmentFiles(task.taskText))) {
    mkdirSync(dirname(join(workspace, path)), { recursive: true });
    writeFileSync(join(workspace, path), content);
  }
  const git = (...args) =>
    spawnSync("git", ["-c", "user.name=comparison", "-c", "user.email=comparison@localhost", ...args], {
      cwd: workspace,
      encoding: "utf8",
    });
  if (git("add", "--force", developmentDirectory).status !== 0 || git("commit", "-qm", "Development acceptance checks").status !== 0)
    throw new Error("committing the development checks failed");
  base = git("rev-parse", "HEAD").stdout.trim();
}
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
const seededFiles = [...faultyPatch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]);
if (arm === "opencode" && !(await applyPatch(log, workspace, faultyPatch)))
  throw new Error("the retained patch does not apply");

// Swarm's seeded first loop: the files the retained patch produces, read from a throwaway copy.
let seeded = null;
if (arm === "swarm" && seeding) {
  const copy = join(scratch, "faulty-copy");
  await cloneAtBase(log, task, resolved.base, copy);
  if (!(await applyPatch(log, copy, faultyPatch))) throw new Error("the retained patch does not apply");
  const { startScriptedEndpoint } = await import(
    pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
  );
  seeded = await startScriptedEndpoint({
    modelId: values.model,
    turns: [
      {
        text: "Writing the change.",
        toolCalls: [
          { name: "declare_file_set", input: { files: seededFiles } },
          ...seededFiles.map((path) => ({
            name: "write",
            input: { path, content: readFileSync(join(copy, path), "utf8") },
          })),
        ],
      },
      { text: "Done." },
    ],
  });
}

const firstUser = (body) =>
  (body?.messages ?? []).find((message) => message.role === "user")?.content ?? "";
const systemOf = (body) =>
  (body?.messages ?? []).find((message) => message.role === "system")?.content ?? "";
/** Swarm's first implementation loop's requests, by their brief: the task itself, not a planner's or a repair's. */
const isInitialImplementation = (body) =>
  typeof firstUser(body) === "string" &&
  firstUser(body).startsWith(task.taskText.trim().slice(0, 80)) &&
  !String(systemOf(body)).startsWith("You write the acceptance checks") &&
  !JSON.stringify(body?.messages ?? []).includes("A quality gate is failing");

const exchanges = [];
let captured = null;
let seededDone = false;
const upstream = new URL(values.endpoint);

/** The planning chain's declarations and admission, copied the moment the candidate is first asked for. */
function captureGeneratedChecks() {
  const sessions = join(home, ".swarm", "sessions");
  const chains = readdirSync(sessions).filter((name) => name.endsWith("-plan"));
  if (chains.length !== 1) return { error: `expected one planning chain, found ${chains.length}` };
  const chain = join(sessions, chains[0]);
  const payload = (digest) => JSON.parse(readFileSync(join(chain, "blobs", `${digest.slice(7)}.json`), "utf8"));
  const records = readFileSync(join(chain, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const declarations = records
    .filter((record) => record.type === "tool-call")
    .map((record) => payload(record.payloadDigest))
    .filter((call) => call.toolName?.startsWith("declare_planned_") && call.decision !== "requested");
  const verification = records
    .filter((record) => record.type === "verification-command")
    .map((record) => ({ at: record.timestamp ?? null, ...payload(record.payloadDigest) }));
  const run = chains[0].replace(/-plan$/, "");
  const runRecords = readFileSync(join(sessions, run, "ledger.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const sealed = runRecords
    .filter((record) => record.type === "goal-contract")
    .map((record) => JSON.parse(readFileSync(join(sessions, run, "blobs", `${record.payloadDigest.slice(7)}.json`), "utf8")));
  return { capturedAt: new Date().toISOString(), chain: chains[0], declarations, verification, sealed };
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
    const initial = arm === "swarm" && isCompletion && !seededDone && isInitialImplementation(body);
    const route = seeding && seeded !== null && initial ? "seeded" : "live";
    if (planning && initial && captured === null) {
      captured = captureGeneratedChecks();
      writeFileSync(join(out, "generated-checks.json"), `${JSON.stringify(captured, null, 2)}\n`);
    }
    const target = route === "seeded" ? new URL(seeded.url) : upstream;
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
          if (route === "seeded" && seeded.played() >= 2) seededDone = true;
          answer.end();
        });
      },
    );
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

let argv;
let env;
let prompt = null;
if (arm === "swarm") {
  writeFileSync(
    join(workspace, "swarm.toml"),
    swarmConfigurationText(proxyUrl, task, { lint: { command: "npm run --loglevel=error lint", severity: "advisory" } }),
  );
  writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", { flag: "a" });
  const contractPath = join(scratch, "contract.json");
  const contract = development ? withDevelopmentChecks(swarmContract(task)) : swarmContract(task);
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  writeFileSync(join(out, "contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
  argv = [
    process.execPath,
    swarmCli, task.taskText.trim(),
    "--model", `local:${values.model}`, "--local-endpoint", proxyUrl,
    "--workspace", workspace, "--base", base,
    "--goal-contract", contractPath, ...(planning ? ["--plan-checks"] : []),
    "--install", "--lockfile", "package-lock.json",
    "--max-tokens", String(swarmTokenCap),
    // The product keeps 30 s of its wall for the final verification; a minute of the deadline is
    // left beyond that.
    "--max-wall-minutes", String(Math.floor((deadlineMs - 60_000) / 60_000)),
    "--approve", "auto", "--no-tui", "--no-open-evidence", "--json",
  ];
  env = { PATH: taskEnvironment(task).PATH, HOME: home, NO_COLOR: "1" };
} else {
  writeArmConfiguration(workspace, "opencode", proxyUrl, values.model, task);
  prompt = [
    taskPrompt(task),
    ...developmentChecks.map(
      (one) => `Further acceptance check (it must pass): ${one.command}`,
    ),
    `Do not modify anything under ${developmentDirectory}/ either.`,
    "",
    "The working tree already holds a change to src/Mime.ts that an earlier attempt made (git diff",
    "shows it against the last commit). It fails some of these checks. Repair it so that every",
    "check passes.",
  ].join("\n");
  writeFileSync(join(out, "prompt.txt"), `${prompt}\n`);
  argv = opencodeArgv({ model: values.model }, prompt, workspace);
  env = {
    ...process.env,
    PATH: taskEnvironment(task).PATH,
    PWD: workspace,
    HOME: home,
    PUPPETEER_SKIP_DOWNLOAD: "true",
  };
}

const started = Date.now();
const child = spawn(argv[0], argv.slice(1), { cwd: workspace, env, detached: true });
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
await seeded?.close();

// The delivered change: everything but the acceptance checks, which no arm may change, and the
// arms' own configuration. Whether an arm touched the checks anyway is recorded beside it.
const finalPatch = await log.run(
  ["git", "diff", "--binary", base, "--", ".", ":(exclude)acceptance", ":(exclude)opencode.json", ":(exclude)swarm.toml"],
  { cwd: workspace, timeoutMs: 60_000 },
);
const acceptanceTouched = (
  await log.run(["git", "status", "--porcelain", "--untracked-files=all", "--", "acceptance"], {
    cwd: workspace,
    timeoutMs: 60_000,
  })
).stdout
  .toString()
  .trim();
const result =
  arm === "swarm"
    ? (stdout
        .split("\n")
        .filter((line) => line.startsWith('{"schema":"swarm.result.v1"'))
        .map((line) => JSON.parse(line))[0] ?? null)
    : null;
const usage = exchanges
  .filter((one) => one.route === "live" && one.path?.endsWith("/chat/completions"))
  .map((one) => {
    const last = [...one.response.matchAll(/"usage":(\{[^}]*\})/g)].at(-1);
    return last === undefined ? null : JSON.parse(last[1]);
  });
writeFileSync(join(out, "exchanges.json.gz"), gzipSync(JSON.stringify(compactExchanges(exchanges))));
writeFileSync(join(out, "stdout.txt.gz"), gzipSync(stdout));
writeFileSync(join(out, "stderr.txt.gz"), gzipSync(stderr));
writeFileSync(join(out, "final.patch"), finalPatch.stdout.toString());
if (seeding) writeFileSync(join(out, "seeded.patch"), faultyPatch);
const sessions = join(home, ".swarm", "sessions");
const summary = {
  schema: "swarm-generated-check-control-launch.v1",
  arm,
  mode,
  kind: development
    ? "matched development repair on an exposed task: injected first candidate, developer-authored supplied checks"
    : mode === "seeded"
      ? "seeded-candidate fault injection: live planning and live repair, injected first candidate, ordinary visible check"
      : "ordinary run: every request live, nothing injected",
  task: task.id,
  baseCommit: resolved.base,
  workspaceBase: base,
  swarmCli,
  opencode: arm === "opencode" ? spawnSync("opencode", ["--version"], { encoding: "utf8" }).stdout.trim() : null,
  model: values.model,
  endpoint: values.endpoint,
  argv: argv.slice(1).map((word) => (word === task.taskText.trim() ? "<task text>" : word === prompt ? "<prompt.txt>" : word)),
  startedAt: new Date(started).toISOString(),
  elapsedMs,
  killedAtDeadline: killed,
  exitCode,
  acceptanceTouched: acceptanceTouched.length === 0 ? null : acceptanceTouched,
  acceptable: result?.verdict?.acceptable ?? null,
  outcomeStatus: result?.outcome?.status ?? null,
  finalVerification: result?.outcome?.finalVerification ?? null,
  plannedChecks: result?.plannedChecks ?? null,
  requirements: result?.outcome?.requirements ?? null,
  repairAttempts: result?.outcome?.interventions?.repairAttempts ?? null,
  setup: result?.outcome?.setup ?? null,
  opencodeUsage: arm === "opencode" ? { tokens: opencodeTokens(stdout), parts: opencodeUsage(stdout) } : null,
  exchanges: {
    live: exchanges.filter((one) => one.route === "live" && one.path?.endsWith("/chat/completions")).length,
    seeded: exchanges.filter((one) => one.route === "seeded").length,
  },
  liveTokens: {
    prompt: usage.reduce((sum, one) => sum + (one?.prompt_tokens ?? 0), 0),
    completion: usage.reduce((sum, one) => sum + (one?.completion_tokens ?? 0), 0),
    callsWithoutUsage: usage.filter((one) => one === null).length,
  },
  generatedChecksCaptured: planning ? captured !== null : null,
  sessions: existsSync(sessions) ? readdirSync(sessions) : [],
  scratch,
};
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
for (const name of summary.sessions) {
  const ledger = join(sessions, name, "ledger.jsonl");
  if (existsSync(ledger)) copyFileSync(ledger, join(out, `${name}.ledger.jsonl`));
}
console.log(JSON.stringify(summary, null, 2));
process.exit(0);
