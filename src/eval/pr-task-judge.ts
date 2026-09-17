import { join } from "node:path";
import { childEnvironment, defaultChildHome } from "../exec/child-environment.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import { classifyAgainstHeldBackOracle, type OracleVerdict } from "./campaign-run.ts";
import { heldBackRefusalIsReal, oracleCommand, type TestRunner } from "./oracle-filter.ts";

/**
 * Judging one mined pull-request task: one half's case titles in, `swarm ci`'s verdict out.
 *
 * One definition, because every place this was written twice has been a defect. The
 * order-dependence check once lived in the fresh pass and not in `--rejudge`, so re-judging
 * winston#2256 turned a task already recorded as order-dependent back into a false green. A
 * second campaign over the same corpus is a third caller, and it reads the same functions.
 */
export interface JudgedTask {
  readonly repository: string;
  readonly pull: number;
  readonly baseCommit: string;
  readonly testFile: string;
  readonly runner: string;
  readonly sealedCases: readonly string[];
  readonly heldBackCases: readonly string[];
}

export interface CommandOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Killed at its deadline rather than finished, which is a different thing from failing. */
  readonly timedOut: boolean;
}

/**
 * One command, with whatever it started stopped alongside it.
 *
 * `execFile`'s timeout signals the process it started and nothing else, and a mined repository's
 * suite starts servers: two thousand node processes belonging to one repository's tests were
 * still running two days after the campaign that began them, holding deleted checkouts open. The
 * harness already owns the answer, a process group and one signal to it.
 */
export async function runCommand(
  file: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly timeoutMs?: number;
  } = {},
): Promise<CommandOutcome> {
  const ran = await runProcessGroup(file, args, {
    cwd: options.cwd ?? process.cwd(),
    env: childEnvironment(options.env ?? process.env, { homeDir: defaultChildHome() }).variables,
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    maxOutputBytes: 64 * 1024 * 1024,
  });
  return {
    code: ran.startFailure === null ? ran.exitCode : 127,
    stdout: ran.stdout,
    stderr: ran.startFailure ?? ran.stderr,
    timedOut: ran.timedOut,
  };
}

/**
 * The timezone the project's own test script sets, read from the base commit rather than from the
 * viability record: tasks judged before that fix carry no timezone, and re-deriving it here covers
 * them without re-judging. dayjs runs its suite under four zones in one command, and a timezone
 * test lifted out of that and run under whatever zone this machine is in fails for a reason that
 * is not the patch, which costs an opportunity rather than producing a wrong verdict.
 */
export async function declaredTimezone(
  checkout: string,
  baseCommit: string,
): Promise<string | null> {
  const shown = await runCommand("git", ["show", `${baseCommit}:package.json`], { cwd: checkout });
  if (shown.code !== 0) return null;
  try {
    const declared: unknown = JSON.parse(shown.stdout).scripts?.test ?? "";
    return (/\bTZ=([A-Za-z_+\-/0-9]+)/.exec(String(declared)) ?? [])[1] ?? null;
  } catch {
    return null;
  }
}

export function runnerKind(runner: string): TestRunner {
  return runner.includes("jest")
    ? "jest"
    : runner.includes("vitest")
      ? "vitest"
      : runner.includes("mocha")
        ? "mocha"
        : runner.includes("ava")
          ? "ava"
          : "node";
}

/** What `swarm ci --json` said, or the named reason it said nothing. Read, never reshaped. */
export interface HalfVerdict {
  readonly verified?: boolean;
  readonly task: OracleVerdict;
  readonly regression: "pass" | "fail" | "unmeasured";
  readonly oracleReach?: "reached" | "unreached" | "unmeasured";
  readonly unreachedByOracle?: readonly {
    readonly path: string;
    readonly lines: readonly number[];
  }[];
  readonly oracleBond?: "held" | "vacuous" | "unshown" | "not-bonded";
  readonly bondedMutants?: readonly { readonly id: string; readonly verdict: string }[];
  readonly applied?: boolean;
  readonly refusal?: string | null;
  readonly advice?: string;
  readonly judgeFailure?: string;
}

