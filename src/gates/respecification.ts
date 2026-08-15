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
 *
 * The verdict is per test, not per file. A file-level exemption dropped the whole file from
 * the comparison, so one genuine new specification cleared every deletion sitting beside it.
 * What a cleared test buys is one deleted test in its own file, and nothing else.
 */

export type ControlOutcome = "passed" | "failed" | "indeterminate";

export interface ControlRun {
  readonly outcome: ControlOutcome;
  readonly detail: string;
  readonly exitCode: number | null;
  /** Tests the run reported as failing, or null when its output named none it could read. */
  readonly failedTests: readonly string[] | null;
}

export const indeterminate = (detail: string): ControlRun => ({
  outcome: "indeterminate",
  detail,
  exitCode: null,
  failedTests: null,
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
  /** The tests this file proved are new specifications. Each pays for one deleted test. */
  newSpecifications: z.array(z.string()),
  controls: z.object({
    submittedTestOnBaseSource: z.string(),
    submittedTestOnSubmittedSource: z.string(),
  }),
});

type RespecificationPayload = z.infer<typeof respecificationSchema>;

export interface RespecificationFinding {
  readonly file: string;
  /** Whether the file's two controls came back clean. A precondition, never a licence. */
  readonly exempt: boolean;
  readonly reason: string;
  readonly newSpecifications: readonly string[];
  readonly payload: RespecificationPayload;
}

/**
 * A base-source failure that says nothing about behaviour. A test file that could not be
 * loaded at the base commit did not run there, so it did not fail there as a specification:
 * treating it as one hands the exemption to any submitted test that imports a symbol the
 * base does not export, which is every test written beside a new function.
 *
 * The module system decides how that arrives and must not decide the verdict. An ESM import of
 * a symbol the base does not export refuses the file with a SyntaxError; a require of the same
 * symbol binds it to undefined and the file fails at the first use with a TypeError; and a
 * type-checked runner never gets that far, refusing the file with a compile diagnostic instead
 * (TS2305 for a missing named export, TS2307 for a missing module, TS2339 for a missing member,
 * and the rest of the same family). Every one of them is the base not having the symbol yet, so
 * every one of them withholds the exemption rather than granting it. Whichever toolchain
 * reports the compile failure is the same story: nothing ran, so nothing failed as a spec.
 *
 * The syntax at the first use decides the wording the same way, and must not decide the verdict
 * either. A binding that is undefined because the base does not export it is called through as
 * a function or a constructor, read from as a property, taken apart by a destructure, or spread
 * as an iterable, and each of those is a differently worded TypeError about the same absence.
 * Matching only the first two granted the exemption to the other two.
 *
 * The reading is deliberately broad, because it only ever withholds. A test that fails for real
 * while printing something that looks like a compile diagnostic loses an exemption it might
 * have earned, which costs an attempt; the other direction costs a deletion nobody sees.
 */
const loadFailures: readonly RegExp[] = [
  /Cannot find module/i,
  /Cannot find package/i,
  /ERR_MODULE_NOT_FOUND/,
  /ERR_UNKNOWN_FILE_EXTENSION/,
  /ModuleNotFoundError/,
  /ImportError/,
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /Failed to (?:load|resolve) (?:url|import)/i,
  // Any TypeScript diagnostic: the compiler refused the file, so the runner never had one.
  /\berror TS\d+\b/,
  // The transpiling runners a TypeScript project reaches for, and the compilers of the two
  // other toolchains this harness knows how to run one test file under.
  /\b(?:Transform|Build) failed with \d+ error/i,
  /\[build failed\]/,
  /^\s*error\[E\d{4}\]/m,
  /\bno such file or directory\b/i,
  // The missing-binding family: one absence, named by whatever the test did with it first.
  /\bTypeError\b[^\n]*\bis not a function\b/,
  /\bTypeError\b[^\n]*\bis not a constructor\b/,
  // Both V8 wordings: the name sits inside the older one and after the newer one.
  /\bCannot read propert(?:y|ies)\b[^\n]*\bof (?:undefined|null)\b/i,
  /\bCannot destructure propert(?:y|ies)\b/i,
  /\b(?:undefined|null) is not iterable\b/i,
  /\bTypeError\b[^\n]*\bis not iterable\b/,
];

