/**
 * The controller's mechanics on real repositories, with scripted model responses: a retained
 * candidate is the worker's first loop, the reviewer's answer and the repair's writes are fixed,
 * and everything else is the product as it ships (gates, project loader, the task's own code,
 * ratchet, final verification, bundle verifier). It shows what the controller does with a given
 * counterexample on a real tree; it says nothing about what a model would find or write.
 *
 *   node scripted-mechanics.mjs --repo <checkout> --tasks <tasks module> --candidates <dir> \
 *     --inputs <dir>... --plan <plan.json> --out <file.json> [--only <case id>]
 *
 * A plan case names the task, the starting candidate, the reviewer's answer, and the patch whose
 * files the repair writes (a correct candidate of the same task, never shown to any model).
 */
import { execFile, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, promisify } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { swarmContract, taskPrompt } from "../../../../scripts/comparison/arms.mjs";
import { hiddenVerdict } from "../../../../scripts/comparison/checks.mjs";
import { candidateFiles, replayTurns } from "../../../../scripts/comparison/starting-candidate.mjs";
import {
  cloneAtBase,
  commitHarnessLockfile,
  commitVisibleCheck,
  comparisonRoot,
  declaredPackageManager,
  finalPatch,
  packageManagerToolchain,
  prepare,
  resolveFull,
  workRoot,
  writeArmConfiguration,
} from "../../../../scripts/comparison/workspace.mjs";

