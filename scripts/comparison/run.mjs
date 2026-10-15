/**
 * Launch the comparison: every task under both arms, one launch at a time, in the frozen order,
 * each record written once under the manifest's digest and never overwritten. Resumable: a
 * launch with a record is skipped. Usage:
 *
 *   node scripts/comparison/run.mjs --manifest <file> [--only <task-id>] [--arm swarm|opencode] [--dry-run]
 *   node scripts/comparison/run.mjs --manifest <file> --status
 *   node scripts/comparison/run.mjs --manifest <file> --recover --justification "<why resumption is sound>"
 *
 * The manifest is built by `node scripts/comparison/run.mjs --freeze --out <file>` before any
 * launch and holds the task set, the pins, the budgets, the protocol digest and the order.
 *
 * The campaign stops, before any later launch, when the experiment rather than an arm fails: the
 * endpoint dies or restarts (watched during every invocation), the frozen configuration is not
 * what is installed, a task environment cannot be prepared, the scorer cannot judge, a record
 * cannot be validated, written or backed by its evidence, or the runner is interrupted. The stop
 * is a `halt-N.json` beside the records, the affected attempt is kept as
 * `<task>.<arm>.halted-N.json`, and the same command refuses to continue until `--recover` has
 * revalidated the pins and recorded why. Exit statuses: 0 done or nothing to do; 2 usage or an
 * edited harness; 3 halted, or refusing because halted; 4 another runner holds the manifest;
 * 130 or 143 interrupted by SIGINT or SIGTERM, with the halt recorded.
 */

import { spawnSync } from "node:child_process";
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
  swarmChildHomeName,
  swarmContract,
  swarmEvidenceDirectory,
  swarmTokens,
  taskPrompt,
  wallBudgetMs,
} from "./arms.mjs";
import { hiddenVerdict, swarmGatePlanVerdict, visibleVerdict } from "./checks.mjs";
import {
  acquireLock,
  campaignState,
  cellFiles,
  FatalError,
  fatalInvocation,
  lockPath,
  nextNumbered,
  processStart,
  releaseLock,
  revalidate,
  terminateGroup,
  terminationDeadlineMs,
  updateLock,
  writeHalt,
  writeRecovery,
} from "./control.mjs";
import { endpointPort, instanceChange, probeEndpoint, watchInstance } from "./endpoint.mjs";
import { harnessDigest } from "./harness-identity.mjs";
import { launches, seed } from "./order.mjs";
import { recordSchema, taskSchema } from "./schema.mjs";
import { tasks as allTasks } from "./tasks.mjs";
import {
  browserCacheIn,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  finalPatch,
  prepare,
  prepareLaunchHome,
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
      // The bytes of the built CLI, so a rebuilt tool under the same path cannot run as the
      // frozen one. Null when the tool is not built yet, and then recorded as not pinned.
      swarmCliDigest: existsSync(defaultPins.swarmCli)
        ? digestOf(readFileSync(defaultPins.swarmCli))
        : null,
      opencode: versionOf(["opencode", "--version"]),
      node: process.version,
      harnessDigest: harnessDigest(),
    },
    budgets: {
      wallMsPerInvocation: wallBudgetMs,
      wallGraceMs: 60_000,
      swarmTokenCap: 600_000,
      maxCorrections,
    },
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

/**
 * The interruption state the signal handlers share with the launch loop. Aborting the controller
 * reaches every child the current launch owns through its command log; the loop then reads the
 * reason as the fatal failure. SIGKILL runs none of this, which is what the stale-lock path on
 * the next start is for.
 */
const interruption = { signal: null, controller: new AbortController() };
for (const name of ["SIGINT", "SIGTERM"]) {
  process.on(name, () => {
    if (interruption.signal !== null) return;
    interruption.signal = name;
    interruption.controller.abort(new FatalError("interrupted", `the runner received ${name}`));
  });
}
const interruptedExit = () => (interruption.signal === "SIGINT" ? 130 : 143);
const interrupted = () =>
  interruption.signal === null ? null : interruption.controller.signal.reason;

/**
 * One invocation of the arm, watched. The endpoint's listener is read every poll interval while
 * the arm runs; the arm is killed as soon as the listener is gone or replaced, and the fatal
 * failure is returned beside the invocation so the caller keeps both.
 */