export type HalfJudge = (
  titles: readonly string[],
  options?: { readonly oracleOnly?: boolean },
) => Promise<HalfVerdict>;

/**
 * The judge for one task and one patch.
 *
 * The declared timezone travels as an environment name rather than as a shell prefix on the
 * command. `TZ=x mkdir … && cp … && npx jest …` sets the zone for the mkdir and nothing else, so
 * the oracle ran under whatever zone this machine is in while the viability filter that admitted
 * the task ran under the project's own. dayjs runs its suite under four zones for a reason.
 *
 * The repository's own checks run once per judge, on the first judgement, unless the caller says
 * that judgement is oracle-only too. Only that judgement's `regression` is read: the suite answers
 * the same way every time, so running it per half is the same minutes spent again, and on this
 * corpus that is most of a campaign.
 */
export async function halfJudgeFor(input: {
  readonly task: JudgedTask;
  readonly checkout: string;
  readonly patchPath: string;
  readonly storedTestFile: string;
  readonly cliPath: string;
  readonly isolation: string | null;
}): Promise<HalfJudge> {
  const { task, checkout } = input;
  const runner = runnerKind(task.runner);
  const runnerArgv = task.runner.split(" ");
  const zone = await declaredTimezone(checkout, task.baseCommit);
  let checksAlreadyRun = false;
  return async (titles, options = {}) => {
    const command = oracleCommand({
      storedTestFile: input.storedTestFile,
      destination: task.testFile,
      runner,
      runnerArgv,
      titles,
    });
    if (command === null) {
      return {
        verified: false,
        task: "unjudged",
        regression: "unmeasured",
        judgeFailure: `${runner} has no filter that names exactly one half's cases`,
      };
    }
    const onlyTheOracle = checksAlreadyRun || options.oracleOnly === true;
    checksAlreadyRun = true;
    const asked = await runCommand(
      process.execPath,
      [
        input.cliPath,
        "ci",
        ...(input.isolation === null ? [] : ["--isolation", input.isolation]),
        "--patch",
        input.patchPath,
        "--workspace",
        checkout,
        "--base",
        task.baseCommit,
        "--install",
        ...(onlyTheOracle ? ["--oracle-only"] : []),
        "--oracle",
        command,
        "--json",
      ],
      {
        timeoutMs: 20 * 60_000,
        env: zone === null ? process.env : { ...process.env, TZ: zone },
      },
    );
    try {
      return JSON.parse(`${asked.stdout}`.trim().split("\n").at(-1) ?? "") as HalfVerdict;
    } catch {
      // A judge that could not run is not a judge that had nothing to say. Both used to arrive
      // here as `unjudged`, which is also what a run with no oracle reports, and twelve of the
      // corpus's twenty-one unjudgeable tasks are this case with nothing recorded about why.
      return {
        verified: false,
        task: "unjudged",
        regression: "unmeasured",
        judgeFailure:
          (asked.timedOut
            ? "swarm ci was killed at its deadline: "
            : `swarm ci exited ${asked.code} without a verdict: `) +
          `${(asked.stderr || asked.stdout).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`,
      };
    }
  };
}

export interface SettledHeldBack {
  readonly heldBack: HalfVerdict;
  readonly heldBackVerdict: OracleVerdict;
  readonly orderDependent: boolean;
}

/**
 * The held-back half's verdict, with its refusal told apart from order dependence.
 *
 * A false green is the most consequential thing this corpus measures, so it is the last place to
 * take a refusal at face value. Splitting one suite assumes its tests are independent and plenty
 * are not: winston's container tests share state, and the held-back half failed alone while
 * passing beside the sealed half.
 *
 * Asked wherever the answer can change, which is wherever the sealed half accepted and the
 * held-back half refused. It used to be asked only where the tool had certified, and that gate
 * flattered the tool as soon as the reach check started refusing.
 */
