import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import { assembleGateSet } from "./engine.ts";
import { normalizePath } from "./file-set.ts";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { pathsInPatch } from "./patch-paths.ts";

/**
 * Verification that does not trust the tree it is verifying.
 *
 * Every gate the run itself executed ran in the workspace the run was editing, with the tests
 * the run may have changed, under the environment the run was in, reading reports the run's own
 * processes wrote. Each of those is a place where a run can be measured by something it
 * controls. The ratchet and the sealed criteria close most of it, and what they cannot close is
 * the shape of the thing: a subject grading its own paper.
 *
 * So the final word is a separate run: a fresh checkout of the base commit somewhere the
 * workspace cannot reach, the patch applied to it, and the checks run there. Nothing from the
 * worker travels except the patch.
 */
export interface IndependentCheck {
  readonly id: string;
  readonly status: "passed" | "failed" | "not-applicable";
  readonly detail: string;
}

export interface DependencyInstall {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly command: string;
  readonly detail: string;
}

export interface IndependentVerification {
  /** Whether the patch applied cleanly to a fresh base. A patch that did not is not verified. */
  readonly applied: boolean;
  readonly checks: readonly IndependentCheck[];
  /** Why verification refused before running anything, or null where it ran. */
  readonly refusal: string | null;
  /**
   * Whether the repository's own suite still passes. This is what running that suite
   * establishes: nothing broke. It is not whether the task was done, because a suite tests the
   * behaviour a project already had and a task adds behaviour it did not.
   */
  readonly regression: "pass" | "fail" | "unmeasured";
  /**
   * Whether a trusted task-specific check says the task was done. `unjudged` where no oracle was
   * given, which is the honest answer and never an implicit pass: four of eighteen real
   * repository patches passed their project's suite and failed a hidden acceptance test, so
   * reading a passing suite as an accepted task is a measured 22% false-green rate.
   */
  readonly task: "accepted" | "rejected" | "unjudged";
  /** Both: no regression, and an oracle that says the task was done. */
  readonly verified: boolean;
  /**
   * Nothing measured, as against measured and found wanting. A fresh checkout has no installed
   * dependencies, so a real project's runner is not there and its tests gate reports that it
   * measured nothing. Reading that as a refusal is the mistake this whole project is about.
   */
  readonly unmeasured: boolean;
  /** What would make the checks runnable, where nothing could run. Empty where they ran. */
  readonly advice: string;
  /** The install phase, where one was asked for. Null where it was not. */
  readonly install: DependencyInstall | null;
  readonly checkoutPath: string | null;
}

export interface IndependentVerificationOptions {
  readonly repositoryRoot: string;
  readonly baseCommit: string;
  readonly patch: string;
  /** Paths the run declared it would never change. A patch touching one is refused outright. */
  readonly immutablePaths?: readonly string[];
  /**
   * A trusted check that says whether the task was done, run in the fresh checkout after the
   * repository's own suite. Absent leaves the task unjudged, which is honest: nothing else here
   * can tell a change that does the work from one that merely does not break anything.
   */
  readonly taskOracle?: { readonly command: string };
  readonly commands: GateCommandRunner;
  readonly clock: Clock;
  readonly timeoutMs?: number;
  /**
   * Install the checkout's dependencies from its lockfile before running the checks.
   *
   * Off by default, and deliberately: installing runs whatever install scripts the registry
   * serves, which is one of the seven things the approval model says needs a person. A run that
   * cannot measure says so instead of quietly installing on the reader's behalf.
   */
  readonly installDependencies?: boolean;
}

