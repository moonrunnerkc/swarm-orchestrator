/**
 * The capability study's runner: every registered launch of a frozen manifest, one at a time, in
 * the frozen order, through the one launch builder (launch-config.mjs), each outcome written once.
 *
 *   node scripts/comparison/study.mjs --freeze --config <study-config.json> --out <manifest.json>
 *   node scripts/comparison/study.mjs --manifest <manifest.json> [--only <task>] [--arm <arm>]
 *   node scripts/comparison/study.mjs --manifest <manifest.json> --correction "<what was corrected>"
 *   node scripts/comparison/study.mjs --manifest <manifest.json> --status
 *
 * The rules it enforces are the protocol's, not a judgement made per launch:
 *
 * - Before any task inference a launch's whole configuration is validated with no model call:
 *   the pinned executables and their versions, the model's chat and tool round trip, workspace
 *   and inputs, the built environment and PATH, task preparation, effective permissions measured
 *   from inside the launch's own execution profile, and the evidence and scoring paths.
 * - A launch that stops before its arm made any model request is a zero-inference setup failure.
 *   It is written as its own record, the runner stops, and after a recorded correction the same
 *   frozen arm and task are tried again, at most `budgets.setupRetries` more times. Every setup
 *   failure record is kept.
 * - Once the arm has made a model request, its outcome stands under the registered rules, whatever
 *   the artifact is, and an infrastructure failure after that point is retained as that cell's
 *   outcome. Nothing is retried because an artifact failed.
 * - Every registered launch runs whatever the others delivered.
 *
 * Records sit beside the manifest under runs/; the manifest and runs directory live under a root
 * the arms' execution profile denies, because a held-out manifest carries its hidden checks.
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { commandLog, storeBlob } from "../campaign/exec.mjs";
import {
  aiderTokens,
  aiderUsage,
  claimedSuccess,
  completionAccount,
  opencodeTokens,
  opencodeUsage,
  swarmContract,
  swarmEvidenceDirectory,
  swarmResult,
  swarmTokens,
  swarmUsage,
  taskPrompt,
} from "./arms.mjs";
import { hiddenVerdict, staticVerdict, swarmGatePlanVerdict, visibleVerdict } from "./checks.mjs";
import {
  acquireLock,
  FatalError,
  fatalInvocation,
  processStart,
  releaseLock,
  stopStrays,
  terminationDeadlineMs,
} from "./control.mjs";
import { endpointPort, instanceChange, probeEndpoint, watchInstance } from "./endpoint.mjs";
import { harnessDigest } from "./harness-identity.mjs";
import { createInferenceLease, establishReadiness, probeTotals } from "./inference.mjs";
import {
  aiderAnalyticsLog,
  buildLaunch,
  inferenceBegan,
  isSwarmArm,
  launchArms,
  resolveFrozenInput,
  shortTemporaryDirectory,
  treeDigest,
  validateLaunch,
  versionOfExecutable,
} from "./launch-config.mjs";
import { frozenOrder } from "./order.mjs";
import { taskSchema } from "./schema.mjs";
import { createStallWatch, inferenceDeadlineMs, pollStallWatch } from "./stall.mjs";
import {
  cloneAtBase,
  commitHarnessLockfile,
  commitVisibleCheck,
  declaredPackageManager,
  finalPatch,
  mirrorOf,
  packageManagerToolchain,
  prepare,
  prepareLaunchHome,
  resolveFull,
  snapshotPatch,
  workRoot,
  writeArmConfiguration,
} from "./workspace.mjs";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const manifestSchemaName = "swarm-capability-study.manifest.v1";
export const recordSchemaName = "swarm-capability-study.record.v1";

/**
 * The frozen order: tasks by the seeded hash the comparison has always used, and for each task
 * the arms rotated by its position, so every arm goes first on an equal share of tasks and no arm
 * is always last after the others have warmed a cache.
 */
export function studyOrder(taskIds, arms) {
  const out = [];
  frozenOrder(taskIds).forEach((task, index) => {
    for (let offset = 0; offset < arms.length; offset += 1)
      out.push({ task, arm: arms[(index + offset) % arms.length], order: out.length });
  });
  return out;
}

/**
 * The cell a launch fills: its task, with the sample number where a manifest registers more than
 * one launch of the same task and arm, so two samples never share a record.
 */
