/**
 * The campaign's stop controls: what counts as a failure of the experiment rather than of an arm,
 * the one runner allowed to dispatch a manifest, the halt and recovery records that make a stop
 * durable, and the revalidation a resumption must pass. Everything here is file state under the
 * manifest's run directory, outside every solver workspace; nothing is a service or a daemon.
 *
 * The stop contract itself is written in the comparison protocol (amendment 4). In short: an
 * arm that produces wrong or incomplete code, fails its checks, spends its budget, stalls or
 * refuses under a working instrument is a recorded outcome and the next launch runs; an
 * instrument that fails (endpoint, configuration, preparation, scorer, records, interruption,
 * the harness itself) halts the campaign before any later launch, with the affected attempt kept.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf } from "./arms.mjs";
import { probeEndpoint } from "./endpoint.mjs";
import { harnessDigest } from "./harness-identity.mjs";
import { fatalClasses, haltSchema, recoverySchema } from "./schema.mjs";

/** A detectable failure of the instrument must be seen within this long of occurring. */
export const detectionDeadlineMs = 10_000;
/** Owned child processes must be confirmed stopped within this long of the decision to stop. */
export const terminationDeadlineMs = 10_000;

/** A failure of the experiment, carrying its class and the moment it was seen. */
export class FatalError extends Error {
  constructor(fatalClass, message, detectedAt = new Date()) {
    super(message);
    if (!fatalClasses.includes(fatalClass)) throw new Error(`unknown fatal class ${fatalClass}`);
    this.name = "FatalError";
    this.class = fatalClass;
    this.detectedAt = detectedAt;
  }
}

/** The process's start time as ps prints it, or null when no such process exists. */
export function processStart(pid) {
  const ran = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" });
  const start = (ran.stdout ?? "").trim();
  return start === "" ? null : start;
}

/** `pid` is the same process that was recorded with `started`; a reused pid is not. */
export const sameProcess = (pid, started) => started !== null && processStart(pid) === started;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stop the process group `pid` leads and wait, up to the deadline, until that process is gone.
 * Only a process whose start time matches is touched: the pid alone could have been reused.
 */
export async function terminateGroup(pid, started, deadlineMs = terminationDeadlineMs) {
  if (!sameProcess(pid, started)) return { pid, started, outcome: "already-gone", wallMs: 0 };
  const began = Date.now();
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  while (Date.now() - began < deadlineMs) {
    if (!sameProcess(pid, started))
      return { pid, started, outcome: "terminated", wallMs: Date.now() - began };
    await sleep(100);
  }
  return { pid, started, outcome: "unconfirmed", wallMs: Date.now() - began };
}

const numbered = (names, prefix) =>
  names
    .filter((name) => new RegExp(`^${prefix}-\\d+\\.json$`).test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

/**
 * Whether the campaign is halted: recovery N clears halt N, so it is halted while there are more
 * halts than recoveries. Both are append-only; nothing here is ever rewritten.
 */
export function campaignState(runsDirectory) {
  const names = existsSync(runsDirectory) ? readdirSync(runsDirectory) : [];
  const halts = numbered(names, "halt");
  const recoveries = numbered(names, "recovery");
  return {
    halts,
    recoveries,
    halted: halts.length > recoveries.length,
    lastHalt: halts.at(-1) ?? null,
  };
}

export const nextNumbered = (runsDirectory, prefix) =>
  `${prefix}-${numbered(existsSync(runsDirectory) ? readdirSync(runsDirectory) : [], prefix).length + 1}.json`;

const writeOnce = (path, value) =>
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });

/** Validate and write the halt record under its next number; returns the file name. */
export function writeHalt(runsDirectory, halt, name = nextNumbered(runsDirectory, "halt")) {
  writeOnce(join(runsDirectory, name), haltSchema.parse(halt));
  return name;
}

export function writeRecovery(runsDirectory, recovery) {
  const name = nextNumbered(runsDirectory, "recovery");
  writeOnce(join(runsDirectory, name), recoverySchema.parse(recovery));
  return name;
}

/** The files a cell (one task under one arm) has: its record, and its failed attempts. */
export function cellFiles(runsDirectory, task, arm) {
  const names = existsSync(runsDirectory) ? readdirSync(runsDirectory) : [];
  const record = `${task}.${arm}.json`;
  const failed = names.filter((name) =>
    new RegExp(`^${task}\\.${arm}\\.(infrastructure|halted)-\\d+\\.json$`).test(name),
  );
  return {
    record,
    recorded: names.includes(record),
    failedAttempts: failed.length,
    nextHalted: `${task}.${arm}.halted-${failed.filter((name) => name.includes(".halted-")).length + 1}.json`,
  };
}

export const lockPath = (runsDirectory) => join(runsDirectory, "runner.lock");

export function readLock(runsDirectory) {
  try {
    return JSON.parse(readFileSync(lockPath(runsDirectory), "utf8"));
  } catch (cause) {
    return cause?.code === "ENOENT" ? null : { invalid: String(cause) };
  }
}

/**
 * One runner per manifest. The lock names the runner's pid and start time (so a reused pid is
 * not mistaken for a living holder), and is updated with the launch and child in progress so
 * that a runner killed without cleanup leaves behind exactly what the next start must deal with.
 */
