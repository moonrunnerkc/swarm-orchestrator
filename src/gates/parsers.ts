import { normalize, resolve } from "node:path";
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
 * The lines an executed run reached, per file and per line, read from a report the runner wrote
 * to a path the harness named. Intersecting that with the lines this change added is the only
 * honest way to say "coverage of changed lines": it is measured from a run, and it is absent
 * when no run measured it.
 *
 * Hits per line rather than a set of misses, because the two differ on the lines a report never
 * mentions. Reading misses made an omission read as coverage: a section that listed two hit
 * lines of a nine-line file and declared totals agreeing with those two lines was complete by
 * every structural check and reported nothing missed, so all nine changed lines read as
 * covered. A line the report does not name was not measured by that run, and the honest
 * reading of an unmeasured line is uncovered, not covered.
 *
 * The artifact is a complete lcov report or it is nothing. There used to be a second shape
 * here, node's printed table, and carrying it made every artifact that is not lcov read like
 * one: a truncated file, a header-only file, and a table a test printed all reached the same
 * "the file is mentioned and nothing is missed" reading, which is a ratio of 1 for lines no
 * run measured. So the framing is checked before a single ratio is trusted, and an artifact
 * that fails the check yields nothing, exactly as a coverage-free project does. Not measured
 * is a verdict; 100% is a claim.
 *
 * Sections come back as the list they were written as, one entry per `SF:`, and are never
 * folded together by file. Folding them was the last way a claim got in: two complete sections
 * for one file, one naming line 1 and the other naming lines 2 through 9, unioned their line
 * numbers and read as nine lines measured and nine reached. A section is what one run measured
 * of one file, so which section a line's count comes from is part of what makes it a
 * measurement, and a file that two sections describe is resolved by abstaining rather than by
 * addition.
 */
export interface LcovFileSection {
  readonly file: string;
  readonly hits: ReadonlyMap<number, number>;
}

export function parseLineHits(text: string): readonly LcovFileSection[] {
  return parseCompleteLcov(text) ?? [];
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
  readonly hits: Map<number, number>;
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
function parseCompleteLcov(text: string): readonly LcovFileSection[] | null {
  const sections: LcovFileSection[] = [];
  let section: LcovSection | null = null;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) {
      continue;
    }

    if (line === "end_of_record") {
      if (section === null || !sectionIsComplete(section)) {
        return null;
      }
      sections.push({ file: section.file, hits: section.hits });
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
        hits: new Map<number, number>(),
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
      const count = Number(counts[2]);
      section.measured += 1;
      section.hits.set(Number(counts[1]), count);
      if (count > 0) {
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

  return section === null && sections.length > 0 ? sections : null;
}

function sectionIsComplete(section: LcovSection): boolean {
  return (
    section.measured > 0 && section.found === section.measured && section.hit === section.reached
  );
}

/**
 * What one section says about one file, per line, or null where the sections do not settle it.
 * Null is not zero coverage: it is a file these runs did not measure, which the caller leaves
 * out of the ratio rather than counting as missed.
 *
 * The match is on the resolved path and nothing looser. A suffix match was a hole with two
 * framings in one pass: a complete, fully-hit section for `vendor/clamp.mjs` read as coverage
 * of the changed `clamp.mjs`, and so did one for `/opt/other/clamp.mjs`. A report names files
 * however the runner saw them, which is what the workspace root is for: a relative name
 * resolves against it, an absolute one is already resolved, and two spellings of one file
 * resolve to one path. Two files that merely end alike do not, whatever their basenames say.
 *
 * One section is authoritative for one file, and more than one is nothing. Node's runner
 * writes a file's coverage once, so a second section for it is either two runs disagreeing or
 * an artifact somebody assembled, and the two are not distinguishable from here. Combining
 * them was tried both ways and both ways read a claim as a measurement: taking every section
 * unioned their line numbers, so one section measuring line 1 and another naming lines 2
 * through 9 read as nine measured and nine reached, and taking the first let a section with
 * nothing to say shadow one that had misses to report. Abstaining is stricter than either, and
 * it is the same verdict this returns for a file no section names at all.
 */
export function fileLineHits(
  sections: readonly LcovFileSection[],
  path: string,
  workspaceRoot?: string,
): ReadonlyMap<number, number> | null {
  const wanted = resolvedPath(path, workspaceRoot);
  const naming = sections.filter((section) => resolvedPath(section.file, workspaceRoot) === wanted);

  return naming.length === 1 ? (naming[0]?.hits ?? null) : null;
}

/**
 * One spelling of one path. Without a workspace root there is nothing to resolve a relative
 * name against, so the two spellings have to agree by themselves: inventing a root to make
 * them agree is the suffix match again, under another name.
 */
function resolvedPath(path: string, workspaceRoot?: string): string {
  const slashed = path.replaceAll("\\", "/");
  return workspaceRoot === undefined
    ? normalize(slashed)
    : resolve(workspaceRoot.replaceAll("\\", "/"), slashed);
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
 * There is deliberately no reader for printed reporter output here any more.
 *
 * There was one, scoped as a fallback for runners the harness could not ask for a machine
 * result, and it attributed failures from lines in captured output: a pytest `FAILED` line, a
 * pytest -q footer, a go `--- FAIL:` line, and a TAP document printed into a spec run, which
 * also flipped the reader's choice of format. Each of those is a line a test can print for the
 * test beside it, and each bought that sibling a base-source failure it never had, which is
 * what buys a deletion past the ratchet. Tightening the patterns was tried; the next spelling
 * arrived in the next pass.
 *
 * The rule instead: attribution comes from the TAP artifact the harness asked node's own runner
 * to write, at a path the harness named, and from nothing else. Where no such artifact exists,
 * nothing is attributed, no test is cleared, and the ratchet is stricter rather than looser.
 * That costs the per-test exemption on projects whose runner this harness cannot ask, which
 * build-guide section 7.1 names as a boundary rather than implying away.
 */

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