export const cellKey = (launch) =>
  (launch.sample ?? 1) > 1 ? `${launch.task}~${launch.sample}` : launch.task;

/** What is on disk for one cell: its outcome if written, and its setup failures so far. */
export function cellState(runsDirectory, task, arm) {
  const names = existsSync(runsDirectory) ? readdirSync(runsDirectory) : [];
  const prefix = `${task}.${arm}.`;
  return {
    recorded: names.includes(`${prefix}json`),
    setupFailures: names.filter((name) => name.startsWith(`${prefix}setup-`)).sort(),
    record: `${prefix}json`,
    nextSetup: `${prefix}setup-${names.filter((name) => name.startsWith(`${prefix}setup-`)).length + 1}.json`,
  };
}

/**
 * How a stopped launch is kept: before any model request it is a setup failure, and after one
 * the attempt is the cell's outcome. The arm's own failure to deliver is neither: it is scored.
 */
export function classifyStop({ fatal, inference }) {
  if (fatal === null) return "scored";
  return inference ? "retained-after-inference" : "setup-failure";
}

/** Whether any text an arm left names a route to sealed material; the markers are the manifest's. */
/**
 * The line printed as a launch ends: what ran, how it ended and what it spent. Never a verdict:
 * the frozen block's hidden results are read only after its last launch is scored, and on
 * October 23 the implementer read three of them off this line while diagnosing a setup failure.
 * The visible check's result is left out with them, since it is a correctness reading as well.
 */
export function progressLine(launch, record, fatal) {
  const wall = record.invocation?.wallMs;
  const tokens = record.invocation?.tokens;
  const health = [
    record.outcome,
    ...(typeof wall === "number" ? [`${Math.round(wall / 1000)} s`] : []),
    ...(typeof tokens === "number" ? [`${tokens} tokens`] : []),
    ...(record.scores === undefined ? [] : ["scored, sealed"]),
  ];
  return `${launch.order} ${launch.task} ${launch.arm}: ${health.join(", ")}${fatal ? ` (${fatal.class}: ${fatal.message.split("\n")[0]})` : ""}`;
}

/** Where a record's hidden verdict is kept until `reveal`. */
export const sealedDirectory = "sealed-hidden";

/** Writes a launch's hidden verdict apart from its record, readable by the owner alone. */
export function sealHidden(runsDirectory, recordName, hidden) {
  const directory = join(runsDirectory, sealedDirectory);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const bytes = `${JSON.stringify(hidden, null, 2)}\n`;
  writeFileSync(join(directory, recordName), bytes, { flag: "wx", mode: 0o600 });
  return { sealed: `${sealedDirectory}/${recordName}`, digest: digestOf(Buffer.from(bytes)) };
}

/**
 * Every record of the block with its hidden verdict put back, once every registered launch has an
 * outcome: a block with a launch still pending, or stopped, is not revealed. Each sealed file must
 * be the bytes its record names.
 */
export function revealHidden(runsDirectory, launches) {
  const pending = [];
  const revealed = [];
  for (const launch of launches) {
    const cell = cellState(runsDirectory, cellKey(launch), launch.arm);
    if (!cell.recorded) {
      pending.push(`${launch.order} ${launch.task} ${launch.arm}`);
      continue;
    }
    const record = JSON.parse(readFileSync(join(runsDirectory, cell.record), "utf8"));
    const sealed = record.scores?.hidden;
    if (sealed?.sealed !== undefined) {
      const bytes = readFileSync(join(runsDirectory, sealed.sealed));
      if (digestOf(bytes) !== sealed.digest)
        throw new Error(`${sealed.sealed} is not the verdict ${cell.record} sealed`);
      record.scores = { ...record.scores, hidden: JSON.parse(bytes.toString("utf8")) };
    }
    revealed.push(record);
  }
  if (pending.length > 0)
    throw new Error(`the block is not finished; pending: ${pending.join("; ")}`);
  return revealed;
}

export function exposureHits(texts, markers) {
  const hits = [];
  for (const [label, text] of texts)
    for (const marker of markers)
      if (marker.length >= 7 && text.includes(marker)) hits.push({ in: label, marker });
  return hits;
}

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

