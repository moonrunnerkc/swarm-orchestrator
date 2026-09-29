import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Clock } from "../core/clock.ts";
import { freezeAcceptanceContract } from "../evidence/acceptance-contract.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { type GoalContract, goalImmutablePaths } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { certifies } from "./certification.ts";
import {
  type ContractVerification,
  type RequirementObservation,
  verifyAcceptanceContract,
} from "./contract-verification.ts";
import type { GateSetOptions } from "./default-gates.ts";
import {
  type DependencyInstall,
  DependencySetupReconciliationError,
} from "./dependency-install.ts";
import {
  attributeFailure,
  attributionRule,
  type FailureAttribution,
  underBaseConfiguration,
} from "./failure-attribution.ts";
import { normalizePath } from "./file-set.ts";
import { defaultGateTimeoutMs, type GateCommandRunner } from "./gate-definition.ts";
import { type GoalVerification, verifyGoal } from "./goal-acceptance.ts";
import { createChallengeRunner } from "./goal-challenge-runner.ts";
import { type ChallengePolicy, type ChallengeReport, challengeGoal } from "./goal-challenges.ts";
import { GoalEffectReconciliationError } from "./goal-effects.ts";
import { runChecks } from "./independent-checks.ts";
import { nodeSyntaxCheck } from "./mutant-parse.ts";
import type { LineHits } from "./mutant-witness.ts";
import type { BondedMutant, OracleBond, OracleBondVerdict } from "./oracle-bond.ts";
import { bondOracleWithMutants } from "./oracle-bond-run.ts";
import { type OracleCoveragePlan, oracleCoveragePlan } from "./oracle-instrumentation.ts";
import { mutantsOfChangedLines } from "./oracle-mutants.ts";
import {
  lineHitsByWorkspacePath,
  oracleReachedTheChange,
  type ReachSetAside,
} from "./oracle-reach.ts";
import { outsidePackages } from "./package-scope.ts";
import { parseLineHits } from "./parsers.ts";
import { pathsInPatch } from "./patch-paths.ts";
import { prepareDependencies } from "./prepare-dependencies.ts";
import { stagePreparedPython } from "./prepared-python.ts";
import { enforceUpgrade, reproducedBug } from "./preset-verification.ts";
import { parseUnifiedDiff } from "./unified-diff.ts";
import { observeUpgradeResolution } from "./upgrade-resolution.ts";
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
  /** No optional static tool was configured; absence is retained, never reported as a pass. */
  readonly optionalAbsence?: boolean;
  readonly id: string;
  readonly status: "passed" | "failed" | "not-applicable";
  readonly detail: string;
  readonly severity?: "blocking" | "advisory";
  readonly parser?: string;
  readonly observation?: import("./gate-definition.ts").GateObservation;
  readonly baseObservation?: import("./gate-definition.ts").GateObservation;
  /**
   * Whether this check fails at the base commit too, with the patch not applied. A failure the
   * base already had was not caused by the patch, and charging it to the patch is the collapse of
   * *unmeasured* into *failed* that the rest of this project refuses.
   *
   * Undefined where nothing failed, since the base is only measured to explain a failure. True
   * only where `attribution` is `inherited`.
   */
  readonly inheritedFromBase?: boolean;
  /**
   * Why a failed check failed, proven from the two runs' observations: `inherited` where every
   * failing test also failed at the base (or the outputs match once times are set aside), `new`
   * where the base passed or the patch failed a test the base did not, `unattributed` where
   * neither can be shown. Only `inherited` is left out of the regression dimension; `unattributed`
   * leaves it unmeasured. Records before this field read inheritance from the base's status alone.
   */
  readonly attribution?: FailureAttribution;
  /** The identity rule `attribution` was decided under; absent means failure-identity v1. */
  readonly attributionRule?: typeof attributionRule;
  /** The tests that failed with the patch and not at the base, where the runs name tests. */
  readonly newFailures?: readonly string[];
  /**
   * The same check run with the base's runner configuration restored, where the patch changed
   * any (`configurationFiles`). A check that passes only under the patch's configuration fails
   * where the base's configuration fails a test the base passed (`regressedUnderBaseConfiguration`)
   * and measures nothing otherwise.
   */
  readonly configurationObservation?: import("./gate-definition.ts").GateObservation;
  readonly configurationStatus?: "passed" | "failed" | "not-applicable";
  readonly configurationFiles?: readonly string[];
  readonly regressedUnderBaseConfiguration?: readonly string[];
  /**
   * The instrument the patched reading ran under, compared with the base's
   * (instrument-identity-v1), and the same for the base-configuration reading. A pass reported
   * under an altered instrument is withheld, with the runner's own reading kept as
   * `reportedStatus`; only a reading under the base's instrument can let it stand.
   */
  readonly instrument?: import("./instrument-identity.ts").InstrumentObservation;
  readonly configurationInstrument?: import("./instrument-identity.ts").InstrumentObservation;
  readonly reportedStatus?: "passed" | "failed" | "not-applicable";
}

export type { DependencyInstall } from "./dependency-install.ts";