async function invokeArm(log, launch, pins, budgets, task, workspace, base, turn, scratch) {
  const { prompt, kind, correction, deadlineMs, instance, onChild, home } = turn;
  // A correction is never started with less than a minute (or the whole budget, where that is
  // smaller); the flag Swarm takes is in whole minutes.
  const remaining = Math.max(
    Math.min(60_000, budgets.wallMsPerInvocation),
    deadlineMs - Date.now(),
  );
  let argv;
  if (launch.arm === "swarm") {
    const contractPath = join(scratch, "contract.json");
    writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
    argv = swarmArgv(pins, task, workspace, base, prompt, contractPath, remaining);
  } else argv = opencodeArgv(pins, prompt, workspace);
  const watch = new AbortController();
  const stopWatch =
    instance === null
      ? null
      : watchInstance(endpointPort(pins.endpoint), instance, {
          onChange: (reason, at) => watch.abort(new FatalError("endpoint", reason, at)),
        });
  let ran;
  try {
    ran = await log.run(argv, {
      cwd: workspace,
      timeoutMs: remaining + (budgets.wallGraceMs ?? 60_000),
      killConfirmMs: terminationDeadlineMs,
      signal: watch.signal,
      onSpawn: onChild,
      // PWD follows the cwd: a spawned process inherits the launcher's, and OpenCode reads it.
      // Each arm's processes get the launch's own home: Swarm builds its children's environment
      // and reads the name for the HOME it gives them; OpenCode and everything it runs inherit
      // HOME as any process does.
      env: {
        ...process.env,
        PWD: workspace,
        PUPPETEER_SKIP_DOWNLOAD: "true",
        ...(launch.arm === "swarm" ? { [swarmChildHomeName]: home } : { HOME: home }),
      },
    });
  } finally {
    stopWatch?.();
  }
  const stdout = ran.stdout.toString();
  const blobs = join(comparisonRoot, "blobs");
  return {
    invocation: {
      kind,
      correction,
      argv: argv.map((word) => (word === prompt ? "<prompt>" : word)),
      exitCode: ran.exitCode,
      signal: ran.signal,
      wallMs: ran.wallMs,
      stdoutDigest: storeBlob(blobs, ran.stdout),
      stderrDigest: storeBlob(blobs, ran.stderr),
      tokens: launch.arm === "swarm" ? swarmTokens(stdout) : opencodeTokens(stdout),
      claimedSuccess: claimedSuccess(launch.arm, ran.exitCode, stdout),
    },
    evidence: launch.arm === "swarm" ? swarmEvidenceDirectory(stdout) : null,
    stdout,
    fatal: watch.signal.aborted ? watch.signal.reason : interrupted(),
    ran,
  };
}

const emptyVisible = () => ({
  checkExit: null,
  projectTestExit: null,
  passed: false,
  detailDigest: digestOf(""),
});

/** Every digest a record cites must resolve in the blob store, or the record's evidence is missing. */
function missingEvidence(record, blobs) {
  const cited = JSON.stringify(record).match(/sha256:[0-9a-f]{64}/g) ?? [];
  return [...new Set(cited)].filter(
    (digest) => digest !== record.manifestDigest && !existsSync(join(blobs, digest.slice(7))),
  );
}

function readRecord(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    return { unreadable: String(cause) };
  }
}

const noCleanup = () => ({
  outcome: "nothing-running",
  wallMs: 0,
  deadlineMs: terminationDeadlineMs,
});

/**
 * One launch. Returns `{ kind: "skipped" }`, `{ kind: "recorded" }`, or `{ kind: "halt", ... }`
 * with the fatal failure, the attempt record it saved and the workspace it kept; the caller
 * writes the halt record and stops. A fatal failure during the launch cancels the arm's process
 * group, skips every correction and the hidden scoring, and never starts another launch.
 */