export function acquireLock(runsDirectory, owner) {
  try {
    writeOnce(lockPath(runsDirectory), owner);
    return { acquired: true };
  } catch (cause) {
    if (cause?.code !== "EEXIST") throw cause;
    const holder = readLock(runsDirectory);
    const alive =
      holder !== null &&
      holder.invalid === undefined &&
      Number.isInteger(holder.pid) &&
      sameProcess(holder.pid, holder.started ?? null);
    return { acquired: false, holder, alive };
  }
}

/** Rewrite the lock with the launch or child now in progress; only the holder does this. */
export function updateLock(runsDirectory, owner, patch) {
  Object.assign(owner, patch);
  writeFileSync(lockPath(runsDirectory), `${JSON.stringify(owner, null, 2)}\n`);
}

/** Remove the lock if it is still this runner's; a failure to remove it is reported, not thrown. */
export function releaseLock(runsDirectory, owner) {
  try {
    const holder = readLock(runsDirectory);
    if (holder?.pid === owner.pid) unlinkSync(lockPath(runsDirectory));
    return null;
  } catch (cause) {
    return `the runner lock could not be released: ${cause?.message ?? cause}`;
  }
}

/** The first line `opencode --version` prints, or why it could not be asked. */
export function opencodeVersion(run = spawnSync) {
  const ran = run("opencode", ["--version"], { encoding: "utf8" });
  if (ran.error) return `unavailable (${ran.error.code ?? ran.error.message})`;
  return (ran.stdout || ran.stderr || "").trim().split("\n")[0] ?? "unknown";
}

/**
 * Everything a launch depends on, read again and compared with what the manifest froze. Run
 * before every launch and before any resumption. The problems are sentences for the halt or
 * refusal; the observed values go into the recovery record.
 */
export async function revalidate(
  manifest,
  { probe = probeEndpoint, versionOf = opencodeVersion, harness = harnessDigest } = {},
) {
  const { pins } = manifest;
  const problems = [];
  const observed = {
    harnessDigest: harness(),
    node: process.version,
    endpointInstance: null,
    models: [],
    opencode: null,
    swarmCliDigest: null,
  };
  if (pins.harnessDigest !== observed.harnessDigest)
    problems.push(
      `the harness digest is ${observed.harnessDigest}; the manifest froze ${pins.harnessDigest}`,
    );
  if (pins.node !== observed.node)
    problems.push(`node is ${observed.node}; the manifest froze ${pins.node}`);
  const probed = await probe(pins.endpoint);
  observed.endpointInstance = probed.instance;
  observed.models = probed.models;
  if (probed.problem !== null)
    problems.push(`the endpoint ${pins.endpoint} did not answer: ${probed.problem}`);
  else if (!probed.models.includes(pins.model))
    problems.push(
      `the endpoint lists ${probed.models.join(", ") || "no model"}, not the frozen model ${pins.model}`,
    );
  if (!existsSync(pins.swarmCli)) problems.push(`the Swarm CLI is not at ${pins.swarmCli}`);
  else {
    observed.swarmCliDigest = digestOf(readFileSync(pins.swarmCli));
    if (pins.swarmCliDigest != null && pins.swarmCliDigest !== observed.swarmCliDigest)
      problems.push(
        `the Swarm CLI at ${pins.swarmCli} is ${observed.swarmCliDigest}; the manifest froze ${pins.swarmCliDigest}`,
      );
  }
  observed.opencode = versionOf();
  if (observed.opencode !== pins.opencode)
    problems.push(`opencode is ${observed.opencode}; the manifest froze ${pins.opencode}`);
  return {
    problems,
    observed,
    probe: probed,
    class: probed.problem !== null ? "endpoint" : "configuration",
  };
}

/** Swarm's exit statuses that mean the product could not run the task at all. */
const swarmCouldNotRun = { 2: "invalid request", 4: "unavailable", 5: "internal error" };

/**
 * Whether a finished invocation shows the arm's runtime failing rather than the arm working:
 * a process that could not be spawned or printed nothing, Swarm's "could not run" statuses,
 * OpenCode unable to reach an endpoint that is answering, an evidence directory Swarm named that
 * is not there, or a signal the harness did not send. Null when the invocation is the arm's own
 * doing, whatever its quality.
 */
export function fatalInvocation({ arm, exitCode, signal, stdout, evidenceDirectory, exists }) {
  if (exitCode === null && signal === null)
    return { class: "configuration", reason: `the ${arm} arm could not be started` };
  if (signal !== null && !signal.startsWith("SIGKILL("))
    return {
      class: "interrupted",
      reason: `the ${arm} arm's process ended on ${signal}, a signal the harness did not send`,
    };
  if (signal !== null) return null;
  if (stdout.trim() === "")
    return {
      class: "configuration",
      reason: `the ${arm} arm printed nothing and exited ${exitCode}; its runtime never started`,
    };
  if (arm === "swarm" && exitCode in swarmCouldNotRun)
    return {
      class: "configuration",
      reason: `the swarm arm exited ${exitCode} (${swarmCouldNotRun[exitCode]}): the product could not run the task`,
    };
  if (arm === "opencode" && /"type":"error"/.test(stdout) && /Unable to connect/.test(stdout))
    return {
      class: "configuration",
      reason:
        'the opencode arm reported "Unable to connect" while the endpoint it was given was answering and unchanged',
    };
  if (arm === "swarm" && evidenceDirectory !== null && !exists(evidenceDirectory))
    return {
      class: "records",
      reason: `the swarm arm named evidence at ${evidenceDirectory} and nothing is there`,
    };
  return null;
}