function failedToLoad(run: ControlRun): boolean {
  return loadFailures.some((pattern) => pattern.test(run.detail));
}

interface RespecificationOptions {
  /**
   * Tests present in the submitted file and absent at the base. Only these can be new
   * specifications; a test that already existed cannot be one, and the run's own failing
   * test would otherwise buy a deletion. Omitted means none, which grants nothing.
   */
  readonly newTests?: readonly string[];
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
  options: RespecificationOptions = {},
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
      [],
      onBase,
      indeterminate("not run: the base-source control already settled the question"),
    );
  }

  if (failedToLoad(onBase)) {
    return finding(
      testFile,
      false,
      "the submitted test did not run against the base source, it failed to load there. A file " +
        "that never executed did not fail as a specification, so no exemption is granted.",
      [],
      onBase,
      indeterminate("not run: the base-source control did not execute the file"),
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
      [],
      onBase,
      onSubmitted,
    );
  }

  // Per test from here. The file cleared its controls; which of its tests that buys anything
  // for is a separate question, and one the base run has to have named.
  const failedOnBase = onBase.failedTests;
  if (failedOnBase === null) {
    return finding(
      testFile,
      true,
      "the file's controls came back clean, but the base-source run named no failing test, so " +
        "no individual test is shown to be a new specification and none is exempt",
      [],
      onBase,
      onSubmitted,
    );
  }

  const failing = new Set(failedOnBase);
  const proven = (options.newTests ?? []).filter((name) => failing.has(name)).sort();

  return finding(
    testFile,
    true,
    proven.length === 0
      ? "the file's controls came back clean, but no test that is new in the submitted file " +
          "failed on the base source, so nothing here is a new specification"
      : `${proven.length} test(s) here are a new specification: each is new in this file, fails ` +
          "on the base source, and passes on the submitted source, so each asserts behaviour the " +
          "base did not have. Each pays for one deleted test in this file, and no more.",
    proven,
    onBase,
    onSubmitted,
  );
}

/** One file's tests that are candidates for the escape hatch. */
export interface RespecificationCandidate {
  readonly file: string;
  /** Tests present in the submitted file and absent at the base. */
  readonly newTests: readonly string[];
}

/**
 * Only test files whose measures went the wrong way are worth a control run, since the
 * controls cost a test execution each and an exemption changes nothing for a file that did
 * not regress.
 */
export async function findNewSpecifications(
  candidates: readonly RespecificationCandidate[],
  runner: BaseControlRunner | null,
): Promise<readonly RespecificationFinding[]> {
  if (runner === null || candidates.length === 0) {
    return [];
  }
  const findings: RespecificationFinding[] = [];
  for (const candidate of candidates) {
    findings.push(
      await assessRespecification(candidate.file, runner, { newTests: candidate.newTests }),
    );
  }
  return findings;
}

/** The tests every finding cleared, addressed the way the ratchet compares them. */
export function clearedTests(findings: readonly RespecificationFinding[]): ReadonlySet<string> {
  const cleared = new Set<string>();
  for (const found of findings) {
    for (const name of found.newSpecifications) {
      cleared.add(`${found.file}::${name}`);
    }
  }
  return cleared;
}

function finding(
  file: string,
  exempt: boolean,
  reason: string,
  newSpecifications: readonly string[],
  onBase: ControlRun,
  onSubmitted: ControlRun,
): RespecificationFinding {
  const payload = respecificationSchema.parse({
    file,
    exempt,
    reason,
    newSpecifications,
    controls: {
      submittedTestOnBaseSource: `${onBase.outcome}: ${onBase.detail}`,
      submittedTestOnSubmittedSource: `${onSubmitted.outcome}: ${onSubmitted.detail}`,
    },
  });
  return { file, exempt, reason, newSpecifications, payload };
}