async function runLaunch(manifest, manifestDigest, launch, runsDirectory, owner) {
  const task = manifest.tasks.find((one) => one.id === launch.task);
  const { pins, budgets } = manifest;
  const cell = cellFiles(runsDirectory, launch.task, launch.arm);
  const halt = (fatal, extra = {}) => ({
    kind: "halt",
    fatal,
    launch,
    attemptRecord: null,
    scratch: null,
    cleanup: noCleanup(),
    ...extra,
  });
  if (cell.recorded) {
    // A record that is there but is not a valid record of this manifest is invalid state, and
    // invalid state does not pass as "done".
    // The stored form carries the command log beside the record's own fields.
    const { commands: _commands, ...stored } = readRecord(join(runsDirectory, cell.record));
    const parsed = recordSchema.safeParse(stored);
    if (!parsed.success || parsed.data.manifestDigest !== manifestDigest)
      return halt(
        new FatalError(
          "records",
          `${cell.record} exists and is not a valid record of this manifest: ${parsed.success ? "it names another manifest" : parsed.error.message.slice(0, 300)}`,
        ),
      );
    console.log(`skip ${launch.task} ${launch.arm}: recorded`);
    return { kind: "skipped" };
  }
  // The protocol's rerun rule: a launch gets at most one rerun, each failed attempt kept beside
  // the next under its own name. A cell that has failed twice is not launched again, and is not
  // passed over in silence either.
  if (cell.failedAttempts >= 2)
    return halt(
      new FatalError(
        "records",
        `${launch.task} ${launch.arm} has ${cell.failedAttempts} failed attempts; the protocol allows one rerun`,
      ),
    );
  // Nothing has been dispatched when the pins fail here, so the halt names no launch and every
  // selected cell, this one included, remains.
  const validation = await revalidate(manifest);
  if (validation.problems.length > 0)
    return halt(new FatalError(validation.class, validation.problems.join("; ")), { launch: null });
  const probe = validation.probe;
  const blobs = join(comparisonRoot, "blobs");
  const log = commandLog(blobs, { signal: interruption.controller.signal });
  const startedAt = new Date().toISOString();
  mkdirSync(join(comparisonRoot, "work"), { recursive: true });
  const scratch = mkdtempSync(join(comparisonRoot, "work", `${launch.task}.${launch.arm}-`));
  const workspace = join(scratch, "workspace");
  updateLock(runsDirectory, owner, { launch, scratch });
  const notes = [];
  if (probe.instance === null)
    notes.push(
      "no local process was found listening on the endpoint port, so the endpoint could not be watched during the invocations; only the probe after each invocation applies",
    );
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
      endpointInstance: probe.instance,
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
  let fatal = null;
  const home = join(scratch, "home");
  try {
    console.log(`launch ${launch.order}: ${launch.task} ${launch.arm}`);
    const preparationStarted = Date.now();
    await cloneAtBase(log, task, task.baseCommit, workspace);
    const base = await commitVisibleCheck(log, task, workspace);
    const prepared = await prepare(log, task, workspace);
    writeArmConfiguration(workspace, launch.arm, pins.endpoint, pins.model, task);
    // The launch's own mutable state, declared before anything runs in it. What the manifest
    // declares a task to need (nothing but the lockfile install, unless it says otherwise) is
    // what the fresh home must show; a prerequisite this harness does not provision cannot be
    // declared required, and a home that is not fresh is not this launch's.
    const prerequisites = manifest.prerequisites ?? { browsers: false };
    if (prerequisites.browsers === true)
      throw new FatalError(
        "configuration",
        `${launch.task} declares browsers as a required prerequisite and this harness does not provision them; declare browsers: false or provision them before freezing`,
      );
    const launchHome = prepareLaunchHome(home);
    const browserCacheBefore = browserCacheIn(home);
    record.preparedState = {
      home,
      fresh: true,
      npmCache: launchHome.npmCache,
      browserCacheBefore,
      browserCacheAfter: browserCacheBefore,
    };
    if (browserCacheBefore !== prerequisites.browsers)
      throw new FatalError(
        "preparation",
        `the declared prepared state does not hold for ${launch.task} ${launch.arm}: a browser cache is ${browserCacheBefore ? "present" : "absent"} in the fresh home ${home} and the manifest declares browsers: ${prerequisites.browsers}`,
      );
    record.preparation = {
      wallMs: Date.now() - preparationStarted,
      ok: prepared.ok,
      detail: prepared.detail,
    };
    if (interrupted()) throw interrupted();
    if (!prepared.ok)
      throw new FatalError(
        "preparation",
        `preparation failed: ${prepared.failed.join(" ")}\n${prepared.detail}`,
      );
    // Swarm's effective gate plan, measured by the product itself under this launch's home and
    // held against the command the task names, before the arm is given the task. A product that
    // would run some other command as its blocking tests gate, or whose gate fails on the base
    // in this environment, is not dispatched: that is the supervisor's setup, never the arm's
    // result, and the pilot's upgrade launch is what happens when it is dispatched anyway.
    if (launch.arm === "swarm") {
      const gatePlan = await swarmGatePlanVerdict(log, task, task.baseCommit, pins, home);
      record.gatePlan = gatePlan;
      record.preparation.wallMs = Date.now() - preparationStarted;
      if (interrupted()) throw interrupted();
      if (!gatePlan.ok)
        throw new FatalError(
          "configuration",
          `Swarm's effective tests gate for ${launch.task} is not the task's: ${gatePlan.detail}`,
        );
    }

    const deadlineMs = Date.now() + budgets.wallMsPerInvocation;
    const turn = {
      prompt: taskPrompt(task),
      kind: "initial",
      correction: 0,
      deadlineMs,
      instance: probe.instance,
      home,
      // The lock names the arm's process while it runs, so a runner killed without cleanup leaves
      // the next start exactly what to stop.
      onChild: (pid) =>
        updateLock(runsDirectory, owner, { child: { pid, started: processStart(pid) } }),
    };
    const evidenceDirectories = [];
    for (; turn.correction <= budgets.maxCorrections; turn.correction += 1) {
      const invoked = await invokeArm(
        log,
        launch,
        pins,
        budgets,
        task,
        workspace,
        base,
        turn,
        scratch,
      );
      record.invocations.push({ ...invoked.invocation, visible: emptyVisible() });
      if (invoked.fatal !== null) throw invoked.fatal;
      // An endpoint that died or restarted while the arm was talking to it is a failed
      // instrument; the invocation is kept and the campaign stops.
      const change = instanceChange(probe.instance, await probeEndpoint(pins.endpoint));
      if (change !== null)
        throw new FatalError("endpoint", `${change} during the ${turn.kind} invocation`);
      const armFault = fatalInvocation({
        arm: launch.arm,
        exitCode: invoked.ran.exitCode,
        signal: invoked.ran.signal,
        stdout: invoked.stdout,
        evidenceDirectory: invoked.evidence,
        exists: existsSync,
      });
      if (armFault !== null) throw new FatalError(armFault.class, armFault.reason);
      if (invoked.evidence) evidenceDirectories.push(invoked.evidence);
      const patch = await finalPatch(log, workspace, base);
      const visible = await visibleVerdict(log, task, task.baseCommit, patch);
      if (interrupted()) throw interrupted();
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
      if (turn.correction === budgets.maxCorrections || Date.now() >= deadlineMs) {
        if (Date.now() >= deadlineMs)
          notes.push("the wall budget was spent before the corrections were");
        break;
      }
      record.corrections = turn.correction + 1;
      turn.prompt = correctionPrompt(task, visible.detail);
      turn.kind = "correction";
    }
    const patch = await finalPatch(log, workspace, base);
    record.finalPatchDigest = storeBlob(blobs, Buffer.from(patch));
    record.finalPatchBytes = Buffer.byteLength(patch);
    // What the arm left in its own home: recorded, and removed with the launch, so it reaches
    // no later launch. A browser cache here is the arm installing a prerequisite inside a
    // measured task, which the record names rather than hides.
    if (record.preparedState !== undefined) {
      const browserCacheAfter = browserCacheIn(home);
      record.preparedState = { ...record.preparedState, browserCacheAfter };
      if (browserCacheAfter && !record.preparedState.browserCacheBefore)
        notes.push(
          "the arm installed a browser cache into its own launch home during the task; it is removed with the launch and was not available to any other launch",
        );
    }
    const hidden = await hiddenVerdict(log, task, task.baseCommit, task.upstreamCommit, patch);
    if (interrupted()) throw interrupted();
    record.hidden = {
      verdict: hidden.verdict,
      basis: hidden.basis,
      detailDigest: storeBlob(blobs, Buffer.from(hidden.detail ?? "")),
    };
    // A verdict the scorer could not reach is a failure of the instrument or an uncertain case,
    // and either stops the campaign for diagnosis rather than counting against the arm.
    if (hidden.verdict === "unjudgeable")
      throw new FatalError("scorer", `the hidden oracle could not judge the tree: ${hidden.basis}`);
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
    fatal =
      cause instanceof FatalError
        ? cause
        : new FatalError("harness", `harness exception: ${cause?.stack ?? cause}`);
  }

  record.endedAt = new Date().toISOString();
  record.totals = {
    agentWallMs: record.invocations.reduce((sum, one) => sum + one.wallMs, 0),
    tokens:
      record.invocations.length > 0 && record.invocations.every((one) => one.tokens === null)
        ? null
        : record.invocations.reduce((sum, one) => sum + (one.tokens ?? 0), 0),
    tokensUnknownInvocations: record.invocations.filter((one) => one.tokens === null).length,
  };
  try {
    writeFileSync(join(scratch, "commands.json"), JSON.stringify(log.commands, null, 2));
  } catch (cause) {
    fatal ??= new FatalError("records", `the command log could not be written: ${cause.message}`);
  }
  // The halt record this attempt would sit beside is named now, so the attempt can cite it.
  const haltName = nextNumbered(runsDirectory, "halt");
  const markHalted = (failure) => {
    record.infrastructureFailure = failure.message;
    record.halt = { class: failure.class, record: haltName };
    notes.push(failure.message);
  };
  if (fatal !== null) markHalted(fatal);
  const parsed = recordSchema.safeParse(record);
  if (!parsed.success) {
    if (fatal === null) {
      fatal = new FatalError(
        "records",
        `the record did not validate: ${parsed.error.message.slice(0, 500)}`,
      );
      markHalted(fatal);
    } else notes.push(`the attempt record did not validate: ${parsed.error.message.slice(0, 500)}`);
  }
  const name = fatal === null ? cell.record : cell.nextHalted;
  const destination = join(runsDirectory, name);
  let attemptRecord = null;
  try {
    writeFileSync(
      destination,
      `${JSON.stringify({ ...record, commands: log.commands }, null, 2)}\n`,
      { flag: "wx" },
    );
    attemptRecord = name;
    const missing = missingEvidence(record, blobs);
    if (missing.length > 0)
      fatal ??= new FatalError(
        "records",
        `${name} cites evidence that is not in the blob store: ${missing.join(", ")}`,
      );
  } catch (cause) {
    fatal ??= new FatalError(
      "records",
      `the record could not be written to ${destination}: ${cause.message}`,
    );
  }
  console.log(
    `  ${launch.task} ${launch.arm}: hidden ${record.hidden.verdict}, corrections ${record.corrections}, visible ${record.resolvedVisible ? "resolved" : "unresolved"}, ${Math.round(record.totals.agentWallMs / 1000)}s agent, tokens ${record.totals.tokens ?? "unknown"}${fatal ? `, HALT (${fatal.class}): ${fatal.message.split("\n")[0]}` : ""}`,
  );
  if (fatal === null) {
    if (!args.has("keep")) rmSync(scratch, { recursive: true, force: true });
    updateLock(runsDirectory, owner, { launch: null, scratch: null });
    return { kind: "recorded" };
  }
  const termination = log.lastTermination;
  return halt(fatal, {
    attemptRecord,
    scratch,
    haltName,
    cleanup:
      termination === null
        ? noCleanup()
        : {
            outcome: termination.confirmed ? "terminated" : "unconfirmed",
            wallMs: termination.ms ?? terminationDeadlineMs,
            deadlineMs: terminationDeadlineMs,
          },
  });
}

