import type { GateObservation } from "./gate-definition.ts";
import { runnerTestPoints, unreconciledRunnerPoints } from "./runner-results.ts";

/**
 * Whether a check that failed with the patch failed because of it.
 *
 * `inherited` is proven: every failure the patched run reports is a failure the base reports too,
 * counted (two failures under one identity are two), at the same identity and for the same cause,
 * in two runs that each collected completely. `new` is proven the other way: the base passed the
 * check, or the patched run reports more failures under some identity than the base does.
 * `unattributed` is everything else, and it is never read as inherited.
 *
 * Identity is what the runner can tell apart, not the title alone. Two node tests both called
 * `works` in two files collapsed to one TAP identity through 1.0.7, so a patch that broke the
 * second read as the first's inherited failure (SV-24). A node failure is named by the file,
 * line and column its TAP diagnostic gives, with its nesting depth and title; a Vitest test by
 * its file and full name; a pytest test by its node id. Where an identity still repeats among a
 * run's failures, or a run's totals contradict its points, was cancelled, truncated or cut short
 * of its plan, the failures cannot be matched one to one and nothing is inherited.
 */
export type FailureAttribution = "inherited" | "new" | "unattributed";

/**
 * The rule new records are attributed under; records without it were written under v1. v3 is v2
 * with temporary names set aside in causes and outputs (see `withoutTemporaryNames`).
 */
export const attributionRule = "failure-identity-v3";

export interface TestPoints {
  /** Failing identities, once per failure: a repeated identity is repeated here. */
  readonly failed: readonly string[];
  readonly passed: readonly string[];
  /** Why each failure failed, by identity, as the runner reported it with times set aside. */
  readonly causes: Readonly<Record<string, string>>;
  /** False where the run did not collect and report completely; no inheritance rests on it. */
  readonly complete: boolean;
}

/**
 * The tests a run names as failed and as passed, from a structured report, from node's TAP, or
 * from Vitest's text reporter. Null where the output names no tests it can be held to.
 */
export function testPoints(observation: GateObservation): TestPoints | null {
  if (observation.stdout.trimStart().startsWith("{")) {
    const points = runnerTestPoints(observation);
    if (points === null) return null;
    const failed = points.filter((point) => point.status === "failed" || point.status === "error");
    return {
      failed: failed.map((point) => point.identity),
      passed: points.filter((point) => point.status === "passed").map((point) => point.identity),
      causes: Object.fromEntries(
        failed.map((point) => [point.identity, normalizedCause(point.cause ?? "")]),
      ),
      complete: true,
    };
  }
  const text = `${observation.stdout}\n${observation.stderr}`;
  if (!/^TAP version \d+/m.test(text))
    return /^\u2716 failing tests:\s*$/m.test(text) || /^\u2139\s+tests\s+\d+\s*$/m.test(text)
      ? specPoints(text, observation.outputTruncated === true)
      : vitestTextFailures(text);
  return tapPoints(text, observation.outputTruncated === true);
}

interface TapPoint {
  readonly verdict: "ok" | "not ok";
  readonly depth: number;
  readonly title: string;
  readonly location: string | null;
  readonly type: string | null;
  readonly cause: string;
}

