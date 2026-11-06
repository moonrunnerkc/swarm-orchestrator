import { diffSections, movedFiles } from "./context.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import type { RegressionCheck, RequirementCheck, TurnChecks } from "./turn-checks.ts";

/** The tree measured by the harness after a change. */
export interface Measured {
  readonly checks: readonly RequirementCheck[];
  /** The tests the change reaches, or the whole suite where a completion was at stake; null where neither could run. */
  readonly regression: RegressionCheck | null;
  /** Every required requirement has an independent check, each passes, nothing newly fails. */
  readonly ready: boolean;
  /** No required requirement has an independent check: the model's completion is verified as asked. */
  readonly unchecked: boolean;
  /** What a turn must change for it to count as progress, apart from the tree. */
  readonly key: string;
}

const testFile = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.py|[^/]*\.(?:test|spec)\.[cm]?[jt]sx?)$/;

/** The test files a diff adds or changes, outside the harness's own `.swarm/`. */
export function testsTouched(diff: string): string[] {
  return [...diff.matchAll(/^\+\+\+ b\/(\S+)$/gm)]
    .map((match) => match[1] ?? "")
    .filter((path) => testFile.test(path) && !path.startsWith(".swarm/"));
}

/**
 * Each requirement's independent checks and the tests the files changed since the last measure
 * reach, after every change. The whole declared suite runs once, the first time everything else
 * passes: that is the first completion, and every verification after it runs the suite again.
 * Running the whole suite after every turn cost t6 and depose most of their wall time (17.0.0).
 */
export async function measureTree(
  checks: TurnChecks,
  record: RequirementRecord,
  diff = "",
  previous: string | null = null,
): Promise<Measured> {
  const results = (await checks.requirements(record)).map((one) => {
    const asked = record.requirements.find((r) => r.id === one.requirement)?.testsAsked === true;
    if (!asked || one.status !== "passing" || testsTouched(diff).length > 0) return one;
    const detail = `the task asks for tests, and the change adds none yet: add them\n${one.detail}`;
    return { ...one, status: "failing" as const, detail };
  });
  const checked = results.filter((one) => one.status !== "none");
  const passing = checked.length > 0 && checked.every((one) => one.status === "passing");
  const changed = movedFiles(diffSections(previous ?? ""), diffSections(diff));
  let regression = await checks.affected(changed);
  // The base's run is the first; the first completion's is the second, and the last here.
  if (passing && (regression?.newFailures.length ?? 0) === 0 && checks.suiteRuns() <= 1)
    regression = await checks.suite();
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
  // A passing case's line (✓) can carry these words in its title (claimcheck, rc.13: a control).
  const failing = rest.filter((line) => !/^\s*✓/.test(line));
  // The runner's summary line first; then any line naming an error or an expectation, as words.
  const named = (
    failing.find((line) => /^\s*(?:FAILED|FAIL) |^\s*[×✗] /.test(line)) ??
    failing.find((line) => /FAILED|FAIL |Error|assert|\bexpected\b|✗|×/.test(line))
  )?.trim();
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
      lines.push("- The whole declared suite runs once every requirement's checks pass.");
  } else {
    const ref = now.regression.evidence === null ? "" : ` [evidence ${now.regression.evidence}]`;
    const scope =
      now.regression.scope === "suite"
        ? "the whole declared suite"
        : "the tests your change reaches";
    lines.push(`- Regression, ${scope}${ref}:`, ...indent(now.regression.detail));
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

/** What the nudge before a no-progress stop says is still failing, in the check's own words. */
export function stillFailing(measured: Measured | null, focus: string | null): string {
  const failing = measured?.checks.find((one) => one.requirement === focus);
  return failing === undefined
    ? "Make the change the task asks for."
    : `${failing.requirement} still fails: ${failureLine(failing.detail)}.`;
}