const remainingLaunches = (selected, runsDirectory, current = null) =>
  selected
    .filter(
      (launch) =>
        !cellFiles(runsDirectory, launch.task, launch.arm).recorded &&
        !(current && launch.task === current.task && launch.arm === current.arm),
    )
    .map(({ task, arm, order }) => ({ task, arm, order }));

/** Write the halt record and say where it is; a halt that cannot be recorded still stops. */
function recordHalt(runsDirectory, manifest, manifestDigest, owner, outcome, remaining) {
  const { fatal } = outcome;
  const halt = {
    schema: "swarm-ordinary-comparison.halt.v1",
    manifestDigest,
    class: fatal.class,
    reason: fatal.message,
    detectedAt: fatal.detectedAt.toISOString(),
    haltedAt: new Date().toISOString(),
    launch: outcome.launch
      ? { task: outcome.launch.task, arm: outcome.launch.arm, order: outcome.launch.order }
      : null,
    attemptRecord: outcome.attemptRecord ?? null,
    scratch: outcome.scratch ?? null,
    cleanup: outcome.cleanup,
    orphans: outcome.orphans ?? [],
    remaining,
    identity: {
      pins: manifest.pins,
      harnessDigest: harnessDigest(),
      node: process.version,
      platform: process.platform,
    },
    runner: { pid: owner.pid, started: owner.started },
    notes: outcome.notes ?? [],
  };
  let where;
  try {
    where = join(runsDirectory, writeHalt(runsDirectory, halt, outcome.haltName));
  } catch (cause) {
    where = `(the halt record could not be written: ${cause.message})`;
  }
  console.error(
    `halted (${fatal.class}): ${fatal.message.split("\n")[0]}\n  halt record: ${where}\n  affected attempt: ${halt.attemptRecord ?? "none"}${halt.scratch ? `\n  kept workspace: ${halt.scratch}` : ""}\n  remaining launches: ${remaining.length}\n  to resume after repair: run the same command with --recover --justification "<why>"`,
  );
  return where;
}

