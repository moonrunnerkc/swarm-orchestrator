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
 * The lines an executed run did not reach, per file, read from a report the runner wrote.
 * Intersecting that with the lines this change added is the only honest way to say
 * "coverage of changed lines": it is measured from a run, and it is absent when no run
 * measured it.
 *
 * Two shapes, because a runner writes one or the other: lcov, which is what the harness asks
 * for since it carries coverage records and nothing else, and node's printed table, which is
 * what a project that configured its own reporter leaves behind. Neither is read from a
 * gate's stdout; see coverage-artifact.ts for why that distinction is the whole point.
 */
export function parseUncoveredLines(text: string): ReadonlyMap<string, ReadonlySet<number>> {
  return /^SF:/m.test(text) ? parseLcov(text) : parseCoverageTable(text);
}

/** `SF:` opens a file, `DA:<line>,<count>` reports one line, `end_of_record` closes it. */
function parseLcov(text: string): ReadonlyMap<string, ReadonlySet<number>> {
  const uncovered = new Map<string, Set<number>>();
  let file: string | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("SF:")) {
      file = line.slice(3).trim();
      if (file.length > 0 && !uncovered.has(file)) {
        uncovered.set(file, new Set<number>());
      }
      continue;
    }
    if (line === "end_of_record") {
      file = null;
      continue;
    }
    if (file === null || !line.startsWith("DA:")) {
      continue;
    }
    const reading = /^DA:(\d+),(\d+)/.exec(line);
    if (reading?.[1] === undefined || reading[2] === undefined) {
      continue;
    }
    if (Number(reading[2]) === 0) {
      uncovered.get(file)?.add(Number(reading[1]));
    }
  }

  return uncovered;
}

function parseCoverageTable(text: string): ReadonlyMap<string, ReadonlySet<number>> {
  const uncovered = new Map<string, Set<number>>();
  let inReport = false;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/^[#ℹ]\s?/, "").trimEnd();
    if (/^start of coverage report/.test(line)) {
      inReport = true;
      continue;
    }
    if (/^end of coverage report/.test(line)) {
      inReport = false;
      continue;
    }
    if (!inReport || !line.includes("|")) {
      continue;
    }
    const columns = line.split("|").map((column) => column.trim());
    const file = columns[0] ?? "";
    const ranges = columns[4] ?? "";
    if (file.length === 0 || file === "file" || file === "all files" || /^-+$/.test(file)) {
      continue;
    }
    const lines = uncovered.get(file) ?? new Set<number>();
    for (const range of ranges.split(/[\s,]+/).filter((part) => part.length > 0)) {
      const bounds = /^(\d+)(?:-(\d+))?$/.exec(range);
      if (bounds?.[1] === undefined) {
        continue;
      }
      const from = Number(bounds[1]);
      const to = bounds[2] === undefined ? from : Number(bounds[2]);
      for (let current = from; current <= to; current += 1) {
        lines.add(current);
      }
    }
    uncovered.set(file, lines);
  }

  return uncovered;
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

const tapResult = /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)\s*$/;
const specResult = /^\s*([✔✖])\s+(.+?)(?:\s+\(\d+(?:\.\d+)?ms\))?\s*$/;
const pytestResult = /^(FAILED|PASSED)\s+\S*?::([\w.]+)/;
const goResult = /^\s*---\s+(FAIL|PASS):\s+(\w+)/;

export function parseTestOutcomes(text: string): TestOutcomes | null {
  const passed: string[] = [];
  const failed: string[] = [];

  for (const raw of text.split("\n")) {
    for (const [pattern, failingMarker] of [
      [tapResult, "not ok"],
      [specResult, "✖"],
      [pytestResult, "FAILED"],
      [goResult, "FAIL"],
    ] as const) {
      const found = pattern.exec(raw);
      const name = found?.[2];
      if (found?.[1] === undefined || name === undefined) {
        continue;
      }
      // A TAP directive rides on the end of the name, and a skipped test is neither.
      const [subject, directive] = name.split(/\s+#\s+/, 2);
      if (directive !== undefined && /^(skip|todo)\b/i.test(directive)) {
        break;
      }
      (found[1] === failingMarker ? failed : passed).push(subject ?? name);
      break;
    }
  }

  return passed.length === 0 && failed.length === 0 ? null : { passed, failed };
}