/** The manifest from a study configuration, with every identity resolved and digested now. */
async function freeze(configPath, outPath) {
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  const { tasks } = await import(pathToFileURL(resolve(config.tasksModule)).href);
  const selected = tasks.filter((task) => config.taskIds.includes(task.id));
  if (selected.length !== config.taskIds.length)
    throw new Error("a configured task id is not in the tasks module");
  const log = commandLog(join(dirname(resolve(outPath)), "freeze-blobs"));
  const resolved = [];
  const lockfiles = {};
  for (const task of selected) {
    taskSchema.parse(task);
    const commits = await resolveFull(log, task);
    resolved.push({ ...task, baseCommit: commits.base, upstreamCommit: commits.upstream });
    const lock = await log.run(["git", "cat-file", "-e", `${commits.base}:package-lock.json`], {
      cwd: mirrorOf(task.repository),
      timeoutMs: 60_000,
    });
    lockfiles[task.id] =
      lock.exitCode === 0 || config.harnessLockfiles?.[task.id] !== undefined
        ? "package-lock.json"
        : null;
  }
  for (const arm of config.arms)
    if (!launchArms.includes(arm)) throw new Error(`unknown arm ${arm}`);
  const opencode = config.arms.includes("opencode")
    ? versionOfExecutable(config.pins.opencodeBin)
    : null;
  const aider = config.arms.includes("aider") ? versionOfExecutable(config.pins.aiderBin) : null;
  const manifest = {
    schema: manifestSchemaName,
    frozenAt: new Date().toISOString(),
    protocolDigest: digestOf(readFileSync(config.protocol)),
    protocol: config.protocol,
    harnessDigest: harnessDigest(),
    pins: {
      ...config.pins,
      node: versionOfExecutable(config.pins.nodeBin).version,
      swarmCliDigest: digestOf(readFileSync(config.pins.swarmCli)),
      swarmBuildDigest: treeDigest(dirname(config.pins.swarmCli)),
      ...(opencode === null ? {} : { opencode: opencode.version }),
      ...(aider === null ? {} : { aider: aider.version }),
    },
    // An arm with its own pinned build carries that build's digests, frozen as the main pin's are.
    arms: Object.fromEntries(
      config.arms.map((arm) => {
        const settings = config.armSettings?.[arm] ?? {};
        return [
          arm,
          typeof settings.swarmCli === "string"
            ? {
                ...settings,
                swarmCliDigest: digestOf(readFileSync(settings.swarmCli)),
                swarmBuildDigest: treeDigest(dirname(settings.swarmCli)),
              }
            : settings,
        ];
      }),
    ),
    budgets: {
      setupRetries: 2,
      wallGraceMs: 60_000,
      inferenceDeadlineMs,
      ...config.budgets,
    },
    isolation: config.isolation,
    inputRoots: config.inputRoots ?? [],
    frozenInputs: config.frozenInputs ?? {},
    exposureMarkers: config.exposureMarkers ?? [],
    lockfiles,
    harnessLockfiles: config.harnessLockfiles ?? {},
    tasks: resolved,
    launches:
      config.order === "listed"
        ? config.launches
        : studyOrder(
            resolved.map((task) => task.id),
            config.arms,
          ),
  };
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  console.log(
    `froze ${manifest.launches.length} launches over ${resolved.length} tasks to ${outPath}`,
  );
}

const interruption = { signal: null, controller: new AbortController() };
for (const name of ["SIGINT", "SIGTERM"])
  process.on(name, () => {
    if (interruption.signal !== null) return;
    interruption.signal = name;
    interruption.controller.abort(new FatalError("interrupted", `the runner received ${name}`));
  });

const inferenceLease = createInferenceLease();

