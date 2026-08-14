import { z } from "zod";
import type { GateStatus } from "../core/loop-events.ts";
import {
  comparableTotals,
  type MeasureSnapshot,
  respecificationAllowance,
} from "./measure-snapshot.ts";
import { type RespecificationFinding, respecificationSchema } from "./respecification.ts";

/**
 * Invariant 7. The ratchet compares numbers, not booleans, because a boolean gate can be
 * held green by deleting the tests that were failing, and that is precisely the patch a
 * capped retry loop under gate-output pressure is tuned to produce.
 */

type RatchetViolationKind =
  | "gate-regressed"
  | "tests-collected-decreased"
  | "tests-declared-decreased"
  | "assertions-decreased"
  | "changed-line-coverage-decreased"
  | "skip-markers-increased";

interface RatchetViolation {
  readonly kind: RatchetViolationKind;
  readonly before: number;
  readonly after: number;
  readonly detail: string;
}

/** A measure that could not be compared, and why. Recorded so a gap never reads as a pass. */
interface RatchetAbstention {
  readonly measure: string;
  readonly reason: string;
}

export interface RatchetDecision {
  readonly accepted: boolean;
  readonly violations: readonly RatchetViolation[];
  readonly abstentions: readonly RatchetAbstention[];
  readonly exemptFiles: readonly string[];
  readonly detail: string;
}

export interface RatchetInput {
  readonly baselineGates: Readonly<Record<string, GateStatus>>;
  readonly candidateGates: Readonly<Record<string, GateStatus>>;
  readonly baseline: MeasureSnapshot;
  readonly candidate: MeasureSnapshot;
  /**
   * Test files the escape hatch cleared as new specifications rather than tampering. They
   * drop out of the per-file comparisons on both sides.
   */
  readonly exemptFiles: ReadonlySet<string>;
}

/**
 * Which two states a decision compared. A retry is judged against the state before it; the
 * final workspace is judged against the base commit whether or not any retry ever ran, since
 * a first cycle that was already green would otherwise never be compared to anything.
 */
export type RatchetScope = "retry" | "base";

const ratchetDecisionSchema = z.object({
  scope: z.enum(["retry", "base"]),
  /** Zero for the base comparison, which belongs to no attempt. */
  attempt: z.number().int().nonnegative(),
  accepted: z.boolean(),
  detail: z.string(),
  violations: z.array(
    z.object({
      kind: z.string(),
      before: z.number(),
      after: z.number(),
      detail: z.string(),
    }),
  ),
  abstentions: z.array(z.object({ measure: z.string(), reason: z.string() })),
  exemptFiles: z.array(z.string()),
  /** Every escape-hatch assessment made this attempt, granted or not, with its controls. */
  respecification: z.array(respecificationSchema),
  measures: z.object({
    before: z.object({
      testsCollected: z.number().nullable(),
      testsDeclared: z.number(),
      assertions: z.number(),
      skipMarkers: z.number(),
      changedLineCoverage: z.number().nullable(),
    }),
    after: z.object({
      testsCollected: z.number().nullable(),
      testsDeclared: z.number(),
      assertions: z.number(),
      skipMarkers: z.number(),
      changedLineCoverage: z.number().nullable(),
    }),
  }),
  gates: z.object({
    before: z.record(z.string(), z.string()),
    after: z.record(z.string(), z.string()),
  }),
});

type RatchetDecisionPayload = z.infer<typeof ratchetDecisionSchema>;

/**
 * Judges one retry. Every check is a comparison between two measured numbers, and any
 * measure that is absent on either side is abstained on by name rather than assumed
 * unchanged.
 */
