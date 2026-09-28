import type { GateObservation } from "./gate-definition.ts";
import { runnerTestPoints } from "./runner-results.ts";

/**
 * Whether a check that failed with the patch failed because of it.
 *
 * `inherited` is proven: every test the patched run failed also failed at the base, or the two
 * runs printed the same thing once times and durations are set aside. `new` is proven the other
 * way: the base passed the check, or the patched run failed a test the base did not fail.
 * `unattributed` is everything else, and it is never read as inherited: a check that failed both
 * ways once passed the regression dimension whatever else the patch broke inside it, which is how
 * a newly broken test behind an old failing one read as a regression pass.
 */
export type FailureAttribution = "inherited" | "new" | "unattributed";

export interface TestPoints {
  readonly failed: readonly string[];
  readonly passed: readonly string[];
}

/**
 * The tests a run names as failed and as passed, from a structured report or from TAP. Null
 * where the output names no tests it can be held to (a plain reporter, a crash before the plan,
 * a truncated or malformed report). A TAP point is named by its nesting depth and its title,
 * so the same title at two depths stays two tests; TODO and SKIP directives are not failures.
 */
export function testPoints(observation: GateObservation): TestPoints | null {
  if (observation.stdout.trimStart().startsWith("{")) {
    const points = runnerTestPoints(observation);
    if (points === null) return null;
    return {
      failed: points
        .filter((point) => point.status === "failed" || point.status === "error")
        .map((point) => point.id),
      passed: points.filter((point) => point.status === "passed").map((point) => point.id),
    };
  }
  const text = `${observation.stdout}\n${observation.stderr}`;
  if (!/^TAP version \d+/m.test(text)) return vitestTextFailures(text);
  const failed: string[] = [];
  const passed: string[] = [];
  for (const match of text.matchAll(/^(\s*)(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/gm)) {
    const [, indent = "", verdict, rest = ""] = match;
    if (/#\s*(TODO|SKIP)\b/i.test(rest)) continue;
    const title = rest.replace(/\s+#.*$/, "");
    (verdict === "ok" ? passed : failed).push(`${indent.length}:${title}`);
  }
  return { failed, passed };
}

/**
 * Vitest's own reporters, when the project's script adds flags the structured runner does not
 * take (`vitest run --coverage --reporter=verbose`): every failed test and every file that failed
 * to load is printed as a `FAIL` line in the summary. Only failures are named, so this can prove
 * an inheritance and a new failure, never a pass. Read only beside Vitest's own `Test Files`
 * summary line, and null where the summary counts failures but no `FAIL` line names them.
 */
function vitestTextFailures(raw: string): TestPoints | null {
  const text = raw.replace(colourCode, "");
  const summary = /^\s*Test Files\s+(.+)$/m.exec(text)?.[1];
  if (summary === undefined) return null;
  const failed = [
    ...new Set(
      [...text.matchAll(/^\s*FAIL\s+(\S.*?)\s*$/gm)]
        .map((match) => match[1] ?? "")
        .filter((line) => line !== ""),
    ),
  ];
  if (failed.length === 0 && /\d+\s+failed/.test(summary)) return null;
  return { failed, passed: [] };
}

/** Terminal colour sequences: escape, "[", parameters, a final letter. */
const colourCode = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/**
 * What a run printed, with the parts that differ between two runs of the same failure set aside:
 * colour codes, clock times, timestamps and durations. Nothing else is normalized, so a new
 * diagnostic, a moved line number or a changed count keeps two outputs apart.
 */
export function normalizedOutput(observation: GateObservation): string {
  return `${observation.exitCode}\n${observation.stdout}\n${observation.stderr}`
    .replace(colourCode, "")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<timestamp>")
    .replace(/\b\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\b/g, "<clock>")
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds|m|min)\b/g, "<duration>")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n");
}

/** A failed check on the patched tree against the same check at the base. */
export function attributeFailure(input: {
  readonly withPatch: GateObservation;
  readonly baseStatus: string | undefined;
  readonly atBase: GateObservation | undefined;
}): { readonly attribution: FailureAttribution; readonly newFailures: readonly string[] } {
  if (input.baseStatus !== "failed" || input.atBase === undefined)
    return { attribution: "new", newFailures: [] };
  const patched = testPoints(input.withPatch);
  const base = testPoints(input.atBase);
  if (patched !== null && base !== null && patched.failed.length > 0) {
    const newFailures = patched.failed.filter((id) => !base.failed.includes(id));
    return newFailures.length === 0
      ? { attribution: "inherited", newFailures: [] }
      : { attribution: "new", newFailures };
  }
  return normalizedOutput(input.withPatch) === normalizedOutput(input.atBase)
    ? { attribution: "inherited", newFailures: [] }
    : { attribution: "unattributed", newFailures: [] };
}

/**
 * The status of a check the patch's runner configuration could have decided. The same check ran
 * a second time with the base's configuration files restored; the instrument is the base's, as
 * the command already is. A reading that passes only under the patch's configuration is not a
 * pass: it fails where the base's configuration fails a test the base itself passed, and it
 * measured nothing otherwise (the failures are in tests the base does not have, which the new
 * configuration may legitimately be for).
 */
export function underBaseConfiguration(input: {
  readonly withPatchStatus: string;
  readonly baseConfigurationStatus: string;
  readonly baseConfiguration: GateObservation;
  readonly atBase: GateObservation | undefined;
}): { readonly status: string; readonly regressed: readonly string[] } {
  if (input.withPatchStatus !== "passed" || input.baseConfigurationStatus === "passed")
    return { status: input.withPatchStatus, regressed: [] };
  const points = testPoints(input.baseConfiguration);
  const base = input.atBase === undefined ? null : testPoints(input.atBase);
  const regressed =
    points === null || base === null
      ? []
      : points.failed.filter((id) => base.passed.includes(id) && !base.failed.includes(id));
  return {
    status:
      input.baseConfigurationStatus === "failed" && regressed.length > 0
        ? "failed"
        : "not-applicable",
    regressed,
  };
}
