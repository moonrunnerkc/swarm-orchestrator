import { z } from "zod";
import type { GateObservation, GateReading } from "./gate-definition.ts";

const point = z.object({
  id: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped", "error"]),
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
        }),
      ),
    }),
  ),
});

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
    const parsedPython = python.safeParse(value);
    let tests: z.infer<typeof point>[];
    if (parsedPython.success) tests = parsedPython.data.tests;
    else {
      const report = vitest.parse(value);
      tests = report.testResults.flatMap((file) =>
        file.assertionResults.map((test) => ({
          id: `${file.name}:${test.fullName}`,
          status:
            test.status === "passed"
              ? ("passed" as const)
              : test.status === "failed"
                ? ("failed" as const)
                : ("skipped" as const),
        })),
      );
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
    const executed = tests.filter((test) => test.status !== "skipped");
    const failed = observation.exitCode !== 0 || executed.some((test) => test.status !== "passed");
    return {
      status:
        tests.length === 0 || executed.length === 0
          ? "not-applicable"
          : failed
            ? "failed"
            : "passed",
      detail: `${tests.length} runner-reported tests, ${executed.length} executed; outcome ${failed ? "failed" : "passed"}. Ratchet counts, changed-line coverage and base-control attribution unmeasured for this report.`,
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