export async function verifyIndependently(
  options: IndependentVerificationOptions,
): Promise<IndependentVerification> {
  const immutable = options.immutablePaths ?? [];
  const touched = pathsInPatch(options.patch);
  const forbidden = touched.filter((path) => matchesAny(path, immutable));
  if (forbidden.length > 0) {
    return {
      applied: false,
      checks: [],
      refusal:
        `the patch changes ${forbidden.join(", ")}, which the run declared immutable. ` +
        "Nothing was run: a patch that reaches a path the run promised not to touch is " +
        "refused before it is measured, not measured and then judged.",
      regression: "unmeasured",
      task: "unjudged",
      verified: false,
      unmeasured: false,
      advice: "",
      install: null,
      checkoutPath: null,
    };
  }

  const checkout = await mkdtemp(join(tmpdir(), "swarm-verify-"));
  const timeoutMs = options.timeoutMs ?? defaultGateTimeoutMs;
  try {
    // A worktree of the base commit, not a copy of the workspace. Nothing the run wrote is
    // here except what the patch carries.
    const cloned = await options.commands.runVouched(
      ["git", "clone", "--quiet", "--no-hardlinks", options.repositoryRoot, checkout],
      { cwd: tmpdir(), timeoutMs },
    );
    if (cloned.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: `a fresh checkout could not be made: ${cloned.stderr.trim() || cloned.stdout.trim()}`,
        regression: "unmeasured",
        task: "unjudged",
        verified: false,
        unmeasured: true,
        advice: "",
        install: null,
        checkoutPath: null,
      };
    }
    const reset = await options.commands.runVouched(
      ["git", "-C", checkout, "checkout", "--quiet", "--detach", options.baseCommit],
      { cwd: checkout, timeoutMs },
    );
    if (reset.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: `the base commit ${options.baseCommit} is not in the checkout`,
        regression: "unmeasured",
        task: "unjudged",
        verified: false,
        unmeasured: true,
        advice: "",
        install: null,
        checkoutPath: null,
      };
    }

    const patchPath = join(checkout, ".swarm-verify.patch");
    await writeFile(patchPath, options.patch.endsWith("\n") ? options.patch : `${options.patch}\n`);
    const applied = await options.commands.runVouched(
      ["git", "-C", checkout, "apply", "--whitespace=nowarn", patchPath],
      { cwd: checkout, timeoutMs },
    );
    await rm(patchPath, { force: true });
    if (applied.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: null,
        regression: "unmeasured",
        task: "unjudged",
        verified: false,
        unmeasured: false,
        advice: "",
        install: null,
        checkoutPath: null,
      };
    }

    const install =
      options.installDependencies === true
        ? await installFromLockfile(checkout, options, timeoutMs)
        : null;

    const checks = await runChecks(checkout, options, timeoutMs);
    const measuredSomething = checks.some((check) => check.status !== "not-applicable");
    const regression: IndependentVerification["regression"] = checks.some(
      (check) => check.status === "failed",
    )
      ? "fail"
      : checks.some((check) => check.status === "passed")
        ? "pass"
        : "unmeasured";
    const task = await judgeTask(checkout, options, timeoutMs);

    return {
      applied: true,
      checks,
      refusal: null,
      regression,
      task,
      // Both, and the second is the one a suite cannot supply. A patch that adds a feature badly
      // still passes a suite written before the feature existed.
      verified: regression === "pass" && task === "accepted",
      unmeasured: !measuredSomething,
      advice: !measuredSomething
        ? "nothing here measured the patch: every check stood down, which on a real project " +
          "usually means the fresh checkout has no installed dependencies, so its test runner " +
          "is not present. Pass --install to install them from the lockfile first, which runs " +
          "whatever install scripts the registry serves and is therefore a decision rather " +
          "than a default."
        : task === "unjudged"
          ? "the repository's own suite passed, which says nothing broke. It does not say the " +
            "task was done: a suite tests the behaviour a project already had, and a task adds " +
            "behaviour it did not. Pass --oracle <command> with a check that says whether the " +
            "task was done."
          : "",
      install,
      checkoutPath: checkout,
    };
  } finally {
    await rm(checkout, { recursive: true, force: true });
  }
}

/**
 * The trusted task-specific check, run in the fresh checkout. Nothing infers it: a task oracle
 * is written by whoever set the task, before the run, and its absence is reported rather than
 * papered over with the suite's own verdict.
 */
async function judgeTask(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<IndependentVerification["task"]> {
  if (options.taskOracle === undefined) {
    return "unjudged";
  }
  const ran = await options.commands.run(options.taskOracle.command, {
    cwd: checkout,
    timeoutMs,
  });
  return ran.exitCode === 0 ? "accepted" : "rejected";
}

/**
 * Installs from whichever lockfile the checkout carries, with no network beyond the registry the
 * lockfile already names. Reported rather than assumed: an install that failed and a run that
 * never installed produce the same absent runner, and they are different problems.
 */
async function installFromLockfile(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<DependencyInstall> {
  const lockfiles: readonly { readonly file: string; readonly argv: readonly string[] }[] = [
    {
      file: "package-lock.json",
      argv: ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    },
    { file: "pnpm-lock.yaml", argv: ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts"] },
    { file: "yarn.lock", argv: ["yarn", "install", "--frozen-lockfile", "--ignore-scripts"] },
  ];

  for (const candidate of lockfiles) {
    if (!existsSync(join(checkout, candidate.file))) {
      continue;
    }
    const ran = await options.commands.runVouched(candidate.argv, {
      cwd: checkout,
      timeoutMs: Math.max(timeoutMs, 10 * 60_000),
    });
    return {
      attempted: true,
      succeeded: ran.exitCode === 0,
      command: candidate.argv.join(" "),
      detail:
        ran.exitCode === 0
          ? `installed from ${candidate.file}`
          : `install failed (exit ${ran.exitCode}): ${(ran.stderr || ran.stdout).trim().split("\n").slice(-2).join(" ")}`,
    };
  }

  return {
    attempted: true,
    succeeded: false,
    command: "",
    detail:
      "no lockfile this build installs from (package-lock.json, pnpm-lock.yaml, yarn.lock), " +
      "so nothing was installed and the checks run against whatever is already there",
  };
}

/**
 * The gates assembled from the base commit's manifests, not the patched tree's. A patch that
 * rewrites the test script would otherwise choose the instrument that measures it.
 */
async function runChecks(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const { gates } = await assembleGateSet({
    workspaceRoot: options.repositoryRoot,
    criteriaRef: options.baseCommit,
  });

  const results: IndependentCheck[] = [];
  for (const gate of gates) {
    if (gate.source.kind !== "command") {
      continue;
    }
    const observed = await options.commands.run(gate.source.command, { cwd: checkout, timeoutMs });
    const reading = gate.parse(observed);
    results.push({ id: gate.id, status: reading.status, detail: reading.detail });
  }
  return results;
}

function matchesAny(path: string, patterns: readonly string[]): boolean {
  const normalized = normalizePath(path);
  return patterns.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    if (normalizedPattern.endsWith("/**")) {
      return normalized.startsWith(normalizedPattern.slice(0, -2));
    }
    return normalized === normalizedPattern;
  });
}
