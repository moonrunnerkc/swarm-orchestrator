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
  | "gate-part-regressed"
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
  /** Tests the escape hatch cleared, as `file::test`. Reported so an exemption is visible. */
  readonly newSpecifications: readonly string[];
  /** Claim parts that regressed and yielded, each with what it yielded to (see `partClaims`). */
  readonly yielded?: readonly RatchetAbstention[];
  readonly detail: string;
}

export interface RatchetInput {
  readonly baselineGates: Readonly<Record<string, GateStatus>>;
  readonly candidateGates: Readonly<Record<string, GateStatus>>;
  readonly baseline: MeasureSnapshot;
  readonly candidate: MeasureSnapshot;
  /**
   * Tests the escape hatch cleared as new specifications rather than tampering, as
   * `file::test`. Each one pays for exactly one deleted test in its own file; nothing here
   * drops a whole file from the comparison, which is how a deletion used to travel beside a
   * single new spec. Omitted means nothing was cleared, which is the stricter reading.
   */
  readonly newSpecifications?: ReadonlySet<string>;
  /**
   * Gates the harness could not run in the candidate cycle, by id, each with the reason: the
   * wall budget was spent or the run was cancelled before the command could start. A gate
   * that was not run has no result to compare, so it is abstained on by name. This is not
   * the same as a gate the candidate made unavailable (a test script it deleted from the
   * manifest), which stays a regression: there the project's declaration changed, here only
   * the harness's clock did. Omitted means every gate in the candidate ran.
   */
  readonly unmeasuredGates?: ReadonlyMap<string, string>;
  /**
   * The named parts of the gates that report them (`GateReading.parts`), by gate id, on each
   * side. A part that passed before is held as a gate is. Omitted compares no part.
   */
  readonly baselineParts?: Readonly<Record<string, Readonly<Record<string, GateStatus>>>>;
  readonly candidateParts?: Readonly<Record<string, Readonly<Record<string, GateStatus>>>>;
  /**
   * The parts, by gate id, that rest on nothing but the planner's claim of the change: a
   * generated relation whose base control did not hold. Such a part yields to an attempt that
   * turns a failing part outside the claims into a pass; otherwise it is held as any part is.
   * Omitted names no claim, which is the stricter reading.
   */
  readonly partClaims?: Readonly<Record<string, readonly string[]>>;
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
  newSpecifications: z.array(z.string()),
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
  /** Absent on decisions before parts were compared, and where no gate reported any. */
  parts: z
    .object({
      before: z.record(z.string(), z.record(z.string(), z.string())),
      after: z.record(z.string(), z.record(z.string(), z.string())),
      /** Absent where no gate named a claim part, as on every decision before claims existed. */
      claims: z.record(z.string(), z.array(z.string())).optional(),
    })
    .optional(),
  /** Absent where no claim part yielded. */
  yielded: z.array(z.object({ measure: z.string(), reason: z.string() })).optional(),
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
  const newSpecifications = input.newSpecifications ?? new Set<string>();

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
    const notRun = input.unmeasuredGates?.get(gateId);
    if (notRun !== undefined) {
      abstentions.push({
        measure: `gate:${gateId}`,
        reason: `the gate could not be run in this attempt (${notRun}), so its result could not be compared`,
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

  // A part that rests on nothing but the planner's claim of the change yields to an attempt that
  // turned a failing part outside the claims, one the base or a supplied check backs, into a
  // pass: a claim that passed first does not outrank behaviour the base showed. Without that, a
  // generated relation false in its own fixture kept a wrong first change over the repair that
  // restored a case the base gives. Where nothing outside the claims improved, it is held.
  const claimed = (gateId: string, part: string) =>
    input.partClaims?.[gateId]?.includes(part) === true;
  const restored = Object.entries(input.baselineParts ?? {}).flatMap(([gateId, parts]) =>
    Object.entries(parts)
      .filter(
        ([part, status]) =>
          status === "failed" &&
          !claimed(gateId, part) &&
          input.candidateParts?.[gateId]?.[part] === "passed",
      )
      .map(([part]) => `${gateId} (${part})`),
  );
  const yielded: RatchetAbstention[] = [];

  // Within a gate, each part that passed before is held as the gate is, whatever the gate's own
  // status was: a gate failing for one part before and after hides a part a retry broke.
  // Parts under a key that is no gate (the experimental review's probe readings) belong to no
  // gate that could have stood down, so they are compared whatever the gate statuses hold, as the
  // bundled verifier compares every part.
  for (const [gateId, parts] of Object.entries(input.baselineParts ?? {})) {
    const isGate = gateId in input.baselineGates || gateId in input.candidateGates;
    const notRun =
      input.unmeasuredGates?.get(gateId) ??
      (isGate && input.candidateGates[gateId] === undefined
        ? "the gate did not run in this attempt"
        : null);
    for (const [part, status] of Object.entries(parts)) {
      if (status !== "passed") continue;
      const now = input.candidateParts?.[gateId]?.[part];
      if (notRun !== null || now === undefined) {
        abstentions.push({
          measure: `gate:${gateId}:${part}`,
          reason:
            notRun ??
            "the gate did not report this part in this attempt, so it could not be compared",
        });
        continue;
      }
      if (now !== "passed" && claimed(gateId, part) && restored.length > 0) {
        yielded.push({
          measure: `gate:${gateId}:${part}`,
          reason: `${part} in the ${gateId} gate rests on the planner's claim of the change and yields to ${restored.join(", ")}, which this attempt turned from failed to passed`,
        });
        continue;
      }
      if (now !== "passed")
        violations.push({
          kind: "gate-part-regressed",
          before: 1,
          after: 0,
          detail: `${part} in the ${gateId} ${isGate ? "gate" : "readings"} passed before this attempt and now reports ${now}`,
        });
    }
  }

  const { before, after } = comparableTotals(input.baseline, input.candidate, newSpecifications);

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
    newSpecifications.size > 0,
    violations,
    abstentions,
    {
      kind: "tests-collected-decreased",
      describe: (from, to) =>
        `the runner collected ${from} test(s) before this attempt and ${to} after it`,
      exemptReason:
        "a new specification was cleared this attempt, and a suite-wide collected count " +
        "cannot be attributed to one test, so it is not compared",
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
      unmeasuredReason:
        input.candidate.changedLineCoverageUnmeasured ??
        input.baseline.changedLineCoverageUnmeasured,
    },
  );

  const accepted = violations.length === 0;
  return {
    accepted,
    violations,
    abstentions,
    newSpecifications: [...newSpecifications].sort(),
    yielded,
    detail: accepted
      ? "the ratchet accepted the attempt: no measure moved the wrong way" +
        // Named, not counted. An abstention that reads as a pass is the defect: a reviewer
        // has to be able to see which arm measured nothing without opening the payload.
        (abstentions.length > 0
          ? ` (not compared: ${abstentions.map((abstention) => abstention.measure).join(", ")})`
          : "") +
        (yielded.length > 0 ? `; ${yielded.map((one) => one.reason).join("; ")}` : "")
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
    allowance += respecificationAllowance(input.baseline, input.candidate, path);
  }
  return allowance;
}

interface OptionalComparison {
  readonly kind: RatchetViolationKind;
  readonly describe: (before: number, after: number) => string;
  readonly exemptReason: string;
  /** Why nothing measured this, where a gate said so; null where nothing said anything. */
  readonly unmeasuredReason?: string | null;
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
    const neither = "nothing measured this on either side of the attempt";
    abstentions.push({
      measure,
      reason:
        before === null && after === null
          ? comparison.unmeasuredReason == null
            ? neither
            : `${neither}: ${comparison.unmeasuredReason}`
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
  const { before, after } = comparableTotals(
    input.baseline,
    input.candidate,
    input.newSpecifications ?? new Set<string>(),
  );

  return ratchetDecisionSchema.parse({
    scope,
    attempt,
    accepted: decision.accepted,
    detail: decision.detail,
    violations: decision.violations.map((violation) => ({ ...violation })),
    abstentions: decision.abstentions.map((abstention) => ({ ...abstention })),
    newSpecifications: decision.newSpecifications,
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
    ...(input.baselineParts === undefined && input.candidateParts === undefined
      ? {}
      : {
          parts: {
            before: input.baselineParts ?? {},
            after: input.candidateParts ?? {},
            ...(Object.keys(input.partClaims ?? {}).length === 0
              ? {}
              : { claims: input.partClaims }),
          },
        }),
    ...((decision.yielded ?? []).length === 0 ? {} : { yielded: decision.yielded }),
  });
}
