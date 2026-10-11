/**
 * Launch the comparison: every task under both arms, one launch at a time, in the frozen order,
 * each record written once under the manifest's digest and never overwritten. Resumable: a
 * launch with a record is skipped. Usage:
 *
 *   node scripts/comparison/run.mjs --manifest <file> [--only <task-id>] [--arm swarm|opencode] [--dry-run]
 *
 * The manifest is built by `node scripts/comparison/run.mjs --freeze --out <file>` before any
 * launch and holds the task set, the pins, the budgets, the protocol digest and the order.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commandLog, storeBlob } from "../campaign/exec.mjs";
import {
  claimedSuccess,
  correctionPrompt,
  defaultPins,
  digestOf,
  maxCorrections,
  opencodeArgv,
  opencodeTokens,
  swarmArgv,
  swarmContract,
  swarmEvidenceDirectory,
  swarmTokens,
  taskPrompt,
  wallBudgetMs,
} from "./arms.mjs";
import { hiddenVerdict, visibleVerdict } from "./checks.mjs";
import { launches, seed } from "./order.mjs";
import { recordSchema, taskSchema } from "./schema.mjs";
import { tasks as allTasks } from "./tasks.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  finalPatch,
  prepare,
  resolveFull,
  writeArmConfiguration,
} from "./workspace.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (!word.startsWith("--")) continue;
  const next = process.argv[index + 1];
  if (next === undefined || next.startsWith("--")) args.set(word.slice(2), "true");
  else {
    args.set(word.slice(2), next);
    index += 1;
  }
}

function versionOf(argv) {
  const ran = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
  return (ran.stdout || ran.stderr || "").trim().split("\n")[0] ?? "unknown";
}

async function freeze(outPath) {
  const log = commandLog(join(comparisonRoot, "blobs"));
  const resolved = {};
  for (const task of allTasks) {
    taskSchema.parse(task);
    resolved[task.id] = await resolveFull(log, task);
  }
  const protocolPath = args.get("protocol") ?? "docs/evidence/2026-10-11/comparison/protocol.md";
  const manifest = {
    schema: "swarm-ordinary-comparison.manifest.v1",
    frozenAt: new Date().toISOString(),
    protocolDigest: existsSync(protocolPath) ? digestOf(readFileSync(protocolPath, "utf8")) : null,
    pins: {
      ...defaultPins,
      swarmRevision: args.get("swarm-revision") ?? "unknown",
      opencode: versionOf(["opencode", "--version"]),
      node: process.version,
    },
    budgets: { wallMsPerInvocation: wallBudgetMs, swarmTokenCap: 600_000, maxCorrections },
    seed,
    tasks: allTasks.map((task) => ({
      ...task,
      baseCommit: resolved[task.id].base,
      upstreamCommit: resolved[task.id].upstream,
    })),
    launches: launches(allTasks.map((task) => task.id)),
  };
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `froze ${manifest.launches.length} launches over ${manifest.tasks.length} tasks to ${outPath}`,
  );
}

async function invokeArm(
  log,
  arm,
  pins,
  task,
  workspace,
  base,
  prompt,
  kind,
  correction,
  scratch,
  deadlineMs,
) {
  const remaining = Math.max(60_000, deadlineMs - Date.now());
  let argv;
  if (arm === "swarm") {
    const contractPath = join(scratch, "contract.json");
    writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
    argv = swarmArgv(pins, task, workspace, base, prompt, contractPath, remaining);
  } else argv = opencodeArgv(pins, prompt);
  const ran = await log.run(argv, {
    cwd: workspace,
    timeoutMs: remaining + 60_000,
    env: { ...process.env, HOME: process.env.HOME, PUPPETEER_SKIP_DOWNLOAD: "true" },
  });
  const stdout = ran.stdout.toString();
  const tokens = arm === "swarm" ? swarmTokens(stdout) : opencodeTokens(stdout);
  const evidence = arm === "swarm" ? swarmEvidenceDirectory(stdout) : null;
  return {
    invocation: {
      kind,
      correction,
      argv: argv.map((word) => (word === prompt ? "<prompt>" : word)),
      exitCode: ran.exitCode,
      signal: ran.signal,
      wallMs: ran.wallMs,
      stdoutDigest: storeBlob(join(comparisonRoot, "blobs"), ran.stdout),
      stderrDigest: storeBlob(join(comparisonRoot, "blobs"), ran.stderr),
      tokens,
      claimedSuccess: claimedSuccess(arm, ran.exitCode, stdout),
    },
    evidence,
    stdout,
  };
}

async function runLaunch(manifest, manifestDigest, launch) {
  const task = manifest.tasks.find((one) => one.id === launch.task);
  const pins = manifest.pins;
  const runsDirectory = join(comparisonRoot, "runs", manifestDigest.slice(7, 23));
  mkdirSync(runsDirectory, { recursive: true });
  const recordPath = join(runsDirectory, `${launch.task}.${launch.arm}.json`);
  if (existsSync(recordPath)) {
    console.log(`skip ${launch.task} ${launch.arm}: recorded`);
    return;
  }
  const blobs = join(comparisonRoot, "blobs");
  const log = commandLog(blobs);
  const startedAt = new Date().toISOString();
  const started = Date.now();
  mkdirSync(join(comparisonRoot, "work"), { recursive: true });
  const scratch = mkdtempSync(join(comparisonRoot, "work", `${launch.task}.${launch.arm}-`));
  const workspace = join(scratch, "workspace");
  const notes = [];
  let infrastructureFailure = null;
  const record = {
    schema: "swarm-ordinary-comparison.record.v1",
    manifestDigest,
    task: launch.task,
    arm: launch.arm,
    order: launch.order,
    startedAt,
    endedAt: startedAt,
    host: { platform: process.platform, arch: process.arch, node: process.version },
    versions: {
      swarmRevision: pins.swarmRevision,
      opencode: pins.opencode,
      model: pins.model,
      endpoint: pins.endpoint,
    },
    preparation: { wallMs: 0, ok: false, detail: "" },
    invocations: [],
    corrections: 0,
    resolvedVisible: false,
    finalPatchDigest: digestOf(""),
    finalPatchBytes: 0,
    hidden: { verdict: "unjudgeable", basis: "not scored", detailDigest: null },
    oracleExposure: "not scanned",
    totals: { agentWallMs: 0, tokens: null, tokensUnknownInvocations: 0 },
    infrastructureFailure: null,
    notes,
  };
  try {
    console.log(`launch ${launch.order}: ${launch.task} ${launch.arm}`);
    const preparationStarted = Date.now();
    await cloneAtBase(log, task, task.baseCommit, workspace);
    const base = await commitVisibleCheck(log, task, workspace);
    const prepared = await prepare(log, task, workspace);
    writeArmConfiguration(workspace, launch.arm, pins.endpoint, pins.model);
    record.preparation = {
      wallMs: Date.now() - preparationStarted,
      ok: prepared.ok,
      detail: prepared.detail,
    };
    if (!prepared.ok)
      throw new InfrastructureError(`preparation failed: ${prepared.failed.join(" ")}`);

    const deadline = Date.now() + wallBudgetMs;
    let prompt = taskPrompt(task);
    let kind = "initial";
    const evidenceDirectories = [];
    for (let correction = 0; correction <= maxCorrections; correction += 1) {
      const invoked = await invokeArm(
        log,
        launch.arm,
        pins,
        task,
        workspace,
        base,
        prompt,
        kind,
        correction,
        scratch,
        deadline,
      );
      record.invocations.push({
        ...invoked.invocation,
        visible: {
          checkExit: null,
          projectTestExit: null,
          passed: false,
          detailDigest: digestOf(""),
        },
      });
      if (invoked.evidence) evidenceDirectories.push(invoked.evidence);
      const patch = await finalPatch(log, workspace, base);
      const visible = await visibleVerdict(log, task, base, patch);
      record.invocations[record.invocations.length - 1].visible = {
        checkExit: visible.checkExit,
        projectTestExit: visible.projectTestExit,
        passed: visible.passed,
        detailDigest: storeBlob(blobs, Buffer.from(visible.detail)),
      };
      if (visible.passed) {
        record.resolvedVisible = true;
        break;
      }
      if (correction === maxCorrections || Date.now() >= deadline) {
        if (Date.now() >= deadline)
          notes.push("the wall budget was spent before the corrections were");
        break;
      }
      record.corrections = correction + 1;
      prompt = correctionPrompt(task, visible.detail);
      kind = "correction";
    }
    const patch = await finalPatch(log, workspace, base);
    record.finalPatchDigest = storeBlob(blobs, Buffer.from(patch));
    record.finalPatchBytes = Buffer.byteLength(patch);
    const hidden = await hiddenVerdict(log, task, base, task.upstreamCommit, patch);
    record.hidden = {
      verdict: hidden.verdict,
      basis: hidden.basis,
      detailDigest: storeBlob(blobs, Buffer.from(hidden.detail ?? "")),
    };
    // The sealed material lives in the mirror; a run's evidence naming the mirror or the upstream
    // commit would be a route to it, so both are searched for.
    const hits = [];
    for (const directory of evidenceDirectories) {
      const scanned = spawnSync(
        "grep",
        ["-rlF", "-e", task.upstreamCommit, "-e", "swarm-comparison/mirrors", directory],
        { encoding: "utf8" },
      );
      if (scanned.stdout.trim() !== "") hits.push(...scanned.stdout.trim().split("\n"));
    }
    record.oracleExposure =
      launch.arm === "swarm"
        ? hits.length === 0
          ? `no mention of the sealed commit or mirror in ${evidenceDirectories.length} evidence director(ies)`
          : `EXPOSURE: ${hits.length} file(s) name the sealed commit or mirror`
        : "opencode keeps its sessions in its own store; the workspace is a shallow clone without the upstream commit";
  } catch (cause) {
    infrastructureFailure =
      cause instanceof InfrastructureError
        ? cause.message
        : `harness exception: ${cause?.stack ?? cause}`;
    notes.push(infrastructureFailure);
  } finally {
    record.endedAt = new Date().toISOString();
    record.infrastructureFailure = infrastructureFailure;
    record.totals = {
      agentWallMs: record.invocations.reduce((sum, one) => sum + one.wallMs, 0),
      tokens:
        record.invocations.some((one) => one.tokens === null) && record.invocations.length > 0
          ? record.invocations.every((one) => one.tokens === null)
            ? null
            : record.invocations.reduce((sum, one) => sum + (one.tokens ?? 0), 0)
          : record.invocations.reduce((sum, one) => sum + (one.tokens ?? 0), 0),
      tokensUnknownInvocations: record.invocations.filter((one) => one.tokens === null).length,
    };
    writeFileSync(join(scratch, "commands.json"), JSON.stringify(log.commands, null, 2));
    const parsed = recordSchema.safeParse(record);
    if (!parsed.success)
      notes.push(`record did not validate: ${parsed.error.message.slice(0, 500)}`);
    writeFileSync(
      recordPath,
      `${JSON.stringify({ ...record, commands: log.commands }, null, 2)}\n`,
      { flag: "wx" },
    );
    console.log(
      `  ${launch.task} ${launch.arm}: hidden ${record.hidden.verdict}, corrections ${record.corrections}, visible ${record.resolvedVisible ? "resolved" : "unresolved"}, ${Math.round(record.totals.agentWallMs / 1000)}s agent, tokens ${record.totals.tokens ?? "unknown"}${infrastructureFailure ? `, INFRASTRUCTURE: ${infrastructureFailure}` : ""}`,
    );
    if (!args.has("keep")) rmSync(scratch, { recursive: true, force: true });
  }
}

class InfrastructureError extends Error {}

if (args.has("freeze")) {
  await freeze(args.get("out") ?? "manifest.json");
} else if (args.has("manifest")) {
  const bytes = readFileSync(args.get("manifest"));
  const manifest = JSON.parse(bytes.toString());
  const manifestDigest = digestOf(bytes.toString());
  const selected = manifest.launches.filter(
    (launch) =>
      (!args.has("only") || launch.task === args.get("only")) &&
      (!args.has("arm") || launch.arm === args.get("arm")),
  );
  if (args.has("dry-run")) {
    for (const launch of selected) console.log(`${launch.order} ${launch.task} ${launch.arm}`);
  } else {
    for (const launch of selected) await runLaunch(manifest, manifestDigest, launch);
  }
} else {
  console.error(
    "usage: run.mjs --freeze --out <manifest> | --manifest <file> [--only <task>] [--arm <arm>] [--dry-run]",
  );
}
