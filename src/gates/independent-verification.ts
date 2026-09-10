import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clock } from "../core/clock.ts";
import { certifies } from "./certification.ts";
import { assembleGateSet } from "./engine.ts";
import { normalizePath } from "./file-set.ts";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { nodeSyntaxCheck } from "./mutant-parse.ts";
import type { LineHits } from "./mutant-witness.ts";
import type { BondedMutant, OracleBond, OracleBondVerdict } from "./oracle-bond.ts";
import { bondOracleWithMutants } from "./oracle-bond-run.ts";
import { type OracleCoveragePlan, oracleCoveragePlan } from "./oracle-instrumentation.ts";
import { mutantsOfChangedLines } from "./oracle-mutants.ts";
import { lineHitsByWorkspacePath, oracleReachedTheChange } from "./oracle-reach.ts";
import { parseLineHits } from "./parsers.ts";
import { pathsInPatch } from "./patch-paths.ts";
import { parseUnifiedDiff } from "./unified-diff.ts";
import { readV8Coverage } from "./v8-coverage.ts";

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
  /**
   * Whether this check fails at the base commit too, with the patch not applied. A failure the
   * base already had was not caused by the patch, and charging it to the patch is the collapse of
   * *unmeasured* into *failed* that the rest of this project refuses.
   *
   * Undefined where nothing failed, since the base is only measured to explain a failure.
   */
  readonly inheritedFromBase?: boolean;
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
   * Whether a trusted task-specific check says the task was done. `vacuous` where the oracle
   * accepts the base commit too, so it would have accepted a patch that changes nothing and
   * establishes nothing about this one. `unjudged` where no oracle was
   * given, which is the honest answer and never an implicit pass: four of eighteen real
   * repository patches passed their project's suite and failed a hidden acceptance test, so
   * reading a passing suite as an accepted task is a measured 22% false-green rate.
   */
  readonly task: "accepted" | "rejected" | "unjudged" | "vacuous";
  /**
   * Whether the oracle executed the lines the patch added. An oracle is evidence only about code
   * it ran, and koa#1946 was certified by one that never reached the branch a held-back oracle
   * then refused. `unmeasured` where the harness could not build the oracle's invocation itself,
   * since a coverage number the workspace could author is not a measurement of the workspace.
   */
  readonly oracleReach: "reached" | "unreached" | "unmeasured";
  /**
   * The added lines the oracle never ran, per file. Empty unless `oracleReach` is `unreached`.
   *
   * The advice tells a reader to extend the oracle to cover the lines the patch added, which is
   * not actionable without knowing which ones they are, and the answer is what separates a real
   * gap from a defect in this measurement: koa#1999 read `unreached` on a patch whose source lines
   * its oracle covers completely, and no output said which file the verdict was about.
   */
  readonly unreachedByOracle: readonly {
    readonly path: string;
    readonly lines: readonly number[];
  }[];
  /**
   * Whether the oracle refused a change to the lines the patch added. Reach asks whether the
   * oracle ran the change; this asks whether running it established anything, because an oracle
   * can execute a line and assert nothing about it.
   *
   * `not-bonded` covers both a patch with no line these operators can change and a run where no
   * bond was attempted, since the run was already refused for another reason. Neither is a bond
   * that held, and neither is ever read as one.
   */
  readonly oracleBond: OracleBondVerdict;
  /** Every mutant that was built and run, with what the oracle did with it. */
  readonly bondedMutants: readonly BondedMutant[];
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
  /**
   * Whether to run the repository's own checks, or only the oracle.
   *
   * `skip` is for a second judgement of the same patch by a different oracle: the suite answers
   * the same way both times, and running it again is the same minutes spent twice. On the mined
   * corpus that is most of a campaign, since dayjs runs its suite under four timezones and every
   * task is judged two or three times.
   *
   * Skipping is not passing. `regression` reads `unmeasured` and nothing is verified, because a
   * run that did not measure the suite has not established that the patch broke nothing.
   */
  readonly repositoryChecks?: "run" | "skip";
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
      oracleReach: "unmeasured",
      unreachedByOracle: [],
      oracleBond: "not-bonded",
      bondedMutants: [],
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
        oracleReach: "unmeasured",
        unreachedByOracle: [],
        oracleBond: "not-bonded",
        bondedMutants: [],
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
        oracleReach: "unmeasured",
        unreachedByOracle: [],
        oracleBond: "not-bonded",
        bondedMutants: [],
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
        oracleReach: "unmeasured",
        unreachedByOracle: [],
        oracleBond: "not-bonded",
        bondedMutants: [],
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

    const onlyTheOracle = options.repositoryChecks === "skip";
    const withPatch = onlyTheOracle ? [] : await runChecks(checkout, options, timeoutMs);
    // The base is measured only to explain a failure, so a run where everything passed pays
    // nothing for this. Install is not repeated: the same checkout is reset to the base, so the
    // two runs differ in the patch and in nothing else, which is the whole point of the
    // comparison.
    // Before attribution, which reverts the patch to measure the base: the oracle judges the
    // patched tree or it judges nothing worth knowing.
    let task = await judgeTask(checkout, options, timeoutMs);
    // An oracle is only evidence if it can refuse. One that accepts the unpatched base accepts a
    // patch that changes nothing, so its acceptance of this patch says nothing, and reporting that
    // as `accepted` is how four of fifteen certified tasks in the mined corpus were certified on
    // checks that could not fail. Asked only where the oracle accepted, since that is the only
    // place the answer can change, and before attribution reverts the tree for its own reasons.
    let restored = true;
    if (task === "accepted") {
      const reverted = await resetToBase(checkout, options, timeoutMs);
      if (reverted) {
        const onBase = await judgeTask(checkout, options, timeoutMs);
        restored = await restorePatch(checkout, options, timeoutMs);
        if (onBase === "accepted") {
          task = "vacuous";
        }
      }
    }
    // Before attribution as well, and for the same reason the oracle runs before it: attribution
    // reverts the patch and leaves the checkout at the base, where the added line numbers are
    // somebody else's lines. Measuring there refused koa#1999, a patch whose five added lines its
    // oracle covers completely, on every run its base already had a failure.
    // A measurement of a tree the harness could not put back is a measurement of some other tree.
    const reach =
      task === "accepted" && restored
        ? await measureOracleReach(checkout, options, timeoutMs)
        : { verdict: "unmeasured" as const, unreached: [], measured: null };
    const oracleReach = reach.verdict;
    // Asked wherever the oracle accepted, and independently of what reach said. Gating it on
    // reach tied two checks that answer different questions together and cost the answer that
    // matters most: what a second oracle does with the same mutant, which is what separates a gap
    // this split manufactured from one a user supplying a whole suite would meet. Before
    // attribution, which reverts the patch: a mutant of the lines the patch added has no meaning
    // on a tree that does not have them.
    const bond =
      task === "accepted" && restored
        ? await bondTheOracle(checkout, options, timeoutMs, reach.measured, withPatch)
        : { verdict: "not-bonded" as const, mutants: [] };
    const checks = withPatch.some((check) => check.status === "failed")
      ? await attributeFailures(withPatch, checkout, options, timeoutMs)
      : withPatch;
    // A run that was not asked to measure the suite reports that, rather than reporting the
    // absence of a failure as an absence of a problem.
    const measuredSomething = checks.some((check) => check.status !== "not-applicable");
    const causedByThePatch = (check: IndependentCheck) =>
      check.status === "failed" && check.inheritedFromBase !== true;
    const regression: IndependentVerification["regression"] = checks.some(causedByThePatch)
      ? "fail"
      : checks.some((check) => check.status === "passed")
        ? "pass"
        : checks.some((check) => check.status === "failed")
          ? // Everything that failed, the base failed identically, so this patch broke nothing and
            // nothing here establishes that it did not either.
            "unmeasured"
          : "unmeasured";

    return {
      applied: true,
      checks,
      oracleReach,
      unreachedByOracle: reach.unreached,
      oracleBond: bond.verdict,
      bondedMutants: bond.mutants,
      refusal: null,
      regression,
      task,
      // Both, and the second is the one a suite cannot supply. A patch that adds a feature badly
      // still passes a suite written before the feature existed.
      //
      // Computed from the recorded fields by the same rule a third party applies to the record
      // afterwards, so `verified` is the absence of a named reason to refuse rather than a
      // separate opinion about the same evidence.
      verified: certifies({ regression, task, oracleReach, oracleBond: bond.verdict }),
      // Not the same as a checkout where nothing could run: this one was asked for one thing and
      // did it, so the absence of checks is the request rather than a failure to measure.
      unmeasured: !onlyTheOracle && !measuredSomething,
      // Ordered by what decided the verdict, not by what is true of the checkout. An inherited
      // failure does not block and an unreached oracle does, so naming the inherited one first
      // sent a reader of the koa#1946 run to fix a dependency install that was not the finding.
      advice: onlyTheOracle
        ? "the repository's own checks were not asked for, so nothing here says whether the patch " +
          "broke anything: this run carries the oracle's verdict and nothing else."
        : task === "vacuous"
          ? "the oracle accepts the base commit as well, so it would have accepted a patch that " +
            "changes nothing and its acceptance of this one establishes nothing. An oracle is only " +
            "evidence where it can refuse: give one that the base fails."
          : !restored
            ? "the checkout could not be put back after the base was judged, so nothing measured " +
              "after that point is about this patch. The repository's own checks and the oracle's " +
              "verdict were taken before it and stand; the oracle's reach was not, and abstains."
            : oracleReach === "unreached"
              ? "the oracle passed but never ran part of what the patch added, so it did not judge " +
                "that part: an oracle is evidence only about code it executed. Extend it to exercise " +
                "the lines the patch added, or leave them unjudged and say so."
              : bond.verdict === "vacuous" &&
                  !certifies({ regression, task, oracleReach, oracleBond: "vacuous" })
                ? "the oracle ran a line the patch added and then accepted a change to that same " +
                  `line (${bond.mutants.find((one) => one.verdict === "vacuous")?.id}), so running ` +
                  "it established nothing about that line. Extend it to assert on the behaviour " +
                  "those lines decide, or leave them unjudged and say so."
                : checks.some((check) => check.inheritedFromBase === true)
                  ? "at least one check fails at the base commit too, with this patch not applied, so it " +
                    "is reported as inherited rather than as a regression. A common cause is a project " +
                    "that builds on install: dependencies are installed with --ignore-scripts, because " +
                    "install scripts run whatever the registry serves, so a `prepare` step that generates " +
                    "what the tests import does not run."
                  : !measuredSomething
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
 * Whether the oracle executed the lines the patch added.
 *
 * Three ways of asking, chosen by what the oracle starts, and `unmeasured` where none of them
 * applies. It used to be one way, node's own runner rebuilt as an argv the harness vouched for,
 * which is invariant 7's rule for an artifact the ratchet reads. That rule is the wrong one here:
 * it exists because the workspace can author a number a retry is judged against, and reach only
 * ever turns a green into a refusal, so a workspace that forged its coverage would be handed
 * `reached`, which is exactly what an oracle nobody could measure already gets. Four of the
 * seventeen mined repositories use node's runner; the bar cost the other thirteen and closed
 * nothing.
 *
 * The residual that leaves, named rather than implied away: the reports the two new arms read are
 * written by the workspace's own processes, and nothing here detects a forged one.
 */
async function measureOracleReach(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<{
  verdict: "reached" | "unreached" | "unmeasured";
  unreached: readonly { readonly path: string; readonly lines: readonly number[] }[];
  /**
   * The hits this reading found, which the bond reads again rather than measuring twice: a line
   * the oracle ran is a line a mutant of it was demonstrably seen on.
   */
  measured: Readonly<Record<string, Readonly<Record<number, number>>>> | null;
}> {
  const nothingMeasured = { verdict: "unmeasured" as const, unreached: [], measured: null };
  const oracle = options.taskOracle?.command;
  if (oracle === undefined) {
    return nothingMeasured;
  }
  const changed = parseUnifiedDiff(options.patch).map((file) => ({
    path: file.path,
    addedLines: file.addedLines,
  }));

  // Outside the workspace, so nothing the oracle runs can read the destination out of the tree it
  // is being measured in, and named by the harness rather than by the project's configuration.
  const destination = await mkdtemp(join(tmpdir(), "swarm-reach-"));
  try {
    const plan = oracleCoveragePlan(oracle, destination);
    if (plan === null) {
      return nothingMeasured;
    }
    // The setup is the harness's own mkdir and cp, run as the shell string it already was. Only
    // the final run is instrumented, and only that one produces the report being read.
    if (plan.setup.length > 0) {
      await options.commands.run(plan.setup, { cwd: checkout, timeoutMs });
    }
    const measured = await lineHitsUnder(plan, checkout, changed, options, timeoutMs);
    if (measured === null) {
      return nothingMeasured;
    }
    const reach = oracleReachedTheChange({ changed, measured });
    return {
      verdict: reach.reached ? "reached" : "unreached",
      unreached: reach.unreached,
      measured,
    };
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

/**
 * Whether the oracle refuses a change to the lines the patch added.
 *
 * The question reach cannot ask. An oracle can execute a line and assert nothing about it, and
 * commander#1671 is that exactly: every line it adds runs under the sealed half, and the sealed
 * half never tests the name collision whose precedence those lines decide. So each mutant is
 * written into the checkout one at a time, the oracle is run again, and the file is put back.
 *
 * A mutant is only ever written where the checkout's line still reads as the patch left it. A
 * checkout that says something else is not the tree the mutant was built from, and editing it
 * would measure some other change.
 *
 * The residual, named here because this is where it is created: a mutant that changes nothing
 * observable is indistinguishable from an oracle that failed to notice one that did. Nothing in
 * this file tells them apart, and the operators are kept mechanical and few for that reason.
 */
async function bondTheOracle(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
  measured: LineHits | null,
  checksWithPatch: readonly IndependentCheck[],
): Promise<OracleBond> {
  const oracle = options.taskOracle?.command;
  if (oracle === undefined) {
    return { verdict: "not-bonded", mutants: [] };
  }
  const changed = parseUnifiedDiff(options.patch).map((file) => ({
    path: file.path,
    addedLines: file.addedLines,
  }));

  return bondOracleWithMutants({
    mutants: mutantsOfChangedLines({ changed }),
    measured,
    checksWithPatch,
    // Left to the one place the decision lives rather than passed from here, so a run and the
    // arithmetic over its record cannot disagree about which regime produced it.
    runner: {
      read: (path) => readFile(join(checkout, path), "utf8").catch(() => null),
      write: (path, text) => writeFile(join(checkout, path), text),
      parses: nodeSyntaxCheck(options.commands, { cwd: checkout, timeoutMs }),
      runOracle: async () => {
        const ran = await options.commands.run(oracle, { cwd: checkout, timeoutMs });
        return { accepted: ran.exitCode === 0 };
      },
      // A destination of its own per reading, outside the workspace. V8 writes one file per
      // process into the directory it is given and never clears it, so a shared destination
      // would have the mutant's reading include the unmutated run's.
      measureLineHits: async () => {
        const destination = await mkdtemp(join(tmpdir(), "swarm-bond-"));
        try {
          const plan = oracleCoveragePlan(oracle, destination);
          if (plan === null) {
            return null;
          }
          if (plan.setup.length > 0) {
            await options.commands.run(plan.setup, { cwd: checkout, timeoutMs });
          }
          return await lineHitsUnder(plan, checkout, changed, options, timeoutMs);
        } finally {
          await rm(destination, { recursive: true, force: true });
        }
      },
      runRepositoryChecks: () => runChecks(checkout, options, timeoutMs),
    },
  });
}

/**
 * The lines one coverage plan says ran, or null where the instrumented run produced no reading.
 *
 * A run that did not exit zero produces none. The oracle already passed by the time reach is
 * asked, so an instrumented run that fails is the instrumentation having changed the outcome, and
 * a coverage report from a run that did something else is not about the run that was judged.
 */
async function lineHitsUnder(
  plan: OracleCoveragePlan,
  checkout: string,
  changed: readonly { readonly path: string }[],
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<Record<string, Record<number, number>> | null> {
  if (plan.kind === "node-lcov") {
    const observed = await options.commands.runVouched(plan.argv, { cwd: checkout, timeoutMs });
    if (observed.exitCode !== 0) {
      return null;
    }
    const sections = parseLineHits(observed.stderr);
    return sections.length === 0 ? null : lineHitsByWorkspacePath(sections, checkout);
  }

  if (plan.kind === "v8") {
    const observed = await options.commands.run(plan.command, {
      cwd: checkout,
      timeoutMs,
      environment: { NODE_V8_COVERAGE: plan.destination },
    });
    if (observed.exitCode !== 0) {
      return null;
    }
    const read = readV8Coverage({
      directory: plan.destination,
      workspaceRoot: checkout,
      files: changed.map((file) => file.path),
    });
    return read.unusable === null ? { ...read.hits } : null;
  }

  const observed = await options.commands.run(plan.command, { cwd: checkout, timeoutMs });
  if (observed.exitCode !== 0) {
    return null;
  }
  const written = await readFile(plan.file, "utf8").catch(() => null);
  if (written === null) {
    return null;
  }
  const sections = parseLineHits(written);
  return sections.length === 0 ? null : lineHitsByWorkspacePath(sections, checkout);
}

/**
 * Puts the checkout back at the base, patch and all its leftovers gone.
 *
 * `git stash` was doing this and could not always undo itself: an oracle copies its own test file
 * into place before running, so a patch that adds a file at that path leaves the pop with the file
 * already there, and the pop refuses. Reverting and re-applying is two operations the harness can
 * check, and `git clean` removes what the oracle left rather than letting it collide.
 *
 * Ignored files are kept, since that is where the installed dependencies live and reinstalling
 * them would change what the base run measures.
 */
async function resetToBase(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<boolean> {
  const reverted = await options.commands.runVouched(
    ["git", "-C", checkout, "checkout", "--force", "--detach", options.baseCommit],
    { cwd: checkout, timeoutMs },
  );
  if (reverted.exitCode !== 0) {
    return false;
  }
  const cleaned = await options.commands.runVouched(["git", "-C", checkout, "clean", "-fdq"], {
    cwd: checkout,
    timeoutMs,
  });
  return cleaned.exitCode === 0;
}

/** The patch again, on a checkout `resetToBase` emptied, reported rather than assumed. */
async function restorePatch(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<boolean> {
  if (!(await resetToBase(checkout, options, timeoutMs))) {
    return false;
  }
  const patchPath = join(checkout, ".swarm-restore.patch");
  await writeFile(patchPath, options.patch.endsWith("\n") ? options.patch : `${options.patch}\n`);
  const applied = await options.commands.runVouched(
    ["git", "-C", checkout, "apply", "--3way", "--whitespace=nowarn", patchPath],
    { cwd: checkout, timeoutMs },
  );
  await rm(patchPath, { force: true });
  return applied.exitCode === 0;
}

/**
 * Runs the same checks again with the patch reverted, so a failure can be attributed. A check that
 * fails both ways was not caused by the patch; one that only fails with the patch was.
 */
async function attributeFailures(
  withPatch: readonly IndependentCheck[],
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const reverted = await options.commands.runVouched(
    ["git", "-C", checkout, "checkout", "--force", "--detach", options.baseCommit],
    { cwd: checkout, timeoutMs },
  );
  if (reverted.exitCode !== 0) {
    return withPatch;
  }
  const atBase = await runChecks(checkout, options, timeoutMs);
  return withPatch.map((check) => {
    if (check.status !== "failed") return check;
    const same = atBase.find((one) => one.id === check.id);
    return { ...check, inheritedFromBase: same?.status === "failed" };
  });
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