export function judgeRatchet(input: RatchetInput): RatchetDecision {
  const violations: RatchetViolation[] = [];
  const abstentions: RatchetAbstention[] = [];

  for (const [gateId, status] of Object.entries(input.baselineGates)) {
    if (status !== "passed") {
      continue;
    }
    const now = input.candidateGates[gateId];
    if (now === undefined) {
      abstentions.push({
        measure: `gate:${gateId}`,
        reason: "the gate did not run in this attempt, so its result could not be compared",
      });
      continue;
    }
    if (now !== "passed") {
      violations.push({
        kind: "gate-regressed",
        before: 1,
        after: 0,
        detail: `the ${gateId} gate passed before this attempt and now reports ${now}`,
      });
    }
  }

  const { before, after } = comparableTotals(input.baseline, input.candidate, input.exemptFiles);

  if (after.tests < before.tests) {
    violations.push({
      kind: "tests-declared-decreased",
      before: before.tests,
      after: after.tests,
      detail:
        `the touched test files declared ${before.tests} test(s) and now declare ${after.tests}. ` +
        "Removing a test is how a failing gate gets held green, so the retry is rejected.",
    });
  }

  const allowance = allowedAssertionDrop(input);
  if (after.assertions + allowance < before.assertions) {
    violations.push({
      kind: "assertions-decreased",
      before: before.assertions,
      after: after.assertions,
      detail:
        `assertions in the touched test files fell from ${before.assertions} to ${after.assertions}` +
        (allowance > 0
          ? `, and only ${allowance} of that drop is explained by a subject gaining an exact-match assertion`
          : ""),
    });
  }

  if (after.skips > before.skips) {
    violations.push({
      kind: "skip-markers-increased",
      before: before.skips,
      after: after.skips,
      detail:
        `skip markers in the touched test files rose from ${before.skips} to ${after.skips}. ` +
        "A skipped test is a test that stopped checking anything.",
    });
  }

  compareOptional(
    "testsCollected",
    input.baseline.testsCollected,
    input.candidate.testsCollected,
    input.exemptFiles.size > 0,
    violations,
    abstentions,
    {
      kind: "tests-collected-decreased",
      describe: (from, to) =>
        `the runner collected ${from} test(s) before this attempt and ${to} after it`,
      exemptReason:
        "an escape-hatch exemption was granted this attempt, and a suite-wide collected count " +
        "cannot be attributed to the exempt file, so it is not compared",
    },
  );

  compareOptional(
    "changedLineCoverage",
    input.baseline.changedLineCoverage,
    input.candidate.changedLineCoverage,
    false,
    violations,
    abstentions,
    {
      kind: "changed-line-coverage-decreased",
      describe: (from, to) =>
        `coverage of changed lines fell from ${percent(from)} to ${percent(to)}`,
      exemptReason: "",
    },
  );

  const accepted = violations.length === 0;
  return {
    accepted,
    violations,
    abstentions,
    exemptFiles: [...input.exemptFiles].sort(),
    detail: accepted
      ? "the ratchet accepted the attempt: no measure moved the wrong way" +
        // Named, not counted. An abstention that reads as a pass is the defect: a reviewer
        // has to be able to see which arm measured nothing without opening the payload.
        (abstentions.length > 0
          ? ` (not compared: ${abstentions.map((abstention) => abstention.measure).join(", ")})`
          : "")
      : `the ratchet rejected the attempt: ${violations.map((violation) => violation.detail).join("; ")}`,
  };
}

/**
 * How much of an assertion drop a re-specification explains. An exact-match matcher pins
 * its subject's value, so replacing several loose assertions on a subject with one exact
 * assertion is a strengthening; without this allowance the ratchet blocks that edit, which
 * is the false positive v12 measured on real feature work.
 */
function allowedAssertionDrop(input: RatchetInput): number {
  const paths = new Set([
    ...Object.keys(input.baseline.perTestFile),
    ...Object.keys(input.candidate.perTestFile),
  ]);

  let allowance = 0;
  for (const path of paths) {
    if (input.exemptFiles.has(path)) {
      continue;
    }
    allowance += respecificationAllowance(input.baseline, input.candidate, path);
  }
  return allowance;
}

interface OptionalComparison {
  readonly kind: RatchetViolationKind;
  readonly describe: (before: number, after: number) => string;
  readonly exemptReason: string;
}

function compareOptional(
  measure: string,
  before: number | null,
  after: number | null,
  suspendedByExemption: boolean,
  violations: RatchetViolation[],
  abstentions: RatchetAbstention[],
  comparison: OptionalComparison,
): void {
  if (suspendedByExemption && comparison.exemptReason.length > 0) {
    abstentions.push({ measure, reason: comparison.exemptReason });
    return;
  }
  if (before === null || after === null) {
    abstentions.push({
      measure,
      reason:
        before === null && after === null
          ? "nothing measured this on either side of the attempt"
          : "it was measured on only one side of the attempt, so there is nothing to compare",
    });
    return;
  }
  if (after < before) {
    violations.push({
      kind: comparison.kind,
      before,
      after,
      detail: comparison.describe(before, after),
    });
  }
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function ratchetPayload(
  scope: RatchetScope,
  attempt: number,
  input: RatchetInput,
  decision: RatchetDecision,
  respecification: readonly RespecificationFinding[],
): RatchetDecisionPayload {
  const { before, after } = comparableTotals(input.baseline, input.candidate, input.exemptFiles);

  return ratchetDecisionSchema.parse({
    scope,
    attempt,
    accepted: decision.accepted,
    detail: decision.detail,
    violations: decision.violations.map((violation) => ({ ...violation })),
    abstentions: decision.abstentions.map((abstention) => ({ ...abstention })),
    exemptFiles: decision.exemptFiles,
    respecification: respecification.map((finding) => finding.payload),
    measures: {
      before: {
        testsCollected: input.baseline.testsCollected,
        testsDeclared: before.tests,
        assertions: before.assertions,
        skipMarkers: before.skips,
        changedLineCoverage: input.baseline.changedLineCoverage,
      },
      after: {
        testsCollected: input.candidate.testsCollected,
        testsDeclared: after.tests,
        assertions: after.assertions,
        skipMarkers: after.skips,
        changedLineCoverage: input.candidate.changedLineCoverage,
      },
    },
    gates: { before: input.baselineGates, after: input.candidateGates },
  });
}