/** Every TAP point with the YAML diagnostic that follows it. */
function readTap(text: string): {
  readonly points: readonly TapPoint[];
  readonly lines: readonly string[];
} {
  const lines = text.split("\n");
  const points: TapPoint[] = [];
  for (let index = 0; index < lines.length; index++) {
    const point = /^(\s*)(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(lines[index] as string);
    if (point === null) continue;
    const [, indent = "", verdict, rest = ""] = point;
    if (/#\s*(TODO|SKIP)\b/i.test(rest)) continue;
    const yaml: string[] = [];
    if (/^\s*---\s*$/.test(lines[index + 1] ?? "")) {
      for (let inner = index + 2; inner < lines.length; inner++) {
        if (/^\s*\.\.\.\s*$/.test(lines[inner] as string)) break;
        yaml.push(lines[inner] as string);
      }
    }
    // A point's diagnostic keys sit two spaces inside the point; deeper lines are their values.
    const keyIndent = indent.length + 2;
    const keyOf = (line: string) =>
      line.length > keyIndent && line.slice(0, keyIndent).trim() === "" && line[keyIndent] !== " "
        ? (/^(\w+):\s*(.*)$/.exec(line.slice(keyIndent)) ?? null)
        : null;
    const field = (name: string) =>
      yaml.map((line) => keyOf(line)).find((key) => key?.[1] === name)?.[2] ?? null;
    const unquote = (value: string | null) =>
      value === null ? null : value.replace(/^'(.*)'$/, "$1");
    points.push({
      verdict: verdict === "ok" ? "ok" : "not ok",
      depth: indent.length,
      title: rest.replace(/\s+#.*$/, ""),
      location: unquote(field("location")),
      type: unquote(field("type")),
      cause: tapCause(yaml, keyIndent),
    });
  }
  return { points, lines };
}

/** The diagnostic fields that say why a node test failed; the stack and timings are left out. */
function tapCause(yaml: readonly string[], keyIndent: number): string {
  const kept: string[] = [];
  let inBlock: string | null = null;
  for (const line of yaml) {
    const key =
      line.slice(0, keyIndent).trim() === "" && line[keyIndent] !== " "
        ? /^(\w+):/.exec(line.slice(keyIndent))?.[1]
        : undefined;
    if (key !== undefined) inBlock = key;
    if (
      inBlock !== null &&
      ["failureType", "error", "code", "name", "expected", "actual", "operator"].includes(inBlock)
    )
      kept.push(line.trim());
  }
  return normalizedCause(kept.join("\n"));
}

/**
 * The directory every TAP location in the given texts shares, so a failure is named relative to
 * the checkout rather than by a path that carries the machine's session directory.
 */
export function sharedLocationRoot(texts: readonly string[]): string {
  const locations = texts.flatMap((text) =>
    [...text.matchAll(/^\s*location:\s*'([^']+)'\s*$/gm)].map((match) =>
      (match[1] ?? "").replace(/^file:\/\//, "").replace(/:\d+:\d+$/, ""),
    ),
  );
  if (locations.length === 0) return "";
  let shared = (locations[0] as string).split("/").slice(0, -1);
  for (const location of locations.slice(1)) {
    const parts = location.split("/").slice(0, -1);
    let length = 0;
    while (length < shared.length && shared[length] === parts[length]) length++;
    shared = shared.slice(0, length);
  }
  return shared.length === 0 ? "" : `${shared.join("/")}/`;
}

function tapPoints(
  text: string,
  truncated: boolean,
  root: string = sharedLocationRoot([text]),
): TestPoints {
  const { points } = readTap(text);
  const identity = (point: TapPoint) => {
    const location = point.location?.replace(/^file:\/\//, "") ?? null;
    const relative =
      location !== null && root.length > 0 && location.startsWith(root)
        ? location.slice(root.length)
        : location;
    return relative === null
      ? `${point.depth}:${point.title}`
      : `${relative} › ${point.depth}:${point.title}`;
  };
  const failed = points.filter((point) => point.verdict === "not ok");
  const counter = (name: string) => {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - name is one of the fixed counter names below.
    const found = new RegExp(`^[#ℹ]\\s+${name}\\s+(\\d+)\\s*$`, "m").exec(text)?.[1];
    return found === undefined ? null : Number(found);
  };
  const failCount = counter("fail");
  const leafFailures = failed.filter((point) => point.type !== "suite").length;
  const complete =
    !truncated &&
    /^1\.\.\d+\s*$/m.test(text) &&
    (counter("cancelled") ?? 0) === 0 &&
    (failCount === null || failCount === leafFailures);
  const causes: Record<string, string> = {};
  for (const point of failed) causes[identity(point)] = point.cause;
  return {
    failed: failed.map(identity),
    passed: points
      .filter((point) => point.verdict === "ok")
      .map((point) => `${point.depth}:${point.title}`),
    causes,
    complete,
  };
}

/**
 * Node's spec reporter, the default of `node --test` from Node 23 on and what a project's own
 * command prints wherever the harness does not run the runner itself. Its summary names each
 * failure by the location of its test, which tells same-titled tests apart as TAP's does; passes
 * are named by indentation and title. Complete where the counters are there, nothing was
 * cancelled, and the summary names as many failures as the counter counts.
 */
function specPoints(text: string, truncated: boolean): TestPoints {
  const lines = text.replace(colourCode, "").split("\n");
  const passed: string[] = [];
  const failed: string[] = [];
  const causes: Record<string, string> = {};
  const summary = lines.findIndex((line) => /^\u2716 failing tests:\s*$/.test(line));
  for (const [index, line] of lines.entries()) {
    if (summary !== -1 && index >= summary) break;
    const pass = /^(\s*)\u2714 (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(line);
    if (pass !== null) passed.push(`${pass[1]?.length ?? 0}:${pass[2]}`);
  }
  if (summary !== -1)
    for (let index = summary + 1; index < lines.length; index++) {
      const location = /^test at (.+:\d+:\d+)\s*$/.exec(lines[index] as string)?.[1];
      const title = /^\s*\u2716 (.+?) \(\d+(?:\.\d+)?ms\)\s*$/.exec(lines[index + 1] ?? "")?.[1];
      if (location === undefined || title === undefined) continue;
      const kept: string[] = [];
      for (let inner = index + 2; inner < lines.length; inner++) {
        const next = lines[inner] as string;
        if (/^test at /.test(next)) break;
        if (/^\s+at /.test(next) || next.trim().length === 0) continue;
        kept.push(next.trim());
      }
      const id = `${location} \u203a 0:${title}`;
      failed.push(id);
      causes[id] = normalizedCause(kept.join("\n"));
    }
  const counter = (name: string) => {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - name is one of the fixed counter names below.
    const found = new RegExp(`^\u2139\\s+${name}\\s+(\\d+)\\s*$`, "m").exec(text)?.[1];
    return found === undefined ? null : Number(found);
  };
  const failCount = counter("fail");
  return {
    failed,
    passed,
    causes,
    complete:
      !truncated &&
      failCount !== null &&
      failCount === failed.length &&
      (counter("cancelled") ?? 0) === 0,
  };
}

/**
 * Vitest's own reporters, when the project's script adds flags the structured runner does not
 * take (`vitest run --coverage --reporter=verbose`): every failed test and every file that failed
 * to load is printed as a `FAIL` line in the summary, once per failure. Only failures are named,
 * so this can prove an inheritance and a new failure, never a pass. Read only beside Vitest's own
 * `Test Files` summary line, and null where the summary counts failures but no `FAIL` line names
 * them.
 */
function vitestTextFailures(raw: string): TestPoints | null {
  const text = raw.replace(colourCode, "");
  const summary = /^\s*Test Files\s+(.+)$/m.exec(text)?.[1];
  if (summary === undefined) return null;
  const lines = text.split("\n");
  const failed: string[] = [];
  const causes: Record<string, string> = {};
  for (let index = 0; index < lines.length; index++) {
    const name = /^\s*FAIL\s+(\S.*?)\s*$/.exec(lines[index] as string)?.[1];
    if (name === undefined || name === "") continue;
    failed.push(name);
    const next = lines.slice(index + 1).find((line) => line.trim().length > 0) ?? "";
    causes[name] = /^\s*FAIL\s/.test(next) ? "" : normalizedCause(next);
  }
  if (failed.length === 0 && /\d+\s+failed/.test(summary)) return null;
  const counted = /(\d+)\s+failed/.exec(/^\s*Tests\s+(.+)$/m.exec(text)?.[1] ?? "")?.[1];
  return {
    failed,
    passed: [],
    causes,
    // Each failed test is printed once; a count that disagrees means some were not named.
    complete: counted === undefined || Number(counted) <= failed.length,
  };
}

/** Terminal colour sequences: escape, "[", parameters, a final letter. */
const colourCode = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** A failure's cause with colours, times, durations and temporary names set aside, bounded. */
function normalizedCause(text: string): string {
  return withoutTemporaryNames(
    text
      .replace(colourCode, "")
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, "<timestamp>")
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|secs|seconds)\b/g, "<duration>")
      .trim()
      .slice(0, 2000),
  );
}

/**
 * A directory a platform creates for temporary files, with the path below it: `/tmp`,
 * `/var/tmp`, `/dev/shm`, macOS's per-user `/var/folders/<a>/<b>/T` (and each under `/private`),
 * and Windows' `%LOCALAPPDATA%\Temp`. The same fixed list in the offline re-deriver, which runs on
 * some other machine: nothing here reads the machine's own temporary directory.
 */
const temporaryPath =
  /((?:\/private)?\/var\/folders\/[^/\s'"`]+\/[^/\s'"`]+\/T|(?:\/private)?\/tmp|\/var\/tmp|\/dev\/shm|[A-Za-z]:\\Users\\[^\\\s'"`]+\\AppData\\Local\\Temp)([/\\][^\s'"`]*)/g;

/**
 * A run of six or more name characters inside a directory of the path (a separator follows it
 * before the path ends), which is where a generated suffix sits: `mkdtemp` makes directories.
 */
const directoryRun = /[A-Za-z0-9_]{6,}(?=[^/\\\s'"`]*[/\\])/g;

/** A generated suffix holds a digit; a word a person named a directory by usually does not. */
function randomRun(run: string): string {
  return /\d/.test(run) ? "<random>" : run;
}

/**
 * Names a run chose at random, set aside. Two runs of one failure write under different temporary
 * directories (pre-commit's `repoc90ac5y6` against `reponyx5xidu`), and tracemantle's identical
 * inherited failures read as changed on that alone. Set aside: in a path under a temporary root,
 * the root itself and every run of six or more name characters holding a digit in one of the
 * path's directories; and the same shape directly after an elision marker, where a reporter cut a
 * long value (pytest prints `e...eponyx5xidu`) and the root the name sat under was cut with it.
 * Kept: a path outside a temporary root, a file's own name, a directory name without a digit, and
 * every other word of a message, so a failure that moved to another file or says something else
 * still reads as changed. The residual, named: two directories under a temporary root that differ
 * only in a digit-bearing name of six or more characters read as the same.
 */
export function withoutTemporaryNames(text: string): string {
  return text
    .replace(
      temporaryPath,
      (_whole, _root: string, rest: string) => `<tmp>${rest.replace(directoryRun, randomRun)}`,
    )
    .replace(/\.\.\.([A-Za-z0-9_]{6,})/g, (whole, run: string) =>
      /\d/.test(run) ? "...<random>" : whole,
    );
}

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
    .join("\n")
    .replace(/[^\n]+/g, (line) => withoutTemporaryNames(line));
}

function counts(ids: readonly string[]): Map<string, number> {
  const found = new Map<string, number>();
  for (const id of ids) found.set(id, (found.get(id) ?? 0) + 1);
  return found;
}

/** The two runs' points, named against one shared location root so their identities compare. */
function pairedPoints(
  withPatch: GateObservation,
  atBase: GateObservation,
): { readonly patched: TestPoints | null; readonly base: TestPoints | null } {
  const texts = [withPatch, atBase].map((one) => `${one.stdout}\n${one.stderr}`);
  if (texts.every((text) => /^TAP version \d+/m.test(text))) {
    const root = sharedLocationRoot(texts);
    return {
      patched: tapPoints(texts[0] as string, withPatch.outputTruncated === true, root),
      base: tapPoints(texts[1] as string, atBase.outputTruncated === true, root),
    };
  }
  return { patched: testPoints(withPatch), base: testPoints(atBase) };
}

function namedList(ids: readonly string[]): string {
  return `${ids.slice(0, 5).join("; ")}${ids.length > 5 ? `; and ${ids.length - 5} more` : ""}`;
}

/**
 * Why a failed check's failures could not be matched one to one with the base's, read from the
 * two runs' own output, so the advice names the obstacle rather than one fixed guess at it.
 */
export function unattributedReason(
  withPatch: GateObservation | undefined,
  atBase: GateObservation | undefined,
): string {
  if (withPatch === undefined || atBase === undefined)
    return "the base could not be put in place to run it";
  if (withPatch.outputTruncated === true || atBase.outputTruncated === true)
    return "a run's output was cut short, and nothing after the cut can be compared";
  const { patched, base } = pairedPoints(withPatch, atBase);
  if (patched === null && base === null)
    return "its output names no tests to compare and differs from the base's";
  if (patched === null)
    return "the base's run names its tests, and this run's output names none to hold them to";
  if (base === null)
    return `its output names the failing tests (${namedList(patched.failed)}), and the base's run names none it can be held to`;
  const after = counts(patched.failed);
  const before = counts(base.failed);
  const reasons: string[] = [];
  if ([...after, ...before].some(([, count]) => count > 1))
    reasons.push("a failing test's name repeats, so its failures cannot be told apart");
  const changed = [...after.keys()].filter((id) => patched.causes[id] !== base.causes[id]);
  if (changed.length > 0)
    reasons.push(
      `the same tests fail at the base, but for a different reason (${namedList(changed)})`,
    );
  if (!patched.complete || !base.complete)
    reasons.push("a run did not report completely (cut short, cancelled or short of its plan)");
  if (patched.failed.length === 0) reasons.push("it failed without naming a failing test");
  return reasons.length > 0
    ? reasons.join("; ")
    : "its failures could not be matched one to one with the base's";
}

/**
 * What a reader is told about a failed check beside its status: which tests failed and whether
 * the base control proved them inherited, new, or neither. A justified "no new regression" keeps
 * the failures it excused in view.
 */
export function describeAttribution(check: {
  readonly status: string;
  readonly observation?: GateObservation | undefined;
  readonly attribution?: FailureAttribution | undefined;
  readonly newFailures?: readonly string[] | undefined;
}): string {
  if (check.status !== "failed") return "";
  const failing =
    check.observation === undefined ? [] : (testPoints(check.observation)?.failed ?? []);
  const named = namedList;
  if (check.attribution === "inherited")
    return failing.length === 0
      ? "inherited: the base fails it the same way"
      : `inherited: the base fails the same tests the same way (${named(failing)})`;
  if (check.attribution === "unattributed")
    return `the base fails it too, but the failures cannot be matched one to one, so the regression is unmeasured${failing.length === 0 ? "" : ` (failing: ${named(failing)})`}`;
  if ((check.newFailures ?? []).length > 0)
    return `newly failing: ${named(check.newFailures ?? [])}`;
  return failing.length === 0 ? "" : `failing: ${named(failing)}`;
}

/** A failed check on the patched tree against the same check at the base. */
export function attributeFailure(input: {
  readonly withPatch: GateObservation;
  readonly baseStatus: string | undefined;
  readonly atBase: GateObservation | undefined;
}): { readonly attribution: FailureAttribution; readonly newFailures: readonly string[] } {
  if (input.baseStatus !== "failed" || input.atBase === undefined)
    return { attribution: "new", newFailures: [] };
  // A cut record proves nothing about what came after the cut.
  if (input.withPatch.outputTruncated === true || input.atBase.outputTruncated === true)
    return { attribution: "unattributed", newFailures: [] };
  const { patched, base } = pairedPoints(input.withPatch, input.atBase);
  if (patched !== null && base !== null && patched.failed.length > 0) {
    const before = counts(base.failed);
    const after = counts(patched.failed);
    const newFailures = [...after]
      .filter(([id, count]) => count > (before.get(id) ?? 0))
      .map(([id]) => id)
      .sort();
    if (newFailures.length > 0) return { attribution: "new", newFailures };
    const repeated = [...after, ...before].some(([, count]) => count > 1);
    const causeChanged = [...after.keys()].some((id) => patched.causes[id] !== base.causes[id]);
    return patched.complete && base.complete && !repeated && !causeChanged
      ? { attribution: "inherited", newFailures: [] }
      : { attribution: "unattributed", newFailures: [] };
  }
  if (patched !== null && base === null && patched.complete) {
    const newFailures = failuresTheBaseNamedPassing(patched, input.atBase);
    if (newFailures.length > 0) return { attribution: "new", newFailures };
  }
  if (patched !== null || base !== null) return { attribution: "unattributed", newFailures: [] };
  return normalizedOutput(input.withPatch) === normalizedOutput(input.atBase)
    ? { attribution: "inherited", newFailures: [] }
    : { attribution: "unattributed", newFailures: [] };
}

/**
 * The patched run's failures that the base's own report names as passed, where that report does
 * not reconcile. quantproof's base control ran its whole suite, named every test, failed none, and
 * exited 1 when a worker aborted on exit, leaving seven tests of another file pending; the two
 * tests the patch broke were named passing there, and the check read unmeasured. A test the base
 * ran and passed, that fails with the patch, is newly failing whatever else the base left undone.
 *
 * Only that, and conservatively. The base must name no failure at all, so its nonzero exit is not
 * a test failing; a run the harness killed or cancelled (exit 128) proves nothing; each failure
 * must be named passing exactly once. Nothing here reads as inherited: a crash can make a failure
 * new, never excuse one.
 */
function failuresTheBaseNamedPassing(patched: TestPoints, atBase: GateObservation): string[] {
  if (atBase.exitCode === 128 || !atBase.stdout.trimStart().startsWith("{")) return [];
  const points = unreconciledRunnerPoints(atBase);
  if (points === null || points.some((one) => one.status === "failed" || one.status === "error"))
    return [];
  const passed = counts(points.filter((one) => one.status === "passed").map((one) => one.identity));
  return [...new Set(patched.failed)].filter((id) => passed.get(id) === 1).sort();
}

/**
 * The status of a check the patch's runner configuration could have decided. The same check ran
 * a second time with the base's instrument restored; the instrument is the base's, as the command
 * already is. A reading that passes only under the patch's instrument is not a pass: it fails
 * where the base's instrument fails a test the base itself passed, and it measured nothing
 * otherwise (the failures are in tests the base does not have, which the new configuration may
 * legitimately be for).
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
  // A node failure is named by location; the base's passes are not, so a failure is matched to a
  // base pass by its depth and title, and only where that title passed once and never failed.
  const title = (id: string) => (id.includes(" › ") ? id.slice(id.indexOf(" › ") + 3) : id);
  const regressed =
    points === null || base === null
      ? []
      : points.failed.filter((id) => {
          const passes = base.passed.filter((one) => one === id || one === title(id)).length;
          return passes === 1 && !base.failed.some((one) => one === id || title(one) === title(id));
        });
  return {
    status:
      input.baseConfigurationStatus === "failed" && regressed.length > 0
        ? "failed"
        : "not-applicable",
    regressed,
  };
}