async function recover(manifest, manifestDigest, runsDirectory, selected) {
  const justification = args.get("justification");
  if (!justification || justification === "true") {
    console.error("--recover needs --justification <why resumption is sound>");
    return 2;
  }
  const state = campaignState(runsDirectory);
  if (!state.halted) {
    console.error("nothing to recover: the campaign is not halted");
    return 2;
  }
  const validation = await revalidate(manifest);
  if (validation.problems.length > 0) {
    console.error(
      `recovery refused; the prerequisites do not hold:\n  ${validation.problems.join("\n  ")}`,
    );
    return 3;
  }
  const remaining = remainingLaunches(selected, runsDirectory);
  const name = writeRecovery(runsDirectory, {
    schema: "swarm-ordinary-comparison.recovery.v1",
    manifestDigest,
    recoveredAt: new Date().toISOString(),
    clears: state.lastHalt,
    clearsDigest: digestOf(readFileSync(join(runsDirectory, state.lastHalt), "utf8")),
    justification,
    revalidation: { problems: [], ...validation.observed },
    completed: selected.length - remaining.length,
    remaining,
  });
  console.log(
    `recovered: ${name} clears ${state.lastHalt}; ${remaining.length} launch(es) remain; run the same command without --recover to continue`,
  );
  return 0;
}