/** One launch, from validation to its written record. Returns how it ended. */
async function runLaunch(manifest, manifestDigest, launch, runsDirectory) {
  const task = manifest.tasks.find((one) => one.id === launch.task);
  const { pins, budgets } = manifest;
  const cell = cellState(runsDirectory, cellKey(launch), launch.arm);
  const family = isSwarmArm(launch.arm) ? "swarm" : launch.arm;
  const blobs = join(runsDirectory, "blobs");
  const log = commandLog(blobs, { signal: interruption.controller.signal });
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `${launch.task}.${launch.arm}-`));
  const tmpDir = shortTemporaryDirectory();
  const workspace = join(scratch, "workspace");
  const home = join(scratch, "home");
  const record = {
    schema: recordSchemaName,
    manifestDigest,
    task: launch.task,
    sample: launch.sample ?? 1,
    harnessDigest: harnessDigest(),
    arm: launch.arm,
    order: launch.order,
    startedAt: new Date().toISOString(),
    validation: null,
    readiness: null,
    invocation: null,
    inferenceBegan: false,
    outcome: null,
    infrastructureFailure: null,
    notes: [],
  };
  let fatal = null;
  let stdout = "";
  try {
    // The model must answer a chat and a tool round trip in the product's wire shape before the
    // arm is given the task; a listing alone dispatches nothing.
    const probe = await probeEndpoint(pins.endpoint);
    if (probe.problem !== null || !probe.models.includes(pins.model))
      throw new FatalError(
        "endpoint",
        `the endpoint does not serve ${pins.model}: ${probe.problem ?? probe.models.join(", ")}`,
      );
    const readiness = await establishReadiness(
      {
        endpoint: pins.endpoint,
        model: pins.model,
        purpose: "readiness",
        lease: inferenceLease,
        requestDeadlineMs: budgets.readinessRequestDeadlineMs ?? 30_000,
        sequenceDeadlineMs: budgets.readinessSequenceDeadlineMs ?? 90_000,
      },
      budgets.readinessSequences ?? 2,
    );
    record.readiness = { ok: readiness.ok, totals: probeTotals(readiness.sequences) };
    if (!readiness.ok)
      throw new FatalError(
        "endpoint",
        "the model did not complete a chat and tool round trip before dispatch",
      );

    const preparationStarted = Date.now();
    await cloneAtBase(log, task, task.baseCommit, workspace);
    let base = await commitVisibleCheck(log, task, workspace);
    // A base with no lockfile gets the one the harness resolved for it, frozen by digest and
    // committed beside the visible check, so every arm installs the same versions, Swarm can
    // install from a fresh checkout, and the file is never part of an arm's change.
    const lockInput = manifest.harnessLockfiles?.[task.id];
    let harnessLockBytes = null;
    if (lockInput !== undefined) {
      const found = resolveFrozenInput(manifest, lockInput);
      if (found === null)
        throw new FatalError(
          "configuration",
          `the frozen lockfile ${lockInput.digest} for ${task.id} is not under the registered input roots`,
        );
      harnessLockBytes = found.bytes;
      const committed = await commitHarnessLockfile(log, workspace, found.bytes);
      if (committed.base === null)
        throw new FatalError(
          "preparation",
          `committing the harness lockfile failed: ${committed.detail}`,
        );
      base = committed.base;
      record.harnessLockfile = { digest: lockInput.digest, base };
    }
    const prepared = await prepare(log, task, workspace);
    record.preparation = {
      ok: prepared.ok,
      wallMs: Date.now() - preparationStarted,
      detail: prepared.detail,
    };
    if (!prepared.ok)
      throw new FatalError("preparation", `preparation failed: ${prepared.failed.join(" ")}`);
    writeArmConfiguration(
      workspace,
      launch.arm,
      pins.endpoint,
      pins.model,
      task,
      manifest.swarmGates?.[task.id] ?? {},
    );
    prepareLaunchHome(home);
    if (isSwarmArm(launch.arm)) {
      // Measured under a home of its own, prepared as the arm's is: the product's check leaves
      // files in the HOME it runs under, and the arm's home must reach the arm as prepared.
      const gatePlanHome = join(scratch, "gate-plan-home");
      prepareLaunchHome(gatePlanHome);
      const gatePlan = await swarmGatePlanVerdict(
        log,
        task,
        task.baseCommit,
        pins,
        gatePlanHome,
        manifest.swarmGates?.[task.id] ?? {},
        harnessLockBytes,
        {
          contract: swarmContract(task),
          lockfile:
            manifest.lockfiles?.[task.id] === null
              ? null
              : (manifest.lockfiles?.[task.id] ?? "package-lock.json"),
        },
      );
      record.gatePlan = gatePlan;
      if (!gatePlan.ok)
        throw new FatalError(
          "configuration",
          `Swarm's effective tests gate is not the task's: ${gatePlan.detail}`,
        );
    }
    const contractPath = join(scratch, "contract.json");
    writeFileSync(contractPath, JSON.stringify(swarmContract(task), null, 2));
    const deadlineMs = Date.now() + budgets.wallMsPerLaunch;
    // Only the declared package manager's pinned directory comes from the task environment;
    // nothing else of the experimenter's PATH reaches an arm.
    const declared = declaredPackageManager(task);
    const taskPath =
      declared === null
        ? []
        : [join(packageManagerToolchain(declared.name, declared.version), "node_modules", ".bin")];
    const launchSpec = buildLaunch({
      manifest,
      arm: launch.arm,
      task,
      prompt: taskPrompt(task),
      workspace,
      base,
      contractPath,
      home,
      scratch,
      remainingMs:
        deadlineMs - Date.now() - (isSwarmArm(launch.arm) ? budgets.swarmVerificationReserveMs : 0),
      tokenAllowance: budgets.swarmTokenCap,
      taskPath,
      tmpDir,
    });
    const otherLaunch = join(workRoot, ".study-other-launch");
    mkdirSync(otherLaunch, { recursive: true });
    writeFileSync(join(otherLaunch, "other.txt"), "another launch's file\n");
    const validation = validateLaunch({
      manifest,
      arm: launch.arm,
      launch: launchSpec,
      canary: manifest.isolation.canary,
      otherLaunch,
      inputs: manifest.frozenInputs?.[task.id] ?? [],
    });
    record.validation = {
      ...validation,
      profileDigest: digestOf(launchSpec.profile),
      argv: launchSpec.inner.map((word) => (word === taskPrompt(task) ? "<prompt>" : word)),
    };
    if (!validation.ok)
      throw new FatalError(
        "configuration",
        `launch validation failed: ${validation.checks
          .filter((one) => !one.ok)
          .map((one) => `${one.name} (${one.detail})`)
          .join("; ")}`,
      );
    // A preflight stops here: everything before inference was done and checked, and no arm runs.
    if (args.has("preflight")) {
      record.outcome = "preflight-ok";
      record.endedAt = new Date().toISOString();
      writeFileSync(
        join(runsDirectory, cell.nextSetup.replace(".setup-", ".preflight-")),
        `${JSON.stringify({ ...record, commands: log.commands }, null, 2)}\n`,
        { flag: "wx" },
      );
      rmSync(scratch, { recursive: true, force: true });
      rmSync(tmpDir, { recursive: true, force: true });
      console.log(`${launch.order} ${launch.task} ${launch.arm}: preflight ok`);
      return { outcome: "preflight-ok", fatal: null };
    }

    const watch = new AbortController();
    const stopWatch =
      probe.instance === null
        ? null
        : watchInstance(endpointPort(pins.endpoint), probe.instance, {
            onChange: (reason, at) => watch.abort(new FatalError("endpoint", reason, at)),
          });
    let stalled = null;
    const stallWatch = isSwarmArm(launch.arm)
      ? createStallWatch({ deadlineMs: budgets.inferenceDeadlineMs })
      : null;
    const stopStall =
      stallWatch === null
        ? null
        : pollStallWatch(stallWatch, {
            onStall: (reason, at) => {
              stalled = reason;
              watch.abort(new FatalError("endpoint", reason, at));
            },
          });
    // The harness's own snapshot of the candidate each time a Swarm arm announces an attempt:
    // the product's snapshot is scrubbed like all its evidence, and an initial candidate whose
    // code assigns to a credential-bearing name cannot be rebuilt from it. Taken through a
    // separate index as the attempt starts, before its first model call returns; the record
    // says when, against the attempt event.
    const snapshots = [];
    const snapshotting = [];
    let pendingLine = "";
    const observeAttempts = isSwarmArm(launch.arm)
      ? (chunk) => {
          const text = pendingLine + chunk.toString();
          const lines = text.split("\n");
          pendingLine = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.includes('"type":"attempt"')) continue;
            let attempt;
            try {
              attempt = JSON.parse(line).event?.attempt;
            } catch {
              continue;
            }
            if (typeof attempt !== "number") continue;
            const seenAt = Date.now();
            snapshotting.push(
              snapshotPatch(log, workspace, base, join(tmpDir, `snapshot-${attempt}.index`)).then(
                (patch) => {
                  snapshots.push({
                    attempt,
                    eventAt: new Date(seenAt).toISOString(),
                    tookMs: Date.now() - seenAt,
                    patchDigest: patch === null ? null : storeBlob(blobs, Buffer.from(patch)),
                  });
                },
              ),
            );
          }
        }
      : null;
    const release = inferenceLease.hold(`${launch.arm} invocation of ${launch.task}`);
    let ran;
    try {
      ran = await log.run(launchSpec.argv, {
        cwd: launchSpec.cwd,
        env: launchSpec.env,
        timeoutMs: Math.max(0, deadlineMs - Date.now()),
        killConfirmMs: Math.min(terminationDeadlineMs, budgets.wallGraceMs),
        signal: AbortSignal.any([watch.signal, interruption.controller.signal]),
        onStdout:
          stallWatch === null
            ? null
            : (chunk) => {
                stallWatch.observe(chunk);
                observeAttempts?.(chunk);
              },
      });
    } finally {
      stopWatch?.();
      stopStall?.();
      release();
    }
    stdout = ran.stdout.toString();
    await Promise.allSettled(snapshotting);
    if (snapshots.length > 0)
      record.attemptSnapshots = snapshots.sort((a, b) => a.attempt - b.attempt);
    record.inferenceBegan = inferenceBegan(launch.arm, stdout);
    // aider's token counts are in its analytics log, not its stdout.
    const analytics =
      family === "aider" && existsSync(aiderAnalyticsLog(home))
        ? readFileSync(aiderAnalyticsLog(home), "utf8")
        : null;
    if (analytics !== null) record.aiderAnalyticsDigest = storeBlob(blobs, Buffer.from(analytics));
    record.invocation = {
      exitCode: ran.exitCode,
      signal: ran.signal,
      wallMs: ran.wallMs,
      stdoutDigest: storeBlob(blobs, ran.stdout),
      stderrDigest: storeBlob(blobs, ran.stderr),
      tokens:
        family === "swarm"
          ? swarmTokens(stdout)
          : family === "aider"
            ? aiderTokens(analytics)
            : opencodeTokens(stdout),
      usage:
        family === "swarm"
          ? swarmUsage(stdout)
          : family === "aider"
            ? aiderUsage(analytics)
            : opencodeUsage(stdout),
      claimedSuccess: claimedSuccess(family, ran.exitCode, stdout),
      completion: completionAccount(family, ran.exitCode, ran.signal, stdout),
      productVerdict: family === "swarm" ? (swarmResult(stdout)?.verdict ?? null) : null,
      termination:
        ran.termination === null
          ? null
          : { confirmed: ran.termination.confirmed, ms: ran.termination.ms ?? null },
    };
    if (stalled !== null) throw new FatalError("endpoint", stalled);
    if (watch.signal.aborted) throw watch.signal.reason;
    if (interruption.signal !== null) throw interruption.controller.signal.reason;
    const change = instanceChange(probe.instance, await probeEndpoint(pins.endpoint));
    if (change !== null) throw new FatalError("endpoint", `${change} during the invocation`);
    const evidenceDirectory = family === "swarm" ? swarmEvidenceDirectory(stdout) : null;
    const fault = fatalInvocation({
      arm: family,
      exitCode: ran.exitCode,
      signal: ran.signal,
      stdout,
      evidenceDirectory,
      exists: existsSync,
    });
    if (fault !== null) throw new FatalError(fault.class, fault.reason);
    const strays = await stopStrays(scratch);
    if (strays.unstopped.length > 0)
      throw new FatalError(
        "interrupted",
        `processes still running in the launch directory: ${strays.unstopped.join(", ")}`,
      );
    keepSessions(record, home, runsDirectory, launch);
    const patch = await finalPatch(log, workspace, base);
    record.finalPatchDigest = storeBlob(blobs, Buffer.from(patch));
    record.finalPatchBytes = Buffer.byteLength(patch);
    const visible = await visibleVerdict(log, task, task.baseCommit, patch);
    // The hidden scorer runs under a log of its own: the record carries every command the launch
    // ran, and the exit status of the hidden tests in it is the verdict by another name. Its
    // commands are sealed with the verdict.
    const hiddenLog = commandLog(blobs, { signal: interruption.controller.signal });
    const hidden = await hiddenVerdict(
      hiddenLog,
      task,
      task.baseCommit,
      task.upstreamCommit,
      patch,
    );
    const statics = await staticVerdict(log, task, task.baseCommit, patch);
    record.scores = {
      visible: {
        passed: visible.passed,
        checkExit: visible.checkExit,
        projectTestExit: visible.projectTestExit,
        detailDigest: storeBlob(blobs, Buffer.from(visible.detail)),
      },
      // Sealed until the block ends: the record a person reads while diagnosing a launch says
      // where the verdict is kept, not what it is (`reveal` releases every one at once).
      hidden: sealHidden(runsDirectory, cell.record, {
        verdict: hidden.verdict,
        basis: hidden.basis,
        detailDigest: storeBlob(blobs, Buffer.from(hidden.detail ?? "")),
        policy: hidden.policy ?? null,
        commands: hiddenLog.commands,
      }),
      static: {
        ...statics,
        detail: undefined,
        detailDigest: storeBlob(blobs, Buffer.from(statics.detail ?? "")),
      },
    };
    const sessionText = record.evidence === undefined ? "" : collectText(record.evidence);
    record.exposure = exposureHits(
      [
        ["stdout", stdout],
        ["stderr", ran.stderr.toString()],
        ["session", sessionText],
      ],
      [task.upstreamCommit, ...manifest.exposureMarkers],
    );
    if (hidden.verdict === "unjudgeable")
      throw new FatalError("scorer", `the hidden evaluator could not judge: ${hidden.basis}`);
  } catch (cause) {
    fatal =
      cause instanceof FatalError
        ? cause
        : new FatalError("harness", String(cause?.stack ?? cause));
  }
  // A stop after inference keeps what the product wrote, as a scored launch does.
  if (record.evidence === undefined && existsSync(home))
    keepSessions(record, home, runsDirectory, launch);
  record.endedAt = new Date().toISOString();
  record.outcome = classifyStop({ fatal, inference: record.inferenceBegan });
  if (fatal !== null) record.infrastructureFailure = { class: fatal.class, message: fatal.message };
  // A scorer failure is not the arm's, and keeps the outcome for rescoring; it stops the study.
  const name = record.outcome === "setup-failure" ? cell.nextSetup : cell.record;
  writeFileSync(
    join(runsDirectory, name),
    `${JSON.stringify({ ...record, commands: log.commands }, null, 2)}\n`,
    { flag: "wx" },
  );
  rmSync(scratch, { recursive: true, force: true });
  rmSync(tmpDir, { recursive: true, force: true });
  console.log(progressLine(launch, record, fatal));
  return { outcome: record.outcome, fatal };
}

