import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import { type ArmRun, type ArmScore, scoreArms } from "./arms.ts";
import { type McNemarResult, mcNemar } from "./statistics.ts";

/**
 * Driving the arms across the corpus.
 *
 * The statistics and the arm definitions existed and nothing ran them. This is the part that
 * does, and the interesting decision in it is where acceptance comes from.
 *
 * The golden set ships its test file inside the case seed, so a run can see it and edit it. An
 * arm with no ratchet can therefore pass its own gate by deleting the test. That is not a defect
 * in the corpus: it is the thing the campaign is measuring, and it is only measurable if
 * acceptance is decided by a copy of the test the run never had access to. So the oracle is the
 * original test file, restored over whatever the run left, and asked again.
 */
export interface CampaignCase {
  readonly id: string;
  readonly taskClass: string;
  readonly prompt: string;
  readonly seed: Readonly<Record<string, string>>;
  readonly gateCommand: string;
}

export interface PlannedRun {
  readonly armId: string;
  readonly caseId: string;
  readonly seed: number;
  /** Same case, same seed, every arm: what makes the comparison paired. */
  readonly pairId: string;
  /** Names the work rather than the moment, so a resumed campaign skips what it already did. */
  readonly idempotencyKey: string;
}

export interface CampaignPlan {
  readonly runs: readonly PlannedRun[];
  readonly total: number;
}

export function campaignPlan(input: {
  readonly arms: readonly string[];
  readonly cases: readonly CampaignCase[];
  readonly seeds: number;
}): CampaignPlan {
  const runs: PlannedRun[] = [];
  for (const one of input.cases) {
    for (let seed = 0; seed < input.seeds; seed += 1) {
      const pairId = `${one.id}#${seed}`;
      for (const armId of input.arms) {
        runs.push({
          armId,
          caseId: one.id,
          seed,
          pairId,
          idempotencyKey: `sha256:${createHash("sha256")
            .update(`${armId} ${one.id} ${seed} ${one.prompt}`)
            .digest("hex")}`,
        });
      }
    }
  }
  return { runs, total: runs.length };
}

/**
 * Whether a case's tests are its specification or its deliverable.
 *
 * Restoring the tests is the right oracle where the test is the specification: the run was asked
 * to make it pass, so putting it back and asking again catches a run that weakened it. It is the
 * wrong oracle where the run was asked to write the tests, because restoring then deletes the
 * work being judged and measures what is left.
 *
 * Read off the gate command rather than the prompt. A gate that measures coverage is a gate
 * whose subject is the tests themselves, and that is a fact about the case rather than a reading
 * of its English.
 */
export function testsAreTheDeliverable(one: CampaignCase): boolean {
  return /coverage|--experimental-test-coverage/.test(one.gateCommand);
}

/** The files the oracle restores. Empty where restoring would delete what is being judged. */
export function hiddenOracleFiles(one: CampaignCase): readonly string[] {
  if (testsAreTheDeliverable(one)) {
    return [];
  }
  return Object.keys(one.seed)
    .filter((name) => /\.test\.[mc]?[jt]s$/.test(name) || name.startsWith("test/"))
    .sort();
}

export interface OracleJudgement {
  readonly accepted: boolean;
  readonly detail: string;
  /**
   * Which oracle was applied. `restored-tests` put the case's own tests back and asked again;
   * `gate-as-written` ran the case's gate over the produced tree untouched, because the tests
   * are what the run was asked to write. A reader should not have to infer which.
   */
  readonly mode: "restored-tests" | "gate-as-written";
}

/**
 * Restores the original tests over whatever the run left and asks again. An arm that deleted the
 * test, weakened it, or made it assert nothing gets the original back and fails here, which is
 * the whole reason acceptance is not read off the run's own gate.
 */
export async function judgeByHiddenOracle(
  workspace: string,
  one: CampaignCase,
): Promise<OracleJudgement> {
  for (const name of hiddenOracleFiles(one)) {
    const original = one.seed[name];
    if (original !== undefined) {
      await writeIntoWorkspace(workspace, name, original);
    }
  }

  const ran = await runProcessGroup("/bin/sh", ["-c", one.gateCommand], {
    cwd: workspace,
    env: harnessChildEnvironment().variables,
    timeoutMs: 120_000,
    maxOutputBytes: 2_000_000,
  });

  const lastLines = (ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" ");
  const mode = testsAreTheDeliverable(one) ? "gate-as-written" : "restored-tests";
  return {
    accepted: ran.exitCode === 0,
    mode,
    detail:
      ran.exitCode === 0
        ? mode === "restored-tests"
          ? "the original tests pass over what the run left"
          : "the case's own gate passes over what the run left, tests included"
        : `the hidden oracle refused it (exit ${ran.exitCode}): ${lastLines || "no output"}`,
  };
}

export interface ArmOutcome {
  readonly accepted: boolean;
  readonly completed: boolean;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly detail: string;
}

export interface CampaignComparison {
  readonly baseline: string;
  readonly against: string;
  readonly onlyBaseline: number;
  readonly onlyAgainst: number;
  readonly discordant: number;
  readonly significant: boolean;
  readonly reason: string;
}