/**
 * The previous runner ended without releasing its lock: SIGKILL, a crash, or power. What it left
 * (an arm still running, a workspace, an attempt without a record) is uncertain state, so it is
 * recorded as an interruption, its orphaned child is stopped, and resumption needs an explicit
 * recovery.
 */
async function recordStaleLock(runsDirectory, manifest, manifestDigest, owner, holder, remaining) {
  const orphans =
    holder?.child && Number.isInteger(holder.child.pid)
      ? [await terminateGroup(holder.child.pid, holder.child.started ?? null)]
      : [];
  const fatal = new FatalError(
    "interrupted",
    `runner pid ${holder?.pid ?? "unknown"} (started ${holder?.started ?? "unknown"}) ended without cleanup${holder?.launch ? ` during ${holder.launch.task} ${holder.launch.arm}` : ""}; its lock was still present`,
  );
  const first = orphans[0];
  const where = recordHalt(
    runsDirectory,
    manifest,
    manifestDigest,
    owner,
    {
      fatal,
      launch: holder?.launch ?? null,
      scratch: holder?.scratch ?? null,
      orphans: orphans.map(({ pid, started, outcome }) => ({ pid, started, outcome })),
      cleanup:
        first === undefined || first.outcome === "already-gone"
          ? noCleanup()
          : { outcome: first.outcome, wallMs: first.wallMs, deadlineMs: terminationDeadlineMs },
      notes: holder?.invalid ? [`the lock file was unreadable: ${holder.invalid}`] : [],
    },
    remaining,
  );
  // The interruption is on record; the stale lock has done its job.
  if (!where.startsWith("(")) rmSync(lockPath(runsDirectory), { force: true });
}

