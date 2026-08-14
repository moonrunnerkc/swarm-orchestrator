import { comparableTotals, type MeasureSnapshot } from "./measure-snapshot.ts";
import type { RatchetDecision } from "./ratchet.ts";

/**
 * What a finished auto-resolve did to the numbers, flattened for the routing log. Section 3.8
 * needs the ratchet to ride along in every reward record: without it the reward is gate pass
 * rate, and gate pass rate rewards whichever model is best at weakening tests.
 */
export interface RatchetSummary {
  readonly settled: "green" | "escalated";
  readonly attempts: number;
  readonly rejected: number;
  /**
   * Rejections that traded a measured number the wrong way. An attempt that simply failed to
   * run is also rejected, and is not this: only erosion is the pattern the reward punishes.
   */
  readonly erosions: number;
  readonly testsCollected: number | null;
  readonly testsDeclared: number;
  readonly assertions: number;
  readonly skipMarkers: number;
  readonly changedLineCoverage: number | null;
}

/** Structurally satisfied by an AutoResolveOutcome, and by far less in a test. */
export interface RatchetSummaryInput {
  readonly settled: "green" | "escalated";
  readonly attempts: readonly { readonly decision: RatchetDecision }[];
  readonly finalMeasures: MeasureSnapshot;
}

const noExemptions: ReadonlySet<string> = new Set();

export function summarizeRatchet(input: RatchetSummaryInput): RatchetSummary {
  const rejected = input.attempts.filter((attempt) => !attempt.decision.accepted);
  const totals = comparableTotals(input.finalMeasures, input.finalMeasures, noExemptions).after;

  return {
    settled: input.settled,
    attempts: input.attempts.length,
    rejected: rejected.length,
    erosions: rejected.filter((attempt) => attempt.decision.violations.length > 0).length,
    testsCollected: input.finalMeasures.testsCollected,
    testsDeclared: totals.tests,
    assertions: totals.assertions,
    skipMarkers: totals.skips,
    changedLineCoverage: input.finalMeasures.changedLineCoverage,
  };
}