export async function settleHeldBack(
  judge: HalfJudge,
  task: JudgedTask,
  sealedTask: OracleVerdict,
  options: { readonly oracleOnly?: boolean } = {},
): Promise<SettledHeldBack> {
  const heldBack = await judge(task.heldBackCases, options);
  if (sealedTask === "accepted" && heldBack.task === "rejected") {
    const together = await judge([...task.sealedCases, ...task.heldBackCases], options);
    const orderDependent = !heldBackRefusalIsReal({
      aloneFailed: true,
      togetherFailed: together.task !== "accepted",
    });
    return {
      heldBack,
      heldBackVerdict: orderDependent ? "accepted" : heldBack.task,
      orderDependent,
    };
  }
  return { heldBack, heldBackVerdict: heldBack.task, orderDependent: false };
}

/** The verdicts one task produces, given a judge that runs one half of its cases. */
export async function judgeAgainstBothHalves(judge: HalfJudge, task: JudgedTask) {
  const sealed = await judge(task.sealedCases);
  const settled = await settleHeldBack(judge, task, sealed.task);
  return {
    sealed,
    ...settled,
    corner: classifyAgainstHeldBackOracle({
      verifiedWithFirstOracle: sealed.verified === true,
      heldBack: settled.heldBackVerdict,
      regression: sealed.regression,
      sealed: sealed.task,
      ...(sealed.oracleReach === undefined ? {} : { oracleReach: sealed.oracleReach }),
      ...(sealed.oracleBond === undefined ? {} : { oracleBond: sealed.oracleBond }),
    }),
  };
}

/**
 * Why a verdict says nothing, in the verifier's own words, or null where it said something.
 *
 * `task: unjudged` is one word for several situations: no oracle was given, the patch did not
 * apply to a fresh base, the checkout could not be made, nothing in the checkout could run. Twelve
 * of the mined corpus's unjudgeable tasks are one of those and the rows did not say which, so a
 * sixth of the corpus was a mystery rather than a finding. The verifier already computes the
 * sentence; this keeps it.
 */
export function whyNothingWasJudged(verdict: HalfVerdict): string | null {
  if (verdict.judgeFailure !== undefined) return verdict.judgeFailure;
  if (verdict.task !== "unjudged") return null;
  if (verdict.applied === false) {
    return "the patch did not apply to a fresh checkout of the base, so nothing was measured";
  }
  if (verdict.refusal) return `refused before anything ran: ${verdict.refusal}`;
  return verdict.advice
    ? `nothing judged: ${verdict.advice}`
    : "nothing judged, and no reason given";
}

/**
 * Whether the model endpoint answers a trivial request, asked of the endpoint a pass was told to
 * use rather than of the model's own reachability in general.
 */
export async function endpointAnswers(
  endpoint: string,
): Promise<{ readonly answered: boolean; readonly detail: string }> {
  try {
    const asked = await fetch(`${endpoint.replace(/\/+$/, "")}/models`, {
      signal: AbortSignal.timeout(15_000),
    });
    return asked.ok
      ? { answered: true, detail: "" }
      : { answered: false, detail: `HTTP ${asked.status} from ${endpoint}` };
  } catch (cause) {
    return {
      answered: false,
      detail: `${cause instanceof Error ? cause.message : String(cause)} (${endpoint})`,
    };
  }
}

/** Where a task's files live under a working root, named the one way every pass names them. */
export function taskSlug(task: { readonly repository: string; readonly pull: number }): string {
  return `${task.repository.replace("/", "__")}-${task.pull}`;
}

export function taskCheckout(workingRoot: string, task: { readonly repository: string }): string {
  return join(workingRoot, "work", task.repository.replace("/", "__"));
}