const run = promisify(execFile);
const { values } = parseArgs({
  options: {
    repo: { type: "string" },
    tasks: { type: "string" },
    candidates: { type: "string" },
    inputs: { type: "string", multiple: true },
    plan: { type: "string" },
    out: { type: "string" },
    only: { type: "string" },
  },
});
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(values.repo, "src/providers/scripted-endpoint.ts")).href
);
const { tasks } = await import(pathToFileURL(values.tasks).href);
const plan = JSON.parse(readFileSync(values.plan, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const log = commandLog(join(comparisonRoot, "blobs"));

const lockOf = (taskId) =>
  values.inputs
    .map((root) => join(root, taskId, "package-lock.json"))
    .map((path) => {
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    })
    .find((found) => found !== null) ?? null;

/** The worker replays the candidate, the reviewer gives its fixed answer, the repair writes. */
function roles(worker, reviewer, repair) {
  let workerTurn = 0;
  let repairTurn = 0;
  const route = (request) => {
    const text = JSON.stringify(request);
    if (text.includes("You review a change another coding agent made"))
      return { text: JSON.stringify(reviewer) };
    if (text.includes("A separate review of your change"))
      return repair[repairTurn++] ?? { text: "Done with the review's findings." };
    return worker[workerTurn++] ?? { text: "Done." };
  };
  return Array.from({ length: 80 }, () => route);
}

const taskPath = (task) => {
  const declared = declaredPackageManager(task);
  return [
    ...(declared === null
      ? []
      : [join(packageManagerToolchain(declared.name, declared.version), "node_modules", ".bin")]),
    process.env.PATH ?? "",
  ].join(":");
};

const results = [];
for (const one of plan.cases.filter((c) => values.only === undefined || c.id === values.only)) {
  const listed = tasks.find((candidate) => candidate.id === one.task);
  const commits = await resolveFull(log, listed);
  const task = { ...listed, baseCommit: commits.base, upstreamCommit: commits.upstream };
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `mechanics-${one.id}-`));
  const workspace = join(scratch, "workspace");
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true });
  await cloneAtBase(log, task, task.baseCommit, workspace);
  let base = await commitVisibleCheck(log, task, workspace);
  const lock = lockOf(task.id);
  if (lock !== null) base = (await commitHarnessLockfile(log, workspace, lock)).base;
  const prepared = await prepare(log, task, workspace);
  if (!prepared.ok) throw new Error(`${one.id}: preparation failed: ${prepared.detail}`);
  const startBytes = readFileSync(join(values.candidates, one.start));
  const repairBytes = readFileSync(join(values.candidates, one.repairFrom));
  const start = candidateFiles(workspace, startBytes, scratch);
  const repaired = candidateFiles(workspace, repairBytes, scratch);
  const repairWrites = (one.repairFiles ?? Object.keys(repaired)).map((path) => ({
    toolCalls: [{ name: "write", input: { path, content: repaired[path] } }],
  }));
  const endpoint = await startScriptedEndpoint({
    modelId: "stub",
    turns: roles(replayTurns(start), one.reviewer, repairWrites),
  });
  // The study's own configuration of a Swarm arm: its endpoint, and the task's test command.
  writeArmConfiguration(workspace, "swarm", endpoint.url, "stub", task);
  const contractPath = join(scratch, "contract.json");
  writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    const ran = await run(
      process.execPath,
      [
        join(values.repo, "src/cli.ts"),
        taskPrompt(task),
        "--model",
        "local:stub",
        "--local-endpoint",
        endpoint.url,
        "--workspace",
        workspace,
        "--base",
        base,
        "--goal-contract",
        contractPath,
        "--install",
        "--lockfile",
        "package-lock.json",
        "--max-wall-minutes",
        "11",
        "--approve",
        "auto",
        "--no-tui",
        "--no-open-evidence",
        "--json",
        "--adaptive",
        "--review",
        "executable",
      ],
      {
        cwd: workspace,
        // The task's declared package manager first on PATH, as the study gives every arm.
        env: { PATH: taskPath(task), HOME: home, NO_COLOR: "1" },
        timeout: 900_000,
        maxBuffer: 256 * 1024 * 1024,
      },
    );
    stdout = ran.stdout;
    stderr = ran.stderr;
  } catch (cause) {
    exitCode = cause.code ?? 1;
    stdout = cause.stdout ?? "";
    stderr = cause.stderr ?? "";
  } finally {
    await endpoint.close();
  }
  const result = stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line))
    .find((line) => line.type === undefined && line.bundleDirectory !== undefined);
  const patch = await finalPatch(log, workspace, base);
  const verifier =
    result?.bundleDirectory === undefined
      ? null
      : spawnSync(process.execPath, [join(result.bundleDirectory, "verify.mjs"), result.bundleDirectory], {
          encoding: "utf8",
        }).status === 0
        ? "verifies"
        : "fails";
  const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch, {
    harnessLock: lock,
  });
  const startHidden = await hiddenVerdict(
    log,
    task,
    task.baseCommit,
    task.upstreamCommit,
    startBytes.toString(),
    { harnessLock: lock },
  );
  const record = {
    id: one.id,
    task: one.task,
    start: one.start,
    repairFrom: one.repairFrom,
    exitCode,
    stderrTail: stderr.slice(-1500),
    wallMs: Date.now() - started,
    status: result?.outcome?.status ?? null,
    acceptable: result?.verdict?.acceptable ?? null,
    review: result?.outcome?.review ?? null,
    preservation: (result?.outcome?.preservation ?? [])
      .filter((entry) => /^code-|^task-keep|^review-/.test(entry.id))
      .map((entry) => ({ id: entry.id, category: entry.category, status: entry.status })),
    finalVerification: result?.outcome?.finalVerification ?? null,
    deliveredPatch: digest(patch),
    deliveredIsRepair: Object.entries(repaired).every(
      ([path, content]) =>
        !(one.repairFiles ?? Object.keys(repaired)).includes(path) ||
        readFileSync(join(workspace, path), "utf8") === content,
    ),
    verifier,
    hiddenOnStart: { verdict: startHidden.verdict, basis: startHidden.basis },
    hiddenOnDelivered: { verdict: hidden.verdict, basis: hidden.basis },
  };
  console.log(JSON.stringify(record));
  results.push(record);
  writeFileSync(values.out, `${JSON.stringify({ results }, null, 2)}\n`);
  if (process.env.KEEP_SCRATCH !== "1") rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(values.out, `${JSON.stringify({ results }, null, 2)}\n`);