export interface IndependentVerification {
  readonly certificationPolicy?: "oracle-v3" | "required-obligations-v1" | "goal-obligations-v1";
  readonly acceptance?: ContractVerification;
  readonly goalAcceptance?: GoalVerification;
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
   * Every changed file reach did not judge, with the reason. Absent on a verdict reached before
   * reach was asked. A reader of `reached` is owed what it was reached over: commander's type
   * test was once judged where it should have been set aside, and nothing in the output said
   * which files a verdict covered.
   */
  readonly setAsideByReach?: readonly {
    readonly path: string;
    readonly reason: ReachSetAside;
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
  /**
   * What the oracle printed and exited with on the patched tree, and on the base where it was
   * asked there. The task dimension is decided from these runs, so they are kept: an A2 study run
   * read `rejected` with nothing recorded to say why.
   */
  readonly oracleRuns?: readonly OracleRun[];
  /** Every mutant that was built and run, with what the oracle did with it. */
  readonly bondedMutants: readonly BondedMutant[];
  /** What challenging the requirement checks established, where a policy asked for it. */
  readonly challenges?: ChallengeReport;
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
  readonly signal?: AbortSignal;
  readonly gateOptions?: GateSetOptions;
  readonly goal?: {
    readonly contract: GoalContract;
    readonly evidence: EvidenceRecorder;
    readonly tree: string;
    /** Whether and how the requirement checks are challenged. Absent is `off`. */
    readonly challengePolicy?: ChallengePolicy;
  };
  readonly repositoryRoot: string;
  /**
   * Where the verification's own effects are recorded: an authorized install is an effect with
   * registry access and belongs on the chain whether or not a goal contract was supplied.
   */
  readonly evidence?: EvidenceRecorder;
  /** A harness-owned root shared with the selected runtime, outside the producing workspace. */
  readonly checkoutRoot?: string;
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
  readonly commandsForCheckout?: (checkout: string) => Promise<GateCommandRunner>;
  readonly acceptance?: {
    readonly contract: unknown;
    readonly evidence: EvidenceRecorder;
    readonly execute: (
      requirement: ReturnType<typeof freezeAcceptanceContract>["contract"]["requirements"][number],
      target: "reference" | "violating-control" | "candidate",
      candidateCheckout: string,
    ) => Promise<RequirementObservation>;
  };
  readonly clock: Clock;
  readonly timeoutMs?: number;
  /**
   * Install the checkout's dependencies from its lockfile before running the checks.
   *
   * Off by default. Explicit authorization permits registry access through the selected runner.
   * Frozen lockfile commands disable lifecycle scripts; observed setup is recorded separately.
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
  if (options.goal !== undefined && options.acceptance !== undefined)
    throw new Error(
      "select one acceptance policy per verification; strict reference/control remains a separate policy",
    );
  const contract =
    options.acceptance === undefined
      ? undefined
      : freezeAcceptanceContract(options.acceptance.contract);
  const immutable = [
    ...(options.immutablePaths ?? []),
    ...(contract?.contract.immutablePaths ?? []),
    ...(options.goal === undefined ? [] : goalImmutablePaths(options.goal.contract)),
  ];
  const touched = pathsInPatch(options.patch);
  const outside = options.gateOptions?.packages?.length
    ? outsidePackages(touched, options.gateOptions.packages)
    : [];
  if (outside.length > 0)
    throw new Error(
      `change outside selected packages is unverified: ${outside.join(", ")}; expand the declared package scope or verify the whole repository`,
    );
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

  const checkout = await mkdtemp(join(options.checkoutRoot ?? tmpdir(), "swarm-verify-"));
  const timeoutMs = options.timeoutMs ?? defaultGateTimeoutMs;
  let preserveCheckout = false;
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
    if (options.commandsForCheckout !== undefined)
      options = { ...options, commands: await options.commandsForCheckout(checkout) };
    // The backend owns cwd translation; host absolute paths do not name the mounted checkout.
    const reset = await options.commands.runVouched(
      ["git", "-C", ".", "checkout", "--quiet", "--detach", options.baseCommit],
      { cwd: checkout, timeoutMs },
    );
    if (reset.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        // git's own last line, because "not in the checkout" was also what a base that exists
        // but cannot be checked out read as: two paths differing only in case on a
        // case-insensitive filesystem left the tree dirty and git refused to switch.
        refusal: `the base commit ${options.baseCommit} could not be checked out: ${
          (reset.stderr || reset.stdout).trim().split("\n").filter(Boolean).at(-1) ??
          "git gave no reason"
        }`,
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
      options.patch.trim() === ""
        ? ["git", "diff", "--exit-code", "HEAD", "--"]
        : ["git", "-C", ".", "apply", "--whitespace=nowarn", ".swarm-verify.patch"],
      { cwd: checkout, timeoutMs },
    );
    await rm(patchPath, { force: true });
    if (applied.exitCode !== 0) {
      return {
        applied: false,
        checks: [],
        refusal: `candidate patch could not be applied: ${applied.stderr.trim() || applied.stdout.trim() || `exit ${applied.exitCode}`}`,
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

    let upgradeAuthorization: string | undefined;
    let upgradeResolution: string | undefined;
    if (options.goal?.contract.preset !== undefined) {
      upgradeAuthorization = await enforceUpgrade({
        evidence: options.goal.evidence,
        preset: options.goal.contract.preset,
        patch: options.patch,
        checkout,
        base: options.baseCommit,
        commands: options.commands,
        timeoutMs,
      });
      if (options.goal.contract.preset.kind === "upgrade" && options.installDependencies !== true)
        throw new Error(
          "upgrade verification requires explicitly authorized --install from the candidate lockfile",
        );
    }
    if (options.installDependencies !== true)
      await stagePreparedPython({
        repository: options.repositoryRoot,
        checkout,
        ...(options.gateOptions?.packages === undefined
          ? {}
          : { packages: options.gateOptions.packages }),
        ...(options.goal === undefined ? {} : { evidence: options.goal.evidence }),
      });
    const install =
      options.installDependencies === true
        ? await prepareDependencies({
            checkout,
            ...(options.gateOptions?.packages === undefined
              ? {}
              : { packages: options.gateOptions.packages }),
            ...(options.goal?.contract.preset?.kind === "upgrade"
              ? { upgradeManifest: options.goal.contract.preset.manifest }
              : {}),
            commands: options.commands,
            timeoutMs,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...((options.evidence ?? options.goal?.evidence) === undefined
              ? {}
              : { evidence: (options.evidence ?? options.goal?.evidence) as EvidenceRecorder }),
          })
        : null;

    if (install !== null && !install.succeeded)
      return {
        applied: true,
        checks: [],
        refusal: install.detail,
        regression: "unmeasured",
        task: "unjudged",
        oracleReach: "unmeasured",
        unreachedByOracle: [],
        oracleBond: "not-bonded",
        bondedMutants: [],
        verified: false,
        unmeasured: true,
        advice: install.detail,
        install,
        checkoutPath: checkout,
      };

    if (options.goal?.contract.preset?.kind === "upgrade")
      upgradeResolution = await observeUpgradeResolution({
        preset: options.goal.contract.preset,
        checkout,
        commands: options.commands,
        evidence: options.goal.evidence,
        timeoutMs,
      });

    const onlyTheOracle = options.repositoryChecks === "skip";
    const withPatch = onlyTheOracle
      ? []
      : await readUnderBaseConfiguration(
          await runChecks(checkout, options, timeoutMs),
          checkout,
          options,
          timeoutMs,
        );
    // The base is measured only to explain a failure, so a run where everything passed pays
    // nothing for this. Install is not repeated: the same checkout is reset to the base, so the
    // two runs differ in the patch and in nothing else, which is the whole point of the
    // comparison.
    // Before attribution, which reverts the patch to measure the base: the oracle judges the
    // patched tree or it judges nothing worth knowing.
    const patchedRun = await judgeTask(checkout, options, timeoutMs);
    const oracleRuns: OracleRun[] = patchedRun.run === null ? [] : [patchedRun.run];
    let task = patchedRun.task;
    // An oracle is only evidence if it can refuse. One that accepts the unpatched base accepts a
    // patch that changes nothing, so its acceptance of this patch says nothing, and reporting that
    // as `accepted` is how four of fifteen certified tasks in the mined corpus were certified on
    // checks that could not fail. Asked only where the oracle accepted, since that is the only
    // place the answer can change, and before attribution reverts the tree for its own reasons.
    let restored = true;
    if (task === "accepted") {
      const reverted = await resetToBase(checkout, options, timeoutMs);
      if (reverted) {
        const onBase = await judgeTask(checkout, options, timeoutMs, "base");
        if (onBase.run !== null) oracleRuns.push(onBase.run);
        restored = await restorePatch(checkout, options, timeoutMs);
        if (onBase.task === "accepted") {
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
        : { verdict: "unmeasured" as const, unreached: [], measured: null, setAside: undefined };
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
    const evaluator = options.acceptance;
    const acceptance =
      evaluator === undefined || contract === undefined
        ? undefined
        : await verifyAcceptanceContract(contract.contract, {
            evidence: evaluator.evidence,
            execute: (requirement, target) => evaluator.execute(requirement, target, checkout),
          });
    let presetControl: GoalVerification["presetControl"];
    // The base-control verification, kept for the challenge reading of family one: whether the
    // requirement checks reject the tree before the work.
    let baseVerification: GoalVerification | null = null;
    const challengePolicy: ChallengePolicy = options.goal?.challengePolicy ?? "off";
    const preset = options.goal?.contract.preset;
    if (options.goal !== undefined && (preset?.kind === "bugfix" || preset?.kind === "refactor")) {
      if (!(await resetToBase(checkout, options, timeoutMs)))
        throw new Error("cannot prepare preset base control");
      const baseTreeRun = await options.commands.runVouched(["git", "rev-parse", "HEAD^{tree}"], {
        cwd: checkout,
        timeoutMs,
      });
      const baseTree = baseTreeRun.stdout.trim();
      if (baseTreeRun.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(baseTree))
        throw new Error("preset base tree unavailable");
      const baseResult = await verifyGoal({
        ...options.goal,
        tree: baseTree,
        purpose: "base-control",
        checkout,
        commands: options.commands,
        timeoutMs,
      });
      baseVerification = baseResult;
      presetControl = {
        kind: preset.kind,
        baseTree,
        accepted:
          preset.kind === "refactor"
            ? baseResult.accepted
            : reproducedBug(options.goal.contract, options.goal.evidence, baseTree),
      };
      restored = await restorePatch(checkout, options, timeoutMs);
    }
    // A contract without a preset has no base control of its own; challenging it needs one, and
    // it runs before the candidate's verification so the final goal record stays the last.
    if (
      options.goal !== undefined &&
      challengePolicy !== "off" &&
      baseVerification === null &&
      restored
    ) {
      if (!(await resetToBase(checkout, options, timeoutMs)))
        throw new Error("cannot prepare the challenge base control");
      const baseTreeRun = await options.commands.runVouched(["git", "rev-parse", "HEAD^{tree}"], {
        cwd: checkout,
        timeoutMs,
      });
      const baseTree = baseTreeRun.stdout.trim();
      if (baseTreeRun.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(baseTree))
        throw new Error("challenge base tree unavailable");
      baseVerification = await verifyGoal({
        ...options.goal,
        tree: baseTree,
        purpose: "base-control",
        checkout,
        commands: options.commands,
        timeoutMs,
      });
      restored = await restorePatch(checkout, options, timeoutMs);
    }
    let goalTree = options.goal?.tree ?? "";
    if (options.goal !== undefined && goalTree === "" && restored) {
      const staged = await options.commands.runVouched(["git", "add", "--all"], {
        cwd: checkout,
        timeoutMs,
      });
      const written = await options.commands.runVouched(["git", "write-tree"], {
        cwd: checkout,
        timeoutMs,
      });
      if (
        staged.exitCode !== 0 ||
        written.exitCode !== 0 ||
        !/^[a-f0-9]{40,64}$/.test(written.stdout.trim())
      )
        throw new Error("cannot pin final candidate tree for goal checks");
      goalTree = written.stdout.trim();
    }
    const goalAcceptance =
      options.goal === undefined || !restored
        ? undefined
        : await verifyGoal({
            ...options.goal,
            tree: goalTree,
            ...(upgradeAuthorization === undefined || upgradeResolution === undefined
              ? {}
              : {
                  upgradeControl: {
                    manifestRecord: upgradeAuthorization,
                    resolution: upgradeResolution,
                  },
                }),
            ...(presetControl === undefined ? {} : { presetControl }),
            checkout,
            commands: options.commands,
            timeoutMs,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
    if (goalAcceptance !== undefined)
      task = goalAcceptance.accepted
        ? "accepted"
        : goalAcceptance.obligations.some((entry) => entry.status === "unjudged")
          ? "unjudged"
          : "rejected";
    // Only after the candidate has been judged, over the same checkout, put back afterwards:
    // every challenge writes into a tree that is restored before anything else reads it.
    let challenges: ChallengeReport | undefined;
    if (
      options.goal !== undefined &&
      goalAcceptance !== undefined &&
      challengePolicy !== "off" &&
      restored
    ) {
      const goalOptions = options.goal;
      challenges = await challengeGoal({
        contract: goalOptions.contract,
        contractDigest: goalAcceptance.contractDigest,
        policy: challengePolicy,
        evidence: goalOptions.evidence,
        changed: parseUnifiedDiff(options.patch).map((file) => ({
          path: file.path,
          addedLines: file.addedLines,
        })),
        candidate: goalAcceptance,
        baseControl: baseVerification,
        checksWithPatch: withPatch,
        runner: createChallengeRunner({
          contract: goalOptions.contract,
          checkout,
          commands: options.commands,
          timeoutMs,
          scratchDirectory: dirname(checkout),
          restoreCandidate: () => restorePatch(checkout, options, timeoutMs),
          runRepositoryChecks: () => runChecks(checkout, options, timeoutMs),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }),
      });
      restored = await restorePatch(checkout, options, timeoutMs);
    }
    const checks = withPatch.some(
      (check) => check.status === "failed" || passedOnlyUnderThePatchConfiguration(check),
    )
      ? await attributeFailures(withPatch, checkout, options, timeoutMs)
      : withPatch;
    // A run that was not asked to measure the suite reports that, rather than reporting the
    // absence of a failure as an absence of a problem. A failure the base already had is
    // measured: the base control ran the same check and found it failing there too, so it
    // says nothing about this patch and does not leave the dimension unmeasured. Ten of
    // twenty-two adjudicated-correct pull requests in the AI-authored study read as refused
    // for a lint or format failure their base carried; they are named as inherited instead.
    const incompleteRequired = checks.some(
      (check) =>
        check.severity === "blocking" &&
        check.status !== "passed" &&
        check.optionalAbsence !== true &&
        !(check.status === "failed" && check.inheritedFromBase === true),
    );
    const measuredSomething = checks.some((check) => check.status !== "not-applicable");
    // `unattributed` is neither: the patch may have added a failure inside a check that already
    // failed, and nothing shows it did not, so the dimension is unmeasured rather than passed.
    const causedByThePatch = (check: IndependentCheck) =>
      check.status === "failed" &&
      check.inheritedFromBase !== true &&
      check.attribution !== "unattributed";
    const regression: IndependentVerification["regression"] = checks.some(causedByThePatch)
      ? "fail"
      : incompleteRequired
        ? "unmeasured"
        : checks.some((check) => check.status === "passed")
          ? "pass"
          : // Everything that failed, the base failed identically, and nothing passed: this patch
            // broke nothing and nothing here establishes that it did not either.
            "unmeasured";

    return {
      applied: true,
      certificationPolicy:
        options.goal !== undefined
          ? "goal-obligations-v1"
          : acceptance === undefined
            ? "oracle-v3"
            : "required-obligations-v1",
      ...(goalAcceptance === undefined ? {} : { goalAcceptance }),
      ...(challenges === undefined ? {} : { challenges }),
      ...(acceptance === undefined ? {} : { acceptance }),
      checks,
      oracleReach,
      unreachedByOracle: reach.unreached,
      ...(reach.setAside === undefined ? {} : { setAsideByReach: reach.setAside }),
      oracleBond: bond.verdict,
      bondedMutants: bond.mutants,
      ...(oracleRuns.length === 0 ? {} : { oracleRuns }),
      refusal: null,
      regression,
      task,
      // Both, and the second is the one a suite cannot supply. A patch that adds a feature badly
      // still passes a suite written before the feature existed.
      //
      // Computed from the recorded fields by the same rule a third party applies to the record
      // afterwards, so `verified` is the absence of a named reason to refuse rather than a
      // separate opinion about the same evidence.
      verified: certifies({
        ...(options.goal === undefined
          ? {}
          : { certificationPolicy: "goal-obligations-v1", goalAcceptance }),
        ...(challenges === undefined
          ? {}
          : { challenges: { policy: challenges.policy, satisfied: challenges.satisfied } }),
        regression,
        task,
        oracleReach,
        oracleBond: bond.verdict,
        ...(acceptance === undefined
          ? {}
          : { certificationPolicy: "required-obligations-v1", acceptance }),
      }),
      // Not the same as a checkout where nothing could run: this one was asked for one thing and
      // did it, so the absence of checks is the request rather than a failure to measure.
      unmeasured:
        !onlyTheOracle && (!measuredSomething || (incompleteRequired && regression !== "fail")),
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
                : checks.some(causedByThePatch)
                  ? `a check failed on this patch in a way it did not fail at the base commit: ${checks
                      .filter(causedByThePatch)
                      .map(
                        (check) =>
                          check.id +
                          ((check.newFailures ?? []).length > 0
                            ? ` (newly failing: ${(check.newFailures ?? []).slice(0, 5).join("; ")})`
                            : (check.regressedUnderBaseConfiguration ?? []).length > 0
                              ? ` (passes only under this patch's changes to ${(check.configurationFiles ?? []).join(", ")}; with the base's configuration these tests the base passed fail: ${(check.regressedUnderBaseConfiguration ?? []).slice(0, 5).join("; ")})`
                              : ""),
                      )
                      .join(", ")}. Read its finding above; if the suite is nondeterministic, ` +
                    "that is what the base control cannot tell apart from a regression."
                  : checks.some((check) => check.attribution === "unattributed")
                    ? `a check fails at the base commit too, but not in a way that shows this patch added nothing to it: ${checks
                        .filter((check) => check.attribution === "unattributed")
                        .map((check) => check.id)
                        .join(
                          ", ",
                        )}. Its output names no tests to compare and differs from the base's, so a failure this patch introduced could be hidden inside it; the regression dimension is unmeasured, not passed. Fixing the base's failure makes the comparison exact.`
                    : checks.some(
                          (check) =>
                            (check.configurationFiles ?? []).length > 0 &&
                            check.status === "not-applicable" &&
                            check.configurationObservation !== undefined,
                        )
                      ? `a check passes only with this patch's changes to the runner configuration (${[
                          ...new Set(checks.flatMap((check) => check.configurationFiles ?? [])),
                        ].join(
                          ", ",
                        )}); with the base's configuration restored it does not pass, so it measured nothing the base's instrument would stand behind. The instrument comes from the base commit, as the commands do.`
                      : checks.some((check) => check.inheritedFromBase === true)
                        ? "at least one check fails at the base commit too, with this patch not applied, and " +
                          "every test it fails also failed there (or its output is the same), so it is reported " +
                          "as inherited rather than as a regression. A common cause is a project that builds on " +
                          "install: dependencies are installed with --ignore-scripts, because install scripts run " +
                          "whatever the registry serves, so a `prepare` step that generates what the tests import " +
                          "does not run."
                        : !measuredSomething
                          ? `nothing here measured the patch: every check stood down (${checks
                              .map((check) => `${check.id}: ${check.detail}`)
                              .join("; ")}). ` +
                            (checks.some((check) => /not installed/.test(check.detail))
                              ? "A runner that is not installed on a fresh checkout usually means no installed " +
                                "dependencies: pass --install to authorize lockfile setup with lifecycle scripts " +
                                "disabled, or provide a prepared runtime. A toolchain the verifier does not drive " +
                                "(Rust, Java, Go) stays unmeasured, which is not a pass."
                              : "No declared check applies to this project as the verifier reads it; name the " +
                                "command to run with --command, or add a test script to the manifest.")
                          : incompleteRequired
                            ? `a required check measured nothing: ${checks
                                .filter(
                                  (check) =>
                                    check.severity === "blocking" &&
                                    check.status !== "passed" &&
                                    check.optionalAbsence !== true,
                                )
                                .map((check) => `${check.id} (${check.detail})`)
                                .join("; ")}. Nothing here says the suite passed.`
                            : task === "unjudged"
                              ? "the repository's own suite passed, which says nothing broke. It does not say the " +
                                "task was done: a suite tests the behaviour a project already had, and a task adds " +
                                "behaviour it did not. Pass --oracle <command> with a check that says whether the " +
                                "task was done."
                              : "",
      install,
      checkoutPath: checkout,
    };
  } catch (cause) {
    if (cause instanceof GoalEffectReconciliationError) {
      preserveCheckout = true;
      throw cause;
    }
    if (cause instanceof DependencySetupReconciliationError) {
      preserveCheckout = true;
      throw new DependencySetupReconciliationError(`${checkout}: ${cause.message}`);
    }
    throw cause;
  } finally {
    if (!preserveCheckout) await rm(checkout, { recursive: true, force: true });
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
  /** Undefined where the change was never classified, because nothing was asked at all. */
  setAside: readonly { readonly path: string; readonly reason: ReachSetAside }[] | undefined;
}> {
  const nothingMeasured = {
    verdict: "unmeasured" as const,
    unreached: [],
    measured: null,
    setAside: undefined,
  };
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
    const measured = await lineHitsUnder(plan, checkout, changed, options.commands, timeoutMs);
    if (measured === null) {
      return nothingMeasured;
    }
    const reach = oracleReachedTheChange({ changed, measured });
    return {
      // A change with no file reach can judge was not measured and found complete. The hits stay,
      // because the bond reads them for its own question.
      verdict: reach.judgedFiles === 0 ? "unmeasured" : reach.reached ? "reached" : "unreached",
      unreached: reach.unreached,
      measured,
      setAside: reach.setAside,
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

  // What the loop last wrote into the checkout: the mutant under adjudication, while one is.
  let written: { readonly path: string; readonly text: string } | null = null;
  return bondOracleWithMutants({
    mutants: mutantsOfChangedLines({ changed }),
    measured,
    checksWithPatch,
    // Left to the one place the decision lives rather than passed from here, so a run and the
    // arithmetic over its record cannot disagree about which regime produced it.
    runner: {
      read: (path) => readFile(join(checkout, path), "utf8").catch(() => null),
      write: async (path, text) => {
        written = { path, text };
        await writeFile(join(checkout, path), text);
      },
      parses: nodeSyntaxCheck(options.commands, { cwd: checkout, timeoutMs }),
      runOracle: async () => {
        const ran = await options.commands.run(inProjectEnvironment(oracle), {
          cwd: checkout,
          timeoutMs,
        });
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
          return await lineHitsUnder(plan, checkout, changed, options.commands, timeoutMs);
        } finally {
          await rm(destination, { recursive: true, force: true });
        }
      },
      // The suite the mutant is compared against ran before any oracle did, on the base and the
      // patch alone. An oracle leaves what it wrote in the checkout: a mined task's oracle copies
      // the pull request's whole test file, held-back cases included, and a suite run over that
      // file is the held-back half noticing the mutant, not the repository. So the checkout is put
      // back to the base and the patch, the mutant written again, and only then is the suite run.
      // A checkout that cannot be put back reports no check, which witnesses nothing.
      runRepositoryChecks: async () => {
        if (!(await restorePatch(checkout, options, timeoutMs))) return [];
        if (written !== null) await writeFile(join(checkout, written.path), written.text);
        return runChecks(checkout, options, timeoutMs);
      },
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
export async function lineHitsUnder(
  plan: OracleCoveragePlan,
  checkout: string,
  changed: readonly { readonly path: string }[],
  commands: Pick<GateCommandRunner, "run" | "runVouched">,
  timeoutMs: number,
): Promise<Record<string, Record<number, number>> | null> {
  if (plan.kind === "node-lcov") {
    const observed = await commands.runVouched(plan.argv, { cwd: checkout, timeoutMs });
    if (observed.unavailable !== null || observed.exitCode !== 0) {
      return null;
    }
    const sections = parseLineHits(observed.stderr);
    return sections.length === 0 ? null : lineHitsByWorkspacePath(sections, checkout);
  }

  if (plan.kind === "v8") {
    const observed = await commands.run(plan.command, {
      cwd: checkout,
      timeoutMs,
      environment: { NODE_V8_COVERAGE: plan.destination },
    });
    if (observed.unavailable !== null || observed.exitCode !== 0) {
      return null;
    }
    const read = readV8Coverage({
      directory: plan.destination,
      workspaceRoot: checkout,
      files: changed.map((file) => file.path),
    });
    return read.unusable === null ? { ...read.hits } : null;
  }

  const observed = await commands.run(plan.command, { cwd: checkout, timeoutMs });
  if (observed.unavailable !== null || observed.exitCode !== 0) {
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
    ["git", "-C", ".", "checkout", "--force", "--detach", options.baseCommit],
    { cwd: checkout, timeoutMs },
  );
  if (reverted.exitCode !== 0) {
    await options.goal?.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "checkout-restore-failure-v1",
        operation: "reset",
        observation: reverted,
      }),
    });
    return false;
  }
  const cleaned = await options.commands.runVouched(["git", "-C", ".", "clean", "-fdq"], {
    cwd: checkout,
    timeoutMs,
  });
  if (cleaned.exitCode !== 0)
    await options.goal?.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "checkout-restore-failure-v1",
        operation: "clean",
        observation: cleaned,
      }),
    });
  if (cleaned.exitCode !== 0) return false;
  // Snapshot restoration changes stat metadata across mounted filesystems. Refresh it without staging content.
  const refreshed = await options.commands.runVouched(["git", "update-index", "--refresh"], {
    cwd: checkout,
    timeoutMs,
  });
  if (refreshed.exitCode !== 0)
    await options.goal?.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "checkout-restore-failure-v1",
        operation: "refresh",
        observation: refreshed,
      }),
    });
  return refreshed.exitCode === 0;
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
    [
      "git",
      "-C",
      ".",
      "apply",
      ...(options.patch.trim() === "" ? ["--allow-empty"] : []),
      "--3way",
      "--whitespace=nowarn",
      ".swarm-restore.patch",
    ],
    { cwd: checkout, timeoutMs },
  );
  await rm(patchPath, { force: true });
  if (applied.exitCode !== 0)
    await options.goal?.evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "checkout-restore-failure-v1",
        operation: "apply",
        observation: applied,
      }),
    });
  return applied.exitCode === 0;
}