async function main() {
  if (args.has("freeze")) {
    await freeze(args.get("out") ?? "manifest.json");
    return 0;
  }
  if (!args.has("manifest")) {
    console.error(
      "usage: run.mjs --freeze --out <manifest> | --manifest <file> [--only <task>] [--arm <arm>] [--dry-run | --status | --recover --justification <why>]",
    );
    return 2;
  }
  const bytes = readFileSync(args.get("manifest"));
  const manifest = JSON.parse(bytes.toString());
  const manifestDigest = digestOf(bytes.toString());
  if (manifest.pins.harnessDigest !== harnessDigest()) {
    console.error(
      `the harness in scripts/comparison differs from the one the manifest froze (${manifest.pins.harnessDigest ?? "none recorded"}); re-freeze before launching`,
    );
    return 2;
  }
  const runsDirectory = join(comparisonRoot, "runs", manifestDigest.slice(7, 23));
  mkdirSync(runsDirectory, { recursive: true });
  const selected = manifest.launches.filter(
    (launch) =>
      (!args.has("only") || launch.task === args.get("only")) &&
      (!args.has("arm") || launch.arm === args.get("arm")),
  );
  if (args.has("dry-run") || args.has("status")) {
    const state = campaignState(runsDirectory);
    if (args.has("dry-run"))
      for (const launch of selected) console.log(`${launch.order} ${launch.task} ${launch.arm}`);
    console.log(
      JSON.stringify({
        runs: runsDirectory,
        halted: state.halted,
        halts: state.halts,
        recoveries: state.recoveries,
        lock: existsSync(lockPath(runsDirectory)),
        remaining: remainingLaunches(selected, runsDirectory).length,
      }),
    );
    return 0;
  }

  const owner = {
    pid: process.pid,
    started: processStart(process.pid),
    startedAt: new Date().toISOString(),
    launch: null,
    scratch: null,
    child: null,
  };
  const lock = acquireLock(runsDirectory, owner);
  if (!lock.acquired) {
    if (lock.alive) {
      console.error(
        `another runner (pid ${lock.holder.pid}, started ${lock.holder.started}) holds ${lockPath(runsDirectory)}; not dispatching`,
      );
      return 4;
    }
    await recordStaleLock(
      runsDirectory,
      manifest,
      manifestDigest,
      owner,
      lock.holder,
      remainingLaunches(selected, runsDirectory),
    );
    return 3;
  }
  try {
    if (args.has("recover"))
      return await recover(manifest, manifestDigest, runsDirectory, selected);
    const state = campaignState(runsDirectory);
    if (state.halted) {
      console.error(
        `the campaign is halted (${join(runsDirectory, state.lastHalt)}); repair the cause, then run the same command with --recover --justification "<why>"`,
      );
      return 3;
    }
    for (const launch of selected) {
      if (interrupted()) {
        recordHalt(
          runsDirectory,
          manifest,
          manifestDigest,
          owner,
          { fatal: interrupted(), launch: null, cleanup: noCleanup() },
          remainingLaunches(selected, runsDirectory),
        );
        return interruptedExit();
      }
      const outcome = await runLaunch(manifest, manifestDigest, launch, runsDirectory, owner);
      if (outcome.kind === "halt") {
        recordHalt(
          runsDirectory,
          manifest,
          manifestDigest,
          owner,
          outcome,
          remainingLaunches(selected, runsDirectory, outcome.launch),
        );
        return interrupted() ? interruptedExit() : 3;
      }
    }
    return 0;
  } finally {
    const failed = releaseLock(runsDirectory, owner);
    if (failed !== null) console.error(failed);
  }
}

process.exit(await main());
