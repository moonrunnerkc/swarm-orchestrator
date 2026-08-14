import type { GateObservation, GateParser, GateReading } from "./gate-definition.ts";

/**
 * Parsers read the bytes a gate produced and nothing else. A measure that the output does
 * not contain is absent rather than zero, because a fabricated zero is worse than a gap:
 * the ratchet can decline to compare an absent measure, but it cannot un-believe a made-up
 * one.
 */

export const measureNames = {
  testsCollected: "testsCollected",
  testsPassed: "testsPassed",
  testsFailed: "testsFailed",
  testsSkipped: "testsSkipped",
  changedLineCoverage: "changedLineCoverage",
  changedLinesCovered: "changedLinesCovered",
  changedLinesMeasured: "changedLinesMeasured",
} as const;

const missingCommand = /command not found|:\s*not found|is not recognized as an internal/i;

/**
 * A gate whose tool is absent has proven nothing, and calling that a failure would send the
 * model off fixing code that is fine. It is reported as not-applicable, which never renders
 * green either.
 */
function notApplicable(observation: GateObservation): GateReading | null {
  if (observation.unavailable !== null) {
    return { status: "not-applicable", detail: observation.unavailable, measures: {} };
  }
  if (observation.exitCode === 127 || missingCommand.test(observation.stderr)) {
    return {
      status: "not-applicable",
      detail: "the command is not installed on this machine, so this gate measured nothing",
      measures: {},
    };
  }
  return null;
}

function combinedOutput(observation: GateObservation): string {
  return `${observation.stdout}\n${observation.stderr}`;
}

/** The default: the command's own exit code is the verdict, with no numbers claimed. */
export const exitCodeParser: GateParser = (observation) =>
  notApplicable(observation) ?? {
    status: observation.exitCode === 0 ? "passed" : "failed",
    detail:
      observation.exitCode === 0
        ? "the command exited 0"
        : `the command exited ${observation.exitCode}`,
    measures: {},
  };

/**
 * The counter block a TAP 13 producer prints at the end of a run. Node's own runner prints
 * the same counters under either of its reporters, marking them "#" under tap and "i" under
 * spec, so both are read here: a gate that only understood one of them would silently fall
 * back to the exit code and report no numbers for the ratchet to hold.
 */
const testCounterParser: GateParser = (observation) => {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) {
    return unavailable;
  }

  const text = combinedOutput(observation);
  const counters = readTestCounters(text);
  const measures: Record<string, number> = {};
  if (counters.tests !== null) {
    measures[measureNames.testsCollected] = counters.tests;
  }
  if (counters.pass !== null) {
    measures[measureNames.testsPassed] = counters.pass;
  }
  if (counters.fail !== null) {
    measures[measureNames.testsFailed] = counters.fail;
  }
  if (counters.skipped !== null) {
    measures[measureNames.testsSkipped] = counters.skipped;
  }

  const failed = observation.exitCode !== 0 || (counters.fail ?? 0) > 0;
  return {
    status: failed ? "failed" : "passed",
    detail: describeTestRun(counters, observation.exitCode),
    measures,
  };
};

/** Vitest's default reporter, whose summary line is the only stable thing in it. */
export const vitestTestParser: GateParser = (observation) => {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) {
    return unavailable;
  }

  const text = combinedOutput(observation);
  const summary = /^\s*Tests\s+(.+?)\s*$/m.exec(text)?.[1] ?? "";
  const total = /\((\d+)\)/.exec(summary)?.[1];
  const measures: Record<string, number> = {};
  if (total !== undefined) {
    measures[measureNames.testsCollected] = Number(total);
  }
  for (const [key, word] of [
    [measureNames.testsPassed, "passed"],
    [measureNames.testsFailed, "failed"],
    [measureNames.testsSkipped, "skipped"],
  ] as const) {
    const count = new RegExp(`(\\d+)\\s+${word}`).exec(summary)?.[1];
    if (count !== undefined) {
      measures[key] = Number(count);
    }
  }
  if (total !== undefined && measures[measureNames.testsFailed] === undefined) {
    measures[measureNames.testsFailed] = 0;
  }

  const failed = observation.exitCode !== 0 || (measures[measureNames.testsFailed] ?? 0) > 0;
  return {
    status: failed ? "failed" : "passed",
    detail:
      summary.length > 0
        ? `the runner reported: ${summary}`
        : `the runner exited ${observation.exitCode} and printed no summary line`,
    measures,
  };
};