/**
 * Runs the same checks again with the patch reverted, so a failure can be attributed. A check
 * fails "both ways" is not enough to call it inherited: the patch may have broken a second test
 * inside a check the base already failed. So the failure is attributed from the two runs' own
 * observations (see failure-attribution.ts), and a check that passed only under the patch's
 * runner configuration is decided here too, since that needs the base's passing tests.
 */
async function attributeFailures(
  withPatch: readonly IndependentCheck[],
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  // Cleaned as well as checked out: the base is measured as the base, and not beside whatever an
  // oracle copied into the checkout. A mined task's pull-request test file fails on the base by
  // construction, and left in place it read every regression the patch caused as inherited.
  if (!(await resetToBase(checkout, options, timeoutMs))) {
    return withPatch.map((check) =>
      passedOnlyUnderThePatchConfiguration(check)
        ? { ...check, status: "not-applicable" as const }
        : check.status === "failed"
          ? { ...check, attribution: "unattributed" as const, inheritedFromBase: false }
          : check,
    );
  }
  const atBase = await runChecks(checkout, options, timeoutMs);
  return withPatch.map((check) => {
    const same = atBase.find((one) => one.id === check.id);
    const baseObservation =
      same?.observation === undefined ? {} : { baseObservation: same.observation };
    let decided: IndependentCheck = check;
    if (
      passedOnlyUnderThePatchConfiguration(check) &&
      check.configurationObservation !== undefined
    ) {
      const reading = underBaseConfiguration({
        withPatchStatus: "passed",
        baseConfigurationStatus: check.configurationStatus ?? "passed",
        baseConfiguration: check.configurationObservation,
        atBase: same?.observation,
      });
      decided = {
        ...check,
        status: reading.status as IndependentCheck["status"],
        ...(reading.regressed.length === 0
          ? {}
          : { regressedUnderBaseConfiguration: reading.regressed }),
        ...baseObservation,
      };
      if (decided.status !== "failed") return decided;
    }
    if (decided.status !== "failed") return decided;
    // A check that failed only under the base's configuration is judged on that reading; the
    // patch's own reading passed and is not the failure being attributed.
    const failing =
      decided.regressedUnderBaseConfiguration !== undefined && decided.configurationObservation
        ? decided.configurationObservation
        : decided.observation;
    const attributed =
      failing === undefined
        ? { attribution: "unattributed" as const, newFailures: [] }
        : attributeFailure({
            withPatch: failing,
            baseStatus: same?.status,
            atBase: same?.observation,
          });
    return {
      ...decided,
      inheritedFromBase: attributed.attribution === "inherited",
      attribution: attributed.attribution,
      attributionRule,
      ...(attributed.newFailures.length === 0 ? {} : { newFailures: attributed.newFailures }),
      ...baseObservation,
    };
  });
}

