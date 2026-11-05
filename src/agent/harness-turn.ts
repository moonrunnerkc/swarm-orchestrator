import type { RequirementRecord } from "./requirement-record.ts";
import type { RegressionCheck, RequirementCheck, TurnChecks } from "./turn-checks.ts";

/** The tree measured by the harness after a change. */
export interface Measured {
  readonly checks: readonly RequirementCheck[];
  /** Null where the declared tests were not run because a requirement's checks still fail. */
  readonly regression: RegressionCheck | null;
  /** Every required requirement has an independent check, each passes, nothing newly fails. */
  readonly ready: boolean;
  /** No required requirement has an independent check: the model's completion is verified as asked. */
  readonly unchecked: boolean;
  /** What a turn must change for it to count as progress, apart from the tree. */
  readonly key: string;
}

/**
 * Each requirement's independent checks, then, only once they all pass, the declared tests
 * against the base: running the whole suite while the requirement still fails would say nothing
 * the next edit does not change, and the verifier reruns everything before any completion.
 */
const testFile = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.py|[^/]*\.(?:test|spec)\.[cm]?[jt]sx?)$/;

/** The test files a diff adds or changes, outside the harness's own `.swarm/`. */
export function testsTouched(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+ b\/(\S+)$/gm)]
    .map((match) => match[1] ?? "")
    .filter((path) => testFile.test(path) && !path.startsWith(".swarm/"));
}

export async function measureTree(
  checks: TurnChecks,
  record: RequirementRecord,
  diff = "",
): Promise<Measured> {
  const results = (await checks.requirements(record)).map((one) => {
    const asked = record.requirements.find((r) => r.id === one.requirement)?.testsAsked === true;
    if (!asked || one.status !== "passing" || testsTouched(diff).length > 0) return one;
    const detail = `${one.detail}\nthe task asks for tests, and the change adds none yet`;
    return { ...one, status: "failing" as const, detail };
  });
  const checked = results.filter((one) => one.status !== "none");
  const passing = checked.length > 0 && checked.every((one) => one.status === "passing");
  const regression = passing ? await checks.regression() : null;
  const ready =
    passing &&
    results.every((one) => one.status !== "none") &&
    (regression?.newFailures.length ?? 0) === 0;
  const key = JSON.stringify([
    results.map((one) => [one.requirement, one.status, one.detail]),
    regression?.newFailures ?? null,
  ]);
  return { checks: results, regression, ready, unchecked: checked.length === 0, key };
}

/** A check's failure in one line: its summary, with the first line of output that names what failed. */
export function failureLine(detail: string): string {
  const [first = "", ...rest] = detail.split("\n");
  if (!first.endsWith(":")) return first;
  const named = rest.find((line) => /FAILED|FAIL |Error|assert|expected|✗|×/.test(line))?.trim();
  return named === undefined ? first.slice(0, -1) : `${first} ${named.slice(0, 240)}`;
}

/** The first requirement whose checks fail, which the next turns are spent on. */
export function focusOf(measured: Measured | null): string | null {
  return measured?.checks.find((one) => one.status === "failing")?.requirement ?? null;
}

const statusOf = (measured: Measured | null, id: string) =>
  measured?.checks.find((one) => one.requirement === id)?.status ?? null;

/** What the model reads after a change: each requirement's checks, what moved, what newly fails. */
export function checksNote(now: Measured, before: Measured | null): string {
  const lines = ["Checks the harness ran on the tree after your last change:"];
  for (const one of now.checks) {
    if (one.status === "none") {
      lines.push(
        `- ${one.requirement}: no independent check; the verifier judges it when you mark the task complete`,
      );
      continue;
    }
    const was = statusOf(before, one.requirement);
    const moved = was === null || was === one.status ? "" : ` (was ${was})`;
    const ref = one.evidence === null ? "" : ` [evidence ${one.evidence}]`;
    lines.push(`- ${one.requirement}: ${one.status}${moved}${ref}`, ...indent(one.detail));
  }
  if (now.regression === null) {
    if (!now.unchecked)
      lines.push("- The declared tests run once every requirement's checks pass.");
  } else {
    const ref = now.regression.evidence === null ? "" : ` [evidence ${now.regression.evidence}]`;
    lines.push(`- Regression${ref}:`, ...indent(now.regression.detail));
  }
  lines.push(
    now.ready
      ? "Every check passes: the harness verifies the tree now."
      : "You do not need to run these yourself; they run again after your next change.",
  );
  return lines.join("\n");
}

const indent = (text: string) => text.split("\n").map((line) => `  ${line}`);

/**
 * A stop for want of progress or turns says which requirement was left failing and why, from
 * the harness's last measure, or that its check fails at the base where nothing changed it.
 */
export function withOpen(
  why: string | null,
  measured: Measured | null,
  record: RequirementRecord,
): string | null {
  const failing = measured?.checks.find((one) => one.status === "failing");
  if (failing !== undefined) {
    if (why?.includes(`${failing.requirement} still fails`)) return why;
    const line = failureLine(failing.detail);
    return `${why ?? "the turns ran out"}; ${failing.requirement} still fails: ${line}`;
  }
  if (measured?.unchecked === true)
    return `${why ?? "the turns ran out"}; R1 has no independent check here (see the report's independent checks), so nothing measured it`;
  if (measured === null && record.held !== undefined)
    return `${why ?? "the turns ran out"}; R1's independent check fails at the base, and the tree was never changed`;
  return why;
}