/**
 * Tries the shapes a test command is likely to print, in order, and falls back to the exit
 * code with no numbers rather than guessing at a count.
 */
export const testOutputParser: GateParser = (observation) => {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) {
    return unavailable;
  }
  const text = combinedOutput(observation);
  if (/^TAP version \d+/m.test(text) || counterPattern("tests").test(text)) {
    return testCounterParser(observation);
  }
  if (/^\s*Tests\s+.*\(\d+\)/m.test(text)) {
    return vitestTestParser(observation);
  }
  return exitCodeParser(observation);
};

/**
 * The inspection gates print their own findings as JSON, so the same rule holds for them as
 * for a command: the recorded bytes decide the verdict, and re-reading them reproduces it.
 */
export const inspectionParser: GateParser = (observation) => {
  const unavailable = notApplicable(observation);
  if (unavailable !== null) {
    return unavailable;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.stdout);
  } catch {
    return {
      status: "failed",
      detail: "the inspection produced output that is not JSON, so its verdict cannot be read",
      measures: {},
    };
  }

  const fields = (parsed ?? {}) as { readonly [key: string]: unknown };
  const detail = typeof fields.detail === "string" ? fields.detail : "";
  const measures: Record<string, number> = {};
  if (typeof fields.measures === "object" && fields.measures !== null) {
    for (const [key, value] of Object.entries(fields.measures)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        measures[key] = value;
      }
    }
  }

  return {
    status: observation.exitCode === 0 ? "passed" : "failed",
    detail: detail.length > 0 ? detail : `the inspection exited ${observation.exitCode}`,
    measures,
  };
};

interface TestCounters {
  readonly tests: number | null;
  readonly pass: number | null;
  readonly fail: number | null;
  readonly skipped: number | null;
}

/** Both markers node uses for its end-of-run counters, plus plain TAP's. */
function counterPattern(name: string): RegExp {
  return new RegExp(`^[#\u2139]\\s+${name}\\s+(\\d+)\\s*$`, "m");
}

function readTestCounters(text: string): TestCounters {
  const counter = (name: string): number | null => {
    const found = counterPattern(name).exec(text)?.[1];
    return found === undefined ? null : Number(found);
  };
  const plan = /^\s*1\.\.(\d+)\s*$/m.exec(text)?.[1];
  return {
    tests: counter("tests") ?? (plan === undefined ? null : Number(plan)),
    pass: counter("pass"),
    fail: counter("fail"),
    skipped: counter("skipped"),
  };
}

function describeTestRun(counters: TestCounters, exitCode: number): string {
  if (counters.tests === null) {
    return `the runner exited ${exitCode} and printed no TAP counters`;
  }
  return (
    `${counters.tests} collected, ${counters.pass ?? 0} passed, ${counters.fail ?? 0} failed, ` +
    `${counters.skipped ?? 0} skipped (exit ${exitCode})`
  );
}

/**
 * The lines an executed run did not reach, per file, read from a report the runner wrote to a
 * path the harness named. Intersecting that with the lines this change added is the only
 * honest way to say "coverage of changed lines": it is measured from a run, and it is absent
 * when no run measured it.
 *
 * The artifact is a complete lcov report or it is nothing. There used to be a second shape
 * here, node's printed table, and carrying it made every artifact that is not lcov read like
 * one: a truncated file, a header-only file, and a table a test printed all reached the same
 * "the file is mentioned and nothing is missed" reading, which is a ratio of 1 for lines no
 * run measured. So the framing is checked before a single ratio is trusted, and an artifact
 * that fails the check yields nothing, exactly as a coverage-free project does. Not measured
 * is a verdict; 100% is a claim.
 */
export function parseUncoveredLines(text: string): ReadonlyMap<string, ReadonlySet<number>> {
  return parseCompleteLcov(text) ?? new Map();
}

/** The line kinds an lcov report is built from. Anything else in the file is not lcov. */
const lcovRecordLine = /^(?:TN|SF|VER|FN|FNDA|FNF|FNH|BRDA|BRF|BRH|DA|LF|LH):/;

