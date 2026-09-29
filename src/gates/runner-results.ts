import { z } from "zod";
import type { GateObservation, GateReading } from "./gate-definition.ts";

const point = z.object({
  id: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped", "error"]),
  /** Why it failed, as the runner reported it; absent on records written before it was kept. */
  message: z.string().max(100000).optional(),
});
const python = z.object({
  schema: z.literal("swarm.pytest.v1"),
  tests: z.array(point).max(100000),
});
const vitest = z.object({
  numTotalTests: z.number().int().nonnegative(),
  numPassedTests: z.number().int().nonnegative(),
  numFailedTests: z.number().int().nonnegative(),
  numPendingTests: z.number().int().nonnegative(),
  testResults: z.array(
    z.object({
      name: z.string(),
      assertionResults: z.array(
        z.object({
          fullName: z.string(),
          status: z.enum(["passed", "failed", "pending", "skipped", "todo"]),
          failureMessages: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
});

export interface RunnerPoint {
  /** Unique within the report: a title repeated in one file is named by its occurrence. */
  readonly id: string;
  readonly status: "passed" | "failed" | "skipped" | "error";
  /** The identity without the occurrence, which repeats where the titles do. */
  readonly identity: string;
  readonly cause?: string;
}

/**
 * The per-test outcomes a structured report names, or null where the observation is not a
 * complete, self-consistent report. Read by the verdict and by failure attribution alike, so the
 * two cannot disagree about which tests a report says failed.
 */
export function runnerTestPoints(observation: GateObservation): readonly RunnerPoint[] | null {
  if (
    observation.unavailable !== null ||
    observation.outputTruncated ||
    observation.stdout.length > 4_000_000
  )
    return null;
  try {
    return pointsOf(JSON.parse(observation.stdout));
  } catch {
    return null;
  }
}

/** Throws on anything but a complete report whose totals agree with its points. */
function pointsOf(value: unknown): RunnerPoint[] {
  const parsedPython = python.safeParse(value);
  let tests: RunnerPoint[];
  if (parsedPython.success)
    tests = parsedPython.data.tests.map((test) => ({
      id: test.id,
      status: test.status,
      identity: test.id,
      ...(test.message === undefined ? {} : { cause: test.message }),
    }));
  else {
    const report = vitest.parse(value);
    tests = report.testResults.flatMap((file) => {
      const seen = new Map<string, number>();
      return file.assertionResults.map((test) => {
        const count = (seen.get(test.fullName) ?? 0) + 1;
        seen.set(test.fullName, count);
        return {
          id: `${file.name}:${test.fullName}${count === 1 ? "" : `#${count}`}`,
          identity: `${file.name}:${test.fullName}`,
          ...(test.failureMessages === undefined || test.failureMessages.length === 0
            ? {}
            : { cause: test.failureMessages.join("\n") }),
          status:
            test.status === "passed"
              ? ("passed" as const)
              : test.status === "failed"
                ? ("failed" as const)
                : ("skipped" as const),
        };
      });
    });
    if (
      report.numTotalTests !== tests.length ||
      report.numPassedTests !== tests.filter((test) => test.status === "passed").length ||
      report.numFailedTests !== tests.filter((test) => test.status === "failed").length ||
      report.numPendingTests !== tests.filter((test) => test.status === "skipped").length
    )
      throw new Error("inconsistent totals");
  }
  if (new Set(tests.map((test) => test.id)).size !== tests.length)
    throw new Error("duplicate test identity");
  return tests;
}

/** Runner-reported outcomes, explicitly not authoritative ratchet counts or coverage. */
export function readRunnerResult(observation: GateObservation): GateReading {
  if (
    observation.unavailable !== null ||
    observation.outputTruncated ||
    observation.stdout.length > 4_000_000
  )
    return {
      status: "not-applicable",
      detail: observation.unavailable ?? "structured runner output incomplete",
      measures: {},
    };
  try {
    const value: unknown = JSON.parse(observation.stdout);
    // The runner script's own word that nothing ran (pytest absent, no report written): a
    // check that measured nothing, with the reason, never "malformed" and never a pass.
    const unavailable = z
      .object({ unavailable: z.string().min(1) })
      .strict()
      .safeParse(value);
    if (unavailable.success)
      return { status: "not-applicable", detail: unavailable.data.unavailable, measures: {} };
    const tests = pointsOf(value);
    const executed = tests.filter((test) => test.status !== "skipped");
    const failed = observation.exitCode !== 0 || executed.some((test) => test.status !== "passed");
    return {
      status:
        tests.length === 0 || executed.length === 0
          ? "not-applicable"
          : failed
            ? "failed"
            : "passed",
      // What this reading is and is not: the runner's own counts, with the outcome. Whether the
      // changed lines were executed, and whether a failure is the patch's or the base's, are
      // measured elsewhere in the run and reported there; a reader met the old wording
      // ("ratchet counts", "base-control attribution") without knowing what it meant.
      detail: `${tests.length} runner-reported tests, ${executed.length} executed; outcome ${failed ? "failed" : "passed"}. Counts are the runner's own; whether the changed lines ran, and whether a failure is inherited from the base, are reported apart where measured.`,
      measures: {},
    };
  } catch {
    return {
      status: observation.exitCode === 0 ? "not-applicable" : "failed",
      detail: "malformed, duplicate, or inconsistent structured runner output",
      measures: {},
    };
  }
}