export interface CampaignResult {
  readonly runs: readonly (PlannedRun & ArmOutcome)[];
  readonly scores: readonly ArmScore[];
  readonly comparisons: readonly CampaignComparison[];
}

export async function runCampaign(input: {
  readonly arms: readonly string[];
  readonly cases: readonly CampaignCase[];
  readonly seeds: number;
  readonly scratchRoot: string;
  readonly runArm: (run: PlannedRun, one: CampaignCase) => Promise<ArmOutcome>;
  readonly onRun?: (run: PlannedRun & ArmOutcome, done: number, total: number) => void;
  /** Work already done, keyed the way the plan keys it, so a resumed campaign skips it. */
  readonly alreadyDone?: (key: string) => (PlannedRun & ArmOutcome) | null;
}): Promise<CampaignResult> {
  const plan = campaignPlan(input);
  const byCase = new Map(input.cases.map((one) => [one.id, one]));
  const finished: (PlannedRun & ArmOutcome)[] = [];

  for (const run of plan.runs) {
    const skipped = input.alreadyDone?.(run.idempotencyKey) ?? null;
    if (skipped !== null) {
      finished.push(skipped);
      continue;
    }
    const one = byCase.get(run.caseId);
    let outcome: ArmOutcome;
    try {
      outcome =
        one === undefined
          ? { accepted: false, completed: false, costUsd: 0, latencyMs: 0, detail: "no such case" }
          : await input.runArm(run, one);
    } catch (cause) {
      // Counted, never dropped. A run that crashed is a run that produced no accepted patch,
      // and removing it turns an arm's rate into the rate of the runs that happened to work.
      outcome = {
        accepted: false,
        completed: false,
        costUsd: 0,
        latencyMs: 0,
        detail: cause instanceof Error ? cause.message : String(cause),
      };
    }
    const settled = { ...run, ...outcome };
    finished.push(settled);
    input.onRun?.(settled, finished.length, plan.total);
  }

  return {
    runs: finished,
    scores: scoreArms(
      input.arms.map((armId) => ({
        armId,
        runs: finished
          .filter((run) => run.armId === armId)
          .map(
            (run): ArmRun => ({
              launched: true,
              completed: run.completed,
              accepted: run.accepted,
              costUsd: run.costUsd,
              latencyMs: run.latencyMs,
            }),
          ),
      })),
    ),
    comparisons: comparePairs(input.arms, finished),
  };
}

/**
 * Paired, because every arm saw the same case at the same seed. Tasks both arms got right and
 * tasks both got wrong say nothing about which is better; only the disagreements do.
 */
function comparePairs(
  arms: readonly string[],
  runs: readonly (PlannedRun & ArmOutcome)[],
): readonly CampaignComparison[] {
  const comparisons: CampaignComparison[] = [];
  for (let first = 0; first < arms.length; first += 1) {
    for (let second = first + 1; second < arms.length; second += 1) {
      const baseline = arms[first] ?? "";
      const against = arms[second] ?? "";
      let onlyBaseline = 0;
      let onlyAgainst = 0;
      for (const pairId of new Set(runs.map((run) => run.pairId))) {
        const left = runs.find((run) => run.pairId === pairId && run.armId === baseline);
        const right = runs.find((run) => run.pairId === pairId && run.armId === against);
        if (left === undefined || right === undefined || left.accepted === right.accepted) {
          continue;
        }
        if (left.accepted) {
          onlyBaseline += 1;
        } else {
          onlyAgainst += 1;
        }
      }
      const judged: McNemarResult = mcNemar({ onlyFirst: onlyBaseline, onlySecond: onlyAgainst });
      comparisons.push({
        baseline,
        against,
        onlyBaseline,
        onlyAgainst,
        discordant: judged.discordant,
        significant: judged.significant,
        reason: judged.reason,
      });
    }
  }
  return comparisons;
}

/** A scratch workspace seeded from a case, which is what an arm is pointed at. */
export async function seedWorkspace(scratchRoot: string, one: CampaignCase): Promise<string> {
  const workspace = await mkdtemp(join(scratchRoot, `${one.id}-`));
  // The case's own command, declared where the gates look for it. Without it the tests gate has
  // nothing to run, no dynamic gate can pass, and the harness correctly reports the change as
  // not executed while the oracle runs the command directly and accepts it: every run then reads
  // as a false red, and what was being measured was a workspace the campaign had misconfigured.
  await writeFile(
    join(workspace, "package.json"),
    `${JSON.stringify(
      { name: one.id, version: "1.0.0", type: "module", scripts: { test: one.gateCommand } },
      null,
      2,
    )}\n`,
  );
  for (const [name, content] of Object.entries(one.seed)) {
    await writeIntoWorkspace(workspace, name, content);
  }
  return workspace;
}

/**
 * A case file can name a directory: four of the golden set's twenty do. Writing one without
 * creating its parent stops the whole campaign at the first such case, which is what happened
 * eighteen runs in.
 */
async function writeIntoWorkspace(workspace: string, name: string, content: string): Promise<void> {
  const path = join(workspace, name);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