/**
 * One `SF:` section under construction. `found` and `hit` are what the section declares about
 * itself in `LF:` and `LH:`; `measured` and `reached` are what its own `DA:` lines add up to.
 * A section whose declaration disagrees with its lines was cut short somewhere.
 */
interface LcovSection {
  readonly file: string;
  readonly uncovered: Set<number>;
  measured: number;
  reached: number;
  found: number | null;
  hit: number | null;
}

/**
 * `TN:` opens, `SF:` names the file, `DA:<line>,<count>` reports one line, `LF:`/`LH:` declare
 * the section's own totals, `end_of_record` closes it. Null for anything that is not all of
 * that: a section left open, a section with no `DA:` line, a section whose declared totals do
 * not match the lines beside them, a line no lcov producer writes, or a report with no
 * complete section in it. Null is what the caller renders as not measured.
 */
function parseCompleteLcov(text: string): ReadonlyMap<string, ReadonlySet<number>> | null {
  const uncovered = new Map<string, Set<number>>();
  let section: LcovSection | null = null;
  let complete = 0;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }

    if (line === "end_of_record") {
      if (section === null || !sectionIsComplete(section)) {
        return null;
      }
      const merged = uncovered.get(section.file) ?? new Set<number>();
      for (const missed of section.uncovered) {
        merged.add(missed);
      }
      uncovered.set(section.file, merged);
      complete += 1;
      section = null;
      continue;
    }

    if (!lcovRecordLine.test(line)) {
      return null;
    }
    if (line.startsWith("SF:")) {
      const file = line.slice(3).trim();
      if (section !== null || file.length === 0) {
        return null;
      }
      section = {
        file,
        uncovered: new Set<number>(),
        measured: 0,
        reached: 0,
        found: null,
        hit: null,
      };
      continue;
    }
    // The test name precedes the file it belongs to, so it is the one line that may sit
    // outside a section. Every other record line without one is a report cut in half.
    if (section === null) {
      if (line.startsWith("TN:")) {
        continue;
      }
      return null;
    }

    const counts = /^DA:(\d+),(\d+)/.exec(line);
    if (counts?.[1] !== undefined && counts[2] !== undefined) {
      section.measured += 1;
      if (Number(counts[2]) === 0) {
        section.uncovered.add(Number(counts[1]));
      } else {
        section.reached += 1;
      }
      continue;
    }
    const found = /^LF:(\d+)$/.exec(line)?.[1];
    if (found !== undefined) {
      section.found = Number(found);
      continue;
    }
    const hit = /^LH:(\d+)$/.exec(line)?.[1];
    if (hit !== undefined) {
      section.hit = Number(hit);
    }
  }

  return section === null && complete > 0 ? uncovered : null;
}

function sectionIsComplete(section: LcovSection): boolean {
  return (
    section.measured > 0 && section.found === section.measured && section.hit === section.reached
  );
}

/**
 * A coverage report names files however the runner saw them, so match on a path suffix
 * rather than demanding the two spellings agree.
 *
 * Every matching row counts, not the first one found. Stopping at an exact-path hit let an
 * empty row shadow a populated one under another spelling, and an empty row reads as "every
 * changed line was covered": the two spellings describe one file, so the honest reading of
 * them is the union of the lines they say were missed.
 */
export function matchCoverageFile(
  uncovered: ReadonlyMap<string, ReadonlySet<number>>,
  path: string,
): ReadonlySet<number> | null {
  const missed = new Set<number>();
  let reported = false;

  for (const [candidate, lines] of uncovered) {
    if (!namesSameFile(candidate, path)) {
      continue;
    }
    reported = true;
    for (const line of lines) {
      missed.add(line);
    }
  }

  return reported ? missed : null;
}

