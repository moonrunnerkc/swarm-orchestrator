#!/usr/bin/env node
/**
 * Deterministic controller verification of 2026-10-18 ordinary launch O1: the launch's recorded
 * candidate transitions, scripted, through one built product, on the real mime project. This is
 * not live repair and no model is called. It answers whether that product's controller, given
 * what O1's model did, keeps or refuses each transition, which tree it restores, what the next
 * repair is told, what it retains and what it reports.
 *
 * - The workspace, configuration, supplied contract and argv are the driver's
 *   (`../../2026-10-18/generated-check-control/run.mjs --arm swarm --mode ordinary`), with the
 *   model endpoint replaced by a scripted one.
 * - Planning: O1's 21 recorded planner responses, served verbatim in order. The planning is real
 *   (admission runs every declared check on the base); the sealed contract's digest is compared
 *   with O1's (`sha256:37ecd701...`), so the checks every candidate meets are O1's own.
 * - Implementation and repair, by content, whatever tree a stage starts from: the first loop
 *   writes O1's first file (blob 54e61a8); repair 1 writes O1's repair-1 file (a88e54b); repair 2
 *   changes nothing, as O1's repair 2 changed nothing; repair 3 writes O1's repair-3 file
 *   (c66bacc) and runs the formatter command it ran (`npx prettier --write .`).
 * - Every check runs on the actual tree. The evaluator and the expanded audit are never in the
 *   workspace or a request; the delivered patch is scored afterwards, apart.
 *
 *   node replay-o1.mjs --swarm-cli <dist/cli.js> --candidates <reconstruct-o1 out>/candidates --out <dir>
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { swarmContract, swarmTokenCap } from "../../../../scripts/comparison/arms.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  prepareLaunchHome,
  resolveFull,
  swarmConfigurationText,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { unpackArchive } from "../../../../scripts/local-campaign/archive.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { startScriptedEndpoint } from "../../../../src/providers/scripted-endpoint.ts";

const { values } = parseArgs({
  options: { "swarm-cli": { type: "string" }, candidates: { type: "string" }, out: { type: "string" } },
});
if (values["swarm-cli"] === undefined || values.candidates === undefined || values.out === undefined)
  throw new Error("usage: replay-o1.mjs --swarm-cli <dist/cli.js> --candidates <dir> --out <dir>");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);
const swarmCli = resolve(values["swarm-cli"]);
const model = "qwen3.6:35b-a3b";
const recordedContractDigest = "sha256:37ecd701774ce58174edbebfbd6f2c3ff590eb5ce70808bf425e8748bccddd4e";

// The files each scripted stage writes, read back out of the reconstructed candidates' patches.
const fileFrom = (name) => {
  const patch = readFileSync(join(values.candidates, `${name}.patch`), "utf8");
  return { patch, name };
};
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "replay-o1-"));

// Each candidate's src/Mime.ts, by applying its patch to a throwaway base checkout.
const contentOf = async (name) => {
  const directory = join(scratch, `content-${name}`);
  await cloneAtBase(log, task, resolved.base, directory);
  const { spawnSync } = await import("node:child_process");
  const applied = spawnSync("git", ["apply", "-"], { cwd: directory, input: fileFrom(name).patch, encoding: "utf8" });
  if (applied.status !== 0) throw new Error(`${name}: the patch does not apply: ${applied.stderr}`);
  return readFileSync(join(directory, "src/Mime.ts"), "utf8");
};
const files = {
  "attempt-0": await contentOf("attempt-0"),
  "repair-1": await contentOf("repair-1"),
  "repair-3": await contentOf("repair-3"),
};

// O1's planner responses, verbatim and in order.
const pack = await unpackArchive(
  new URL("../../2026-10-18/checking-semantics/packed-derived/launch-streams", import.meta.url).pathname,
);
const exchanges = JSON.parse(readFileSync(join(pack.directory, "launch-o1", "exchanges.json"), "utf8"));
await pack.dispose();
const isPlanner = (body) =>
  JSON.stringify(body?.messages?.[0] ?? "").includes("You write the acceptance checks");
const plannerResponses = exchanges.records
  .filter((one) => one.method === "POST" && isPlanner({ messages: [exchanges.messages[one.request.messages[0]]] }))
  .map((one) => one.response);
if (plannerResponses.length !== 21) throw new Error(`expected 21 planner responses, found ${plannerResponses.length}`);
const asTurn = (response) => ({
  ...(response.text ? { text: response.text } : {}),
  ...(response.toolCalls.length === 0
    ? {}
    : { toolCalls: response.toolCalls.map((call) => ({ name: call.name, input: JSON.parse(call.arguments) })) }),
  usage: { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens },
});

// The worker's scripted stages, keyed by the attempt the request names.
const stageOf = (body) => {
  const first = JSON.stringify(body?.messages?.[1] ?? "");
  const match = /This is attempt (\d+) of (\d+)\./.exec(first);
  return match === null ? 0 : Number(match[1]);
};
const acted = new Set();
const transcript = [];
let planner = 0;
const respond = (body) => {
  if (isPlanner(body)) {
    const response = plannerResponses[planner];
    planner += 1;
    transcript.push({ role: "planner", turn: planner });
    if (response === undefined) return { text: "The recorded planner has no more turns." };
    return asTurn(response);
  }
  const stage = stageOf(body);
  const first = !acted.has(stage);
  acted.add(stage);
  // The brief a stage opened with: what the product told that repair, kept whole.
  transcript.push({ role: "worker", stage, first, ...(first ? { brief: body?.messages?.[1]?.content ?? null } : {}) });
  if (!first) return { text: stage === 0 ? "Done." : "Repaired." };
  const write = (content) => ({ name: "write", input: { path: "src/Mime.ts", content } });
  if (stage === 0)
    return { toolCalls: [{ name: "declare_file_set", input: { files: ["src/Mime.ts"] } }, write(files["attempt-0"])] };
  if (stage === 1) return { toolCalls: [write(files["repair-1"])] };
  if (stage === 2) return { text: "I leave the code as it is." };
  if (stage === 3)
    return {
      toolCalls: [write(files["repair-3"]), { name: "shell", input: { command: "npx prettier --write . 2>&1", timeoutMs: 30000 } }],
    };
  return { text: "No further scripted change." };
};
const endpoint = await startScriptedEndpoint({ modelId: model, turns: Array.from({ length: 400 }, () => respond) });

// The driver's workspace and launch, unchanged but for the endpoint.
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
prepareLaunchHome(home);
await cloneAtBase(log, task, resolved.base, workspace);
const base = await commitVisibleCheck(log, task, workspace);
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
writeFileSync(
  join(workspace, "swarm.toml"),
  swarmConfigurationText(endpoint.url, task, { lint: { command: "npm run --loglevel=error lint", severity: "advisory" } }),
);
writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", { flag: "a" });
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, `${JSON.stringify(swarmContract(task), null, 2)}\n`);
const argv = [
  process.execPath,
  swarmCli, task.taskText.trim(),
  "--model", `local:${model}`, "--local-endpoint", endpoint.url,
  "--workspace", workspace, "--base", base,
  "--goal-contract", contractPath, "--plan-checks",
  "--install", "--lockfile", "package-lock.json",
  "--max-tokens", String(swarmTokenCap),
  "--max-wall-minutes", "14",
  "--approve", "auto", "--no-tui", "--no-open-evidence", "--json",
];
const started = Date.now();
const child = spawn(argv[0], argv.slice(1), {
  cwd: workspace,
  env: { PATH: taskEnvironment(task).PATH, HOME: home, NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
const exitCode = await new Promise((done) => child.on("close", (code) => done(code)));
await endpoint.close();
writeFileSync(join(out, "stdout.txt"), stdout);
writeFileSync(join(out, "stderr.txt"), stderr);
writeFileSync(join(out, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
writeFileSync(
  join(out, "run.json"),
  `${JSON.stringify(
    {
      schema: "swarm-o1-replay-run.v1",
      kind: "deterministic controller verification: O1's recorded transitions, scripted; no model, not live repair",
      swarmCli,
      task: task.id,
      baseCommit: resolved.base,
      workspaceBase: base,
      recordedContractDigest,
      exitCode,
      elapsedMs: Date.now() - started,
      plannerTurnsServed: planner,
      scratch,
      home,
    },
    null,
    2,
  )}\n`,
);
console.log(`exit ${exitCode}; ${planner} planner turns; records in ${out}; sessions under ${home}/.swarm/sessions`);