/** A check whose patched reading passed while the base's runner configuration did not. */
function passedOnlyUnderThePatchConfiguration(check: IndependentCheck): boolean {
  return (
    check.configurationStatus !== undefined &&
    (check.reportedStatus ?? check.status) === "passed" &&
    check.configurationStatus !== "passed"
  );
}

/**
 * The checks again, with the instrument the patch changed put back to the base's (restored where
 * the base has it, removed where the patch added it; a package.json field is restored alone), then
 * the patch's versions written back. Only where the patch changed any: a patch that leaves the
 * instrument alone pays nothing. The readings are kept on each check, and which one stands is
 * decided with the base's own results in hand. A pass under the base's instrument stands; what
 * cannot be put back (a runner dependency from outside the registry) leaves the pass withheld.
 */
async function readUnderBaseConfiguration(
  withPatch: readonly IndependentCheck[],
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
): Promise<readonly IndependentCheck[]> {
  const changed = new Set<string>();
  for (const check of withPatch)
    for (const file of check.instrument?.files ?? [])
      if (file.reference !== file.current) changed.add(file.path);
  const files = [...changed].sort();
  if (files.length === 0 || withPatch.length === 0) return withPatch;
  const whole = [...new Set(files.map((path) => path.split("#")[0] as string))];
  const patched = new Map<string, string | null>();
  for (const path of whole)
    patched.set(path, await readFile(join(checkout, path), "utf8").catch(() => null));
  try {
    for (const path of whole) {
      const atBase = await options.commands.runVouched(
        ["git", "-C", ".", "show", `${options.baseCommit}:${path}`],
        { cwd: checkout, timeoutMs },
      );
      const fields = files
        .filter((one) => one.startsWith(`${path}#`))
        .map((one) => one.slice(path.length + 1));
      const current = patched.get(path) ?? null;
      if (
        path === "package.json" &&
        fields.length > 0 &&
        !files.includes(path) &&
        atBase.exitCode === 0 &&
        current !== null
      ) {
        await writeFile(
          join(checkout, path),
          restoreManifestFields(current, atBase.stdout, fields),
        );
        continue;
      }
      if (atBase.exitCode === 0) await writeFile(join(checkout, path), atBase.stdout);
      else await rm(join(checkout, path), { force: true });
    }
    const underBase = await runChecks(checkout, options, timeoutMs);
    return withPatch.map((check) => {
      const reading = underBase.find((one) => one.id === check.id);
      if (reading?.observation === undefined) return check;
      const reported = check.reportedStatus ?? check.status;
      return {
        ...check,
        // Measured again under the base's instrument and passed there: that reading is the evidence.
        ...(reported === "passed" && reading.status === "passed"
          ? { status: "passed" as const }
          : {}),
        configurationObservation: reading.observation,
        configurationStatus: reading.status,
        configurationFiles: files,
        ...(reading.instrument === undefined
          ? {}
          : { configurationInstrument: reading.instrument }),
      };
    });
  } finally {
    for (const [path, text] of patched) {
      if (text === null) await rm(join(checkout, path), { force: true });
      else await writeFile(join(checkout, path), text);
    }
  }
}