function namesSameFile(reported: string, path: string): boolean {
  const left = reported.replaceAll("\\", "/");
  const right = path.replaceAll("\\", "/");
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

/**
 * Which tests a run reported passing and failing, by name. The re-specification refuter needs
 * this to judge one test rather than a whole file, and null is the honest answer wherever a
 * runner's output names nothing: no attribution means no exemption, which is fail-closed.
 */
export interface TestOutcomes {
  readonly passed: readonly string[];
  readonly failed: readonly string[];
}

/**
 * TAP, read as the machine-readable format it is. This is what attribution should come from:
 * node folds a test's own stdout into `#` comment lines, so nothing a test prints can become a
 * result point, and the plan says how many points there were meant to be. A run whose
 * top-level points do not match its own plan is not read at all.
 *
 * Null wherever the text is not a TAP run or does not agree with itself. Names come from every
 * point, at any depth, because a suite reports its own subtests indented under it.
 */
export function parseTapOutcomes(text: string): TestOutcomes | null {
  if (!/^TAP version \d+/m.test(text)) {
    return null;
  }

  const passed: string[] = [];
  const failed: string[] = [];
  let plan: number | null = null;
  let topLevelPoints = 0;

  for (const raw of text.split("\n")) {
    // Whatever a test wrote arrives here, and it arrives commented out.
    if (/^\s*#/.test(raw)) {
      continue;
    }
    const planned = /^1\.\.(\d+)\s*$/.exec(raw);
    if (planned?.[1] !== undefined) {
      plan = Number(planned[1]);
      continue;
    }
    const point = /^(\s*)(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/.exec(raw);
    if (point?.[2] === undefined || point[3] === undefined) {
      continue;
    }
    if (point[1] === "") {
      topLevelPoints += 1;
    }
    recordOutcome(point[3], point[2] === "not ok", passed, failed);
  }

  if (plan === null || plan !== topLevelPoints) {
    return null;
  }
  return attributable(passed, failed);
}

/**
 * Node's spec reporter, which is what a project's own test script prints when the harness was
 * not able to ask for anything better. Every result line carries the duration node measured,
 * and that is required here rather than optional: a line without one was written by something
 * other than the reporter, which is how a test printing a fail marker for a sibling used to
 * hand itself that sibling's failure.
 *
 * Reading it at all is a fallback. A test can still print a well-formed result line for
 * another test, so the honest ranking is: the artifact first, this second, and a name reported
 * two ways attributed to neither.
 */
const specResult = /^\s*([✔✖])\s+(.+?)\s+\(\d+(?:\.\d+)?ms\)\s*$/;
const pytestResult = /^(FAILED|PASSED)\s+\S*?::([\w.]+)/;
const goResult = /^\s*---\s+(FAIL|PASS):\s+(\w+)/;

/**
 * One run, one reporter. Reading every format out of one text let a TAP line printed into a
 * spec run stand as a result beside the spec lines around it, so the format is decided once
 * from the run as a whole and only that format's lines are read.
 */
export function parseTestOutcomes(text: string): TestOutcomes | null {
  const asTap = parseTapOutcomes(text);
  if (asTap !== null || /^TAP version \d+/m.test(text)) {
    return asTap;
  }

  const passed: string[] = [];
  const failed: string[] = [];
  const [pattern, failingMarker] = reporterOf(text);

  for (const raw of text.split("\n")) {
    const found = pattern.exec(raw);
    const name = found?.[2];
    if (found?.[1] === undefined || name === undefined) {
      continue;
    }
    recordOutcome(name, found[1] === failingMarker, passed, failed);
  }

  return attributable(passed, failed);
}

function reporterOf(text: string): readonly [RegExp, string] {
  if (/^\s*[✔✖]\s/m.test(text)) {
    return [specResult, "✖"];
  }
  return /^\s*---\s+(?:FAIL|PASS):/m.test(text) ? [goResult, "FAIL"] : [pytestResult, "FAILED"];
}

function recordOutcome(name: string, isFailure: boolean, passed: string[], failed: string[]): void {
  // A TAP directive rides on the end of the name, and a skipped test is neither.
  const [subject, directive] = name.split(/\s+#\s+/, 2);
  if (directive !== undefined && /^(skip|todo)\b/i.test(directive)) {
    return;
  }
  (isFailure ? failed : passed).push(subject ?? name);
}

/**
 * What the run actually attributed. A name reported both ways is dropped from both: one run
 * cannot have a test that passed and failed, so the honest reading of the contradiction is
 * that nothing about that name was measured, and the exemption it might have bought is
 * withheld rather than guessed at.
 */
function attributable(passed: readonly string[], failed: readonly string[]): TestOutcomes | null {
  const contested = new Set(passed.filter((name) => failed.includes(name)));
  const kept = {
    passed: passed.filter((name) => !contested.has(name)),
    failed: failed.filter((name) => !contested.has(name)),
  };
  return kept.passed.length === 0 && kept.failed.length === 0 ? null : kept;
}
