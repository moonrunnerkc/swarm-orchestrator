import { z } from "zod";

/**
 * The section 3.6 escape hatch, carried over from v12's re-specification refuter. Without
 * it, a legitimate test change gets rejected by the ratchet and the model is driven toward
 * a workaround instead of the honest edit.
 *
 * The discriminator is the submitted test run against the base source:
 *
 *   - tampering weakens a test that already passed, so it still passes on the base source;
 *   - a re-specification asserts behaviour the base source does not have, so it fails there.
 *
 * Two controls, both required, because one is not enough. A test that fails on base for an
 * infrastructure reason (no dependencies installed, a broken harness) would otherwise be
 * handed the exemption; requiring it to pass on the submitted source rules that out, since
 * an infrastructure failure fails on both sides.
 */

export type ControlOutcome = "passed" | "failed" | "indeterminate";

export interface ControlRun {
  readonly outcome: ControlOutcome;
  readonly detail: string;
  readonly exitCode: number | null;
}

export const indeterminate = (detail: string): ControlRun => ({
  outcome: "indeterminate",
  detail,
  exitCode: null,
});

/** Runs one test file two ways. Every failure to run cleanly reports indeterminate. */
export interface BaseControlRunner {
  /** The submitted test file, with every non-test change reverted to the base commit. */
  runOnBaseSource(testFile: string): Promise<ControlRun>;
  /** The same test file against the working tree as it stands. */
  runOnSubmittedSource(testFile: string): Promise<ControlRun>;
}

export const respecificationSchema = z.object({
  file: z.string(),
  exempt: z.boolean(),
  reason: z.string(),
  controls: z.object({
    submittedTestOnBaseSource: z.string(),
    submittedTestOnSubmittedSource: z.string(),
  }),
});

export type RespecificationPayload = z.infer<typeof respecificationSchema>;

export interface RespecificationFinding {
  readonly file: string;
  readonly exempt: boolean;
  readonly reason: string;
  readonly payload: RespecificationPayload;
}

/**
 * Abstains on every uncertainty, so it can only turn a rejection into an acceptance when
 * both controls came back clean and definite. Fail-closed is the right default here: a
 * wrongly granted exemption is a hole in the ratchet, and a wrongly withheld one costs an
 * attempt and an explanation.
 */
export async function assessRespecification(
  testFile: string,
  runner: BaseControlRunner,
): Promise<RespecificationFinding> {
  const onBase = await runner.runOnBaseSource(testFile);
  if (onBase.outcome !== "failed") {
    return finding(
      testFile,
      false,
      onBase.outcome === "passed"
        ? "the submitted test passes against the base source, so it specifies nothing the base " +
            "did not already satisfy. That is the shape of a weakened test, not a new specification."
        : `the base-source control did not run cleanly (${onBase.detail}), so no exemption is granted`,
      onBase,
      indeterminate("not run: the base-source control already settled the question"),
    );
  }

  const onSubmitted = await runner.runOnSubmittedSource(testFile);
  if (onSubmitted.outcome !== "passed") {
    return finding(
      testFile,
      false,
      onSubmitted.outcome === "failed"
        ? "the submitted test fails against the submitted source too, so its failure on base says " +
            "nothing about a new specification: it is failing for a reason unrelated to the change"
        : `the submitted-source control did not run cleanly (${onSubmitted.detail}), so no exemption is granted`,
      onBase,
      onSubmitted,
    );
  }

  return finding(
    testFile,
    true,
    "the submitted test fails on the base source and passes on the submitted source, so it " +
      "asserts behaviour the base did not have. That is a new specification, not tampering.",
    onBase,
    onSubmitted,
  );
}

/**
 * Only test files whose measures went the wrong way are worth a control run, since the
 * controls cost a test execution each and an exemption changes nothing for a file that did
 * not regress.
 */
export async function findExemptFiles(
  candidateFiles: readonly string[],
  runner: BaseControlRunner | null,
): Promise<readonly RespecificationFinding[]> {
  if (runner === null || candidateFiles.length === 0) {
    return [];
  }
  const findings: RespecificationFinding[] = [];
  for (const file of candidateFiles) {
    findings.push(await assessRespecification(file, runner));
  }
  return findings;
}

function finding(
  file: string,
  exempt: boolean,
  reason: string,
  onBase: ControlRun,
  onSubmitted: ControlRun,
): RespecificationFinding {
  const payload = respecificationSchema.parse({
    file,
    exempt,
    reason,
    controls: {
      submittedTestOnBaseSource: `${onBase.outcome}: ${onBase.detail}`,
      submittedTestOnSubmittedSource: `${onSubmitted.outcome}: ${onSubmitted.detail}`,
    },
  });
  return { file, exempt, reason, payload };
}