/** The patched manifest with the fields the instrument reads put back to the base's. */
function restoreManifestFields(current: string, base: string, fields: readonly string[]): string {
  const after = JSON.parse(current) as Record<string, unknown>;
  const before = JSON.parse(base) as Record<string, unknown>;
  for (const field of fields) {
    const [head, ...rest] = field.split(".");
    if (head === "scripts" && rest.length > 0) {
      const name = rest.join(".");
      const scripts = { ...((after.scripts as Record<string, unknown> | undefined) ?? {}) };
      const original = (before.scripts as Record<string, unknown> | undefined)?.[name];
      if (original === undefined) delete scripts[name];
      else scripts[name] = original;
      after.scripts = scripts;
    } else if (head !== undefined && rest.length === 0) {
      if (before[head] === undefined) delete after[head];
      else after[head] = before[head];
    }
  }
  return `${JSON.stringify(after, null, 2)}\n`;
}

/**
 * The trusted task-specific check, run in the fresh checkout. Nothing infers it: a task oracle
 * is written by whoever set the task, before the run, and its absence is reported rather than
 * papered over with the suite's own verdict.
 */
/** One run of the task oracle, as observed: enough to say why it accepted or refused. */
export interface OracleRun {
  readonly tree: "patched" | "base";
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
  /** The last 4000 characters of what it wrote to stdout and stderr, in that order. */
  readonly outputTail: string;
}

