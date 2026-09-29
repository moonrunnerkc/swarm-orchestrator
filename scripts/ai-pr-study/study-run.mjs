/**
 * What every arm of the study shares at run time: the command line, the run it opens or
 * resumes, the attempt loop under the written retry rule, and fresh checkouts of a row's
 * commits from the versioned object clone.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginAttempt,
  finishAttempt,
  harnessIdentity,
  layoutPaths,
  listAttempts,
  openRun,
  retryDecision,
  sha256,
  standingAttempt,
} from "./attempts.mjs";
import { childPath } from "./containment.mjs";

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const defaultWorkingRoot = join(homedir(), ".cache", "swarm-ai-pr-study");

/** `--flag value` pairs, the boolean flags named, and the positional arguments. */
export function parseArguments(argv, booleans = []) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (booleans.includes(arg)) flags.set(arg.slice(2), true);
    else if (arg.startsWith("--")) {
      flags.set(arg.slice(2), argv[index + 1]);
      index += 1;
    } else positional.push(arg);
  }
  return { positional, flags };
}

export const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 256_000_000, ...options });

const budgetFlags = {
  "max-attempts": "maxAttempts",
  "verifier-timeout-ms": "verifierTimeoutMs",
  "install-timeout-ms": "installTimeoutMs",
  "test-timeout-ms": "testTimeoutMs",
  "check-timeout-ms": "checkTimeoutMs",
  "reviewer-max-steps": "reviewerMaxSteps",
};

/**
 * Open a new run for a frame and verifier version, or resume one by id. A study run (not
 * `--dev`) refuses a harness whose study scripts differ from its commit, since the commit is
 * what the run id binds.
 */
export function openStudyRun({ framePath, version, flags, workingRoot = defaultWorkingRoot }) {
  const frameBytes = readFileSync(framePath);
  const harness = harnessIdentity(repositoryRoot);
  const development = flags.get("dev") === true;
  const budgets = {};
  for (const [flag, key] of Object.entries(budgetFlags))
    if (flags.has(flag)) budgets[key] = Number(flags.get(flag));
  const resume = flags.has("resume") ? String(flags.get("resume")) : undefined;
  if (resume === undefined && !development && harness.dirty)
    throw new Error(
      "the study scripts differ from the harness commit; commit them, or pass --dev for a development run",
    );
  const opened = openRun(workingRoot, {
    resume,
    development,
    identity: {
      verifierVersion: version,
      frameDigest: sha256(frameBytes),
      harnessCommit: harness.commit,
    },
    budgets: resume === undefined ? budgets : Object.keys(budgets).length > 0 ? budgets : undefined,
    extra: { harnessDirty: harness.dirty, framePath: resolve(framePath) },
  });
  return { ...opened, frame: JSON.parse(frameBytes.toString("utf8")), workingRoot };
}

/** The identity every attempt file carries. */
export function attemptIdentity(runRecord, inputDigests) {
  return {
    runId: runRecord.runId,
    verifierVersion: runRecord.verifierVersion,
    harnessCommit: runRecord.harnessCommit,
    harnessDirty: runRecord.harnessDirty,
    frameDigest: runRecord.frameDigest,
    inputDigests,
  };
}

/**
 * Run one arm of one row under the written retry rule: while the rule allows an attempt, write
 * its intent, run it, write its result. Returns the standing result. A thrown error is the
 * harness's own and is final; a result carrying an infrastructure failure may be retried.
 */
export async function runArm(runRecord, index, arm, inputDigests, body, log = console.log) {
  const rowsDirectory = runRecord.paths.rows;
  for (;;) {
    const attempts = listAttempts(rowsDirectory, index, arm);
    const decision = retryDecision(attempts, runRecord.budgets.maxAttempts);
    if (!decision.run) {
      if (attempts.length > 0) log(`${index} ${arm}: ${decision.reason}`);
      return standingAttempt(attempts).standing;
    }
    const { attempt, record } = beginAttempt(rowsDirectory, index, arm, {
      ...attemptIdentity(runRecord, inputDigests),
      retryOf: decision.retryOf ?? null,
      retryReason: decision.retryOf === undefined ? null : decision.reason,
    });
    let result;
    try {
      result = await body(attempt);
    } catch (cause) {
      result = {
        failure: {
          kind: cause?.kind ?? "harness",
          reason: `harness error: ${String(cause?.message).split("\n")[0]}`,
        },
      };
    }
    finishAttempt(rowsDirectory, index, arm, attempt, {
      ...record,
      ...result,
      finishedAt: new Date().toISOString(),
    });
    log(
      `${index} ${arm} attempt ${attempt}: ${result.failure ? `${result.failure.kind}: ${result.failure.reason}` : (result.summary ?? "done")}`,
    );
  }
}

/** The versioned clone holding a row's two commits, shared by every run as a git object store. */
export function objectClonePath(workingRoot, repository, number) {
  const objects = layoutPaths(workingRoot).objects;
  mkdirSync(objects, { recursive: true });
  return childPath(objects, `${repository.replace("/", "__")}-${number}`);
}

/** A per-attempt directory under the run's work or artifacts root. */
export function attemptDirectory(root, index, arm, attempt) {
  const directory = childPath(root, `${String(index).padStart(2, "0")}.${arm}.attempt-${attempt}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

/**
 * A fresh checkout of `commit` cloned from the object clone, with the study's two commits as
 * local branches (a clone the verifier makes of this checkout carries branches, not other refs).
 */
export function freshCheckout(objectClone, directory, commit) {
  if (existsSync(directory))
    throw new Error(`${directory} already exists; a checkout is made once`);
  const cloned = run("git", ["clone", "--quiet", "--no-checkout", objectClone, directory]);
  if (cloned.status !== 0)
    throw new Error(`local clone failed: ${cloned.stderr.trim().slice(-300)}`);
  for (const name of ["study-base", "study-head"])
    run("git", ["branch", "--quiet", "--force", name, `origin/${name}`], { cwd: directory });
  const checkedOut = run("git", ["checkout", "--quiet", "--force", "--detach", commit], {
    cwd: directory,
  });
  if (checkedOut.status !== 0)
    throw new Error(`checkout of ${commit} failed: ${checkedOut.stderr.trim().slice(-300)}`);
  return directory;
}

/** The standing fetch record of a row, or null. */
export function standingFetch(runRecord, index) {
  return standingAttempt(listAttempts(runRecord.paths.rows, index, "fetch")).standing;
}