/**
 * The product's own sessions, kept beside the records before the launch directory goes: every
 * session under the launch's home, whether or not the arm printed where it wrote one. An arm the
 * deadline killed prints no result line, and three development launches lost their sessions that way.
 */
function keepSessions(record, home, runsDirectory, launch) {
  const sessions = join(home, ".swarm", "sessions");
  if (!existsSync(sessions)) return;
  const names = readdirSync(sessions);
  if (names.length === 0) return;
  const kept = join(runsDirectory, "sessions", `${cellKey(launch)}.${launch.arm}`);
  for (const name of names)
    cpSync(join(sessions, name), names.length === 1 ? kept : join(kept, name), { recursive: true });
  record.evidence = kept;
  record.sessionIds = names;
}

/** Every text file a kept session holds, for the exposure scan. */
function collectText(directory) {
  const parts = [];
  for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name);
    if (/\.(json|jsonl|txt|patch)$/.test(entry.name)) parts.push(readFileSync(path, "utf8"));
  }
  return parts.join("\n");
}

async function main() {
  if (args.has("freeze")) return freeze(args.get("config"), args.get("out"));
  const manifestPath = resolve(args.get("manifest"));
  const bytes = readFileSync(manifestPath);
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== manifestSchemaName)
    throw new Error(`${manifestPath} is not a study manifest`);
  const manifestDigest = digestOf(bytes);
  // A preflight's records sit apart, so they never count as a launch or a setup failure.
  const runsDirectory = join(dirname(manifestPath), args.has("preflight") ? "preflight" : "runs");
  mkdirSync(runsDirectory, { recursive: true });
  // The harness a correction moved to, or the frozen one: a changed harness runs only under a
  // recorded correction that names both digests.
  const corrected = readdirSync(runsDirectory)
    .filter((name) => /^correction-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name) => JSON.parse(readFileSync(join(runsDirectory, name), "utf8")).harnessAfter)
    .filter(Boolean);
  const expectedHarness = corrected.at(-1) ?? manifest.harnessDigest;
  const currentHarness = harnessDigest();
  const stoppedAt = join(runsDirectory, "stopped.json");
  if (currentHarness !== expectedHarness && !(existsSync(stoppedAt) && args.has("correction"))) {
    console.error(
      `the harness is ${currentHarness}, not ${expectedHarness}; a changed harness runs only after a stop, with --correction`,
    );
    return 2;
  }
  const selected = manifest.launches.filter(
    (launch) =>
      (!args.has("only") || args.get("only") === launch.task) &&
      (!args.has("arm") || args.get("arm") === launch.arm),
  );
  if (args.has("reveal")) {
    const revealed = revealHidden(runsDirectory, manifest.launches);
    const out = join(runsDirectory, "revealed.json");
    writeFileSync(out, `${JSON.stringify(revealed, null, 2)}\n`, { flag: "wx" });
    console.log(`${revealed.length} records with their hidden verdicts: ${out}`);
    return 0;
  }
  if (args.has("status")) {
    for (const launch of selected) {
      const cell = cellState(runsDirectory, cellKey(launch), launch.arm);
      console.log(
        `${launch.order} ${launch.task} ${launch.arm}: ${cell.recorded ? "recorded" : "pending"}${cell.setupFailures.length ? `, ${cell.setupFailures.length} setup failure(s)` : ""}`,
      );
    }
    return 0;
  }
  const stopped = join(runsDirectory, "stopped.json");
  if (existsSync(stopped)) {
    if (!args.has("correction")) {
      console.error(
        `stopped: ${readFileSync(stopped, "utf8")}\nrecord what was corrected with --correction "<text>" to continue`,
      );
      return 3;
    }
    const corrections = readdirSync(runsDirectory).filter((name) =>
      name.startsWith("correction-"),
    ).length;
    writeFileSync(
      join(runsDirectory, `correction-${corrections + 1}.json`),
      `${JSON.stringify({ at: new Date().toISOString(), stopped: JSON.parse(readFileSync(stopped, "utf8")), correction: args.get("correction"), harnessBefore: expectedHarness, harnessAfter: currentHarness }, null, 2)}\n`,
      { flag: "wx" },
    );
    rmSync(stopped);
  }
  const owner = { pid: process.pid, started: processStart(process.pid) };
  const lock = acquireLock(runsDirectory, owner);
  if (!lock.acquired) {
    console.error(
      `another runner holds this manifest (${JSON.stringify(lock.holder)}, ${lock.alive ? "alive" : "not running: remove runs/runner.lock after checking"})`,
    );
    return 4;
  }
  try {
    for (const launch of selected) {
      const cell = cellState(runsDirectory, cellKey(launch), launch.arm);
      if (cell.recorded) continue;
      if (cell.setupFailures.length > manifest.budgets.setupRetries) {
        writeFileSync(
          join(runsDirectory, cell.record),
          `${JSON.stringify({ schema: recordSchemaName, manifestDigest, task: launch.task, arm: launch.arm, order: launch.order, outcome: "setup-failures-exhausted", setupFailures: cell.setupFailures }, null, 2)}\n`,
          { flag: "wx" },
        );
        continue;
      }
      const ended = await runLaunch(manifest, manifestDigest, launch, runsDirectory);
      if (ended.fatal !== null && args.has("preflight")) continue;
      if (ended.fatal !== null) {
        writeFileSync(
          stopped,
          `${JSON.stringify({ launch, outcome: ended.outcome, class: ended.fatal.class, message: ended.fatal.message }, null, 2)}\n`,
        );
        return 3;
      }
    }
    return 0;
  } finally {
    releaseLock(runsDirectory, owner);
  }
}

if (process.argv[1]?.endsWith("study.mjs")) process.exitCode = await main();