/**
 * The oracle as the user wrote it, with the project environment the harness prepared first on
 * PATH: `.venv/bin` for a Python project and `node_modules/.bin` for a Node one, as `uv run` and
 * `npm exec` would. The repository's checks already call those interpreters by path; an oracle
 * written `python -m pytest ...` otherwise reached the image's own interpreter, which has none of
 * the project's packages, and was reported as rejecting a patch it accepts. Paths are relative
 * to the checkout (`$PWD`), so the same text works on the host and inside a container, and a
 * directory that does not exist changes nothing.
 */
export function inProjectEnvironment(command: string): string {
  return `PATH="$PWD/.venv/bin:$PWD/node_modules/.bin:$PATH"; export PATH; ${command}`;
}

async function judgeTask(
  checkout: string,
  options: IndependentVerificationOptions,
  timeoutMs: number,
  tree: OracleRun["tree"] = "patched",
): Promise<{ readonly task: IndependentVerification["task"]; readonly run: OracleRun | null }> {
  if (options.taskOracle === undefined) {
    return { task: "unjudged", run: null };
  }
  const ran = await options.commands.run(inProjectEnvironment(options.taskOracle.command), {
    cwd: checkout,
    timeoutMs,
  });
  const output = `${ran.stdout}${ran.stdout && ran.stderr ? "\n" : ""}${ran.stderr}`;
  return {
    task: ran.exitCode === 0 ? "accepted" : "rejected",
    run: {
      tree,
      command: options.taskOracle.command,
      exitCode: ran.exitCode,
      durationMs: ran.durationMs,
      outputTail: output.slice(-4000),
    },
  };
}

/**
 * The gates assembled from the base commit's manifests, not the patched tree's. A patch that
 * rewrites the test script would otherwise choose the instrument that measures it.
 */

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
