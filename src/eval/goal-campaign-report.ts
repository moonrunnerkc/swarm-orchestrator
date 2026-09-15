import type { CampaignOutcome } from "./campaign-record.ts";
import type { GoalCampaignProtocol } from "./goal-protocol.ts";
import { protocolSchedule } from "./protocol.ts";

const median = (values: readonly number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] ?? null)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
};
function knownSum(values: readonly (number | null | undefined)[]) {
  return values.length === 0 || values.some((value) => value === null || value === undefined)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}
const accepted = (row: CampaignOutcome | undefined) =>
  row?.certified === true && row.heldBackAccepted === true;
const incorrect = (row: CampaignOutcome) =>
  row.certified === true && row.heldBackAccepted === false;

/** Resample whole repositories, preserving all goals and correlated repeats inside each draw. */
function ratioInterval(
  clusters: readonly (readonly { baseline: number; candidate: number }[])[],
  seed: number,
) {
  const ratio = (pairs: readonly { baseline: number; candidate: number }[]) => {
    const base = median(pairs.map((pair) => pair.baseline));
    const candidate = median(pairs.map((pair) => pair.candidate));
    return base === null || base <= 0 || candidate === null ? null : candidate / base;
  };
  const point = ratio(clusters.flat());
  if (clusters.length < 2 || point === null)
    return { point, lower: null, upper: null, repositories: clusters.length };
  let state = seed >>> 0 || 1;
  const ratios: number[] = [];
  for (let iteration = 0; iteration < 2000; iteration++) {
    const sample = clusters.flatMap(() => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return clusters[(state >>> 0) % clusters.length] ?? [];
    });
    const observed = ratio(sample);
    if (observed !== null) ratios.push(observed);
  }
  ratios.sort((a, b) => a - b);
  return {
    point,
    lower: ratios[Math.floor(ratios.length * 0.025)] ?? null,
    upper: ratios[Math.floor(ratios.length * 0.975)] ?? null,
    repositories: clusters.length,
  };
}

export function goalCampaignReport(
  protocol: GoalCampaignProtocol,
  outcomes: ReadonlyMap<string, CampaignOutcome>,
) {
  const schedule = protocolSchedule(protocol);
  const rowsFor = (arm: string) =>
    schedule
      .filter((entry) => entry.armId === arm)
      .flatMap((entry) => {
        const observed = outcomes.get(entry.executionId);
        return observed === undefined ? [] : [observed];
      });
  const baseline = rowsFor(protocol.baseline);
  const allObserved = outcomes.size === schedule.length;
  return {
    unit: "distinct goals, clustered by repository; repeats are correlated",
    scheduledGoals: protocol.cases.length,
    repositories: new Set(protocol.cases.map((goal) => goal.repository)).size,
    scheduledRuns: schedule.length,
    settledRuns: outcomes.size,
    allObserved,
    arms: protocol.arms.map((arm) => {
      const rows = rowsFor(arm.id);
      return {
        id: arm.id,
        role: arm.role,
        scheduled: protocol.cases.length * protocol.seeds.length,
        observed: rows.length,
        complete: rows.filter(accepted).length,
        incorrectAcceptance: rows.filter(incorrect).length,
        missedOrUnknownJudgments: rows.filter(
          (row) => row.certified === null || row.heldBackAccepted === null,
        ).length,
        elapsedMs: knownSum(rows.map((row) => row.latencyMs)),
        costUsd: knownSum(rows.map((row) => row.costUsd)),
        inputTokens: knownSum(rows.map((row) => row.goal?.inputTokens)),
        outputTokens: knownSum(rows.map((row) => row.goal?.outputTokens)),
        unknownCalls: knownSum(rows.map((row) => row.goal?.unknownCalls)),
        retries: knownSum(rows.map((row) => row.goal?.retries)),
        integrationFailures: knownSum(rows.map((row) => row.goal?.integrationFailures)),
        integrationRepairs: knownSum(rows.map((row) => row.goal?.integrationRepairs)),
        humanInterventions: knownSum(rows.map((row) => row.goal?.humanInterventions)),
        humanRepairMinutes: knownSum(rows.map((row) => row.goal?.humanRepairMinutes)),
        incompleteBranches: rows
          .filter((row) => !accepted(row))
          .flatMap((row) => (row.goal?.partialBranch ? [row.goal.partialBranch] : [])),
      };
    }),
    comparisons: protocol.arms
      .filter((arm) => arm.id !== protocol.baseline)
      .map((arm) => {
        const rows = rowsFor(arm.id);
        const clusters = new Map<string, { baseline: number; candidate: number }[]>();
        let unobserved = 0;
        let censored = 0;
        for (const goal of protocol.cases.filter((goal) =>
          protocol.comparisonCases.includes(goal.id),
        )) {
          for (const seed of protocol.seeds) {
            const entries = schedule.filter(
              (entry) => entry.caseId === goal.id && entry.seed === seed,
            );
            const left = outcomes.get(
              entries.find((entry) => entry.armId === protocol.baseline)?.executionId ?? "",
            );
            const right = outcomes.get(
              entries.find((entry) => entry.armId === arm.id)?.executionId ?? "",
            );
            if (left === undefined || right === undefined) {
              unobserved++;
              continue;
            }
            if (!accepted(left) || !accepted(right)) censored++;
            const pairs = clusters.get(goal.repository) ?? [];
            pairs.push({
              baseline: accepted(left) ? left.latencyMs : protocol.budgets.wallMs,
              candidate: accepted(right) ? right.latencyMs : protocol.budgets.wallMs,
            });
            clusters.set(goal.repository, pairs);
          }
        }
        const interval =
          unobserved > 0 ? null : ratioInterval([...clusters.values()], protocol.resamplingSeed);
        return {
          armId: arm.id,
          unobservedPairs: unobserved,
          failureCensoredPairs: censored,
          latencyPolicy:
            "failed goals charged the fixed deadline; observed total wall time reported separately",
          medianTimeRatio: interval,
          pilotTargetObserved:
            allObserved &&
            interval?.point !== null &&
            interval?.point !== undefined &&
            interval.point <= protocol.targetMedianTimeRatio &&
            rows.filter(accepted).length >= baseline.filter(accepted).length &&
            rows.filter(incorrect).length <= baseline.filter(incorrect).length &&
            [...rows, ...baseline].every(
              (row) =>
                row.status === "completed" &&
                row.cleanup === "confirmed" &&
                row.certified !== null &&
                row.heldBackAccepted !== null &&
                row.goal?.unknownCalls === 0 &&
                row.goal.reservedTokens === 0 &&
                row.goal.inputTokens !== null &&
                row.goal.outputTokens !== null,
            ),
        };
      }),
    limitation:
      "Descriptive development threshold on this scheduled population, not a population non-inferiority guarantee or independent authorship claim.",
  };
}
