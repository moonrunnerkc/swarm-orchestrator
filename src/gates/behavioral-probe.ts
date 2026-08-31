import { basename, dirname, extname, join } from "node:path";

/**
 * Whether a changed function still does anything different for different inputs.
 *
 * The gap this answers: replacing an implementation with `return 0` and rewriting the test to
 * expect 0 introduces no placeholder marker and moves no ratchet numeric, so every mechanical
 * check goes green over a function that stopped working. Reading the source cannot tell that
 * from a function whose correct implementation is a constant, and only knowing what the
 * function is for separates them, which is a judge.
 *
 * So nothing here reads what the function is for. It runs both versions over the same inputs
 * and compares how much their outputs varied. A function whose outputs varied before the change
 * and do not after is the stub; a function that was always constant is unchanged in that
 * respect and says nothing. That comparison is a measurement, and it is the reason the base
 * version has to be run rather than reasoned about.
 *
 * Advisory, and it stays advisory. A probe that executes workspace code and judges variance is
 * a heuristic with a false-positive rate: a function that legitimately became constant, or one
 * whose interesting inputs are none of the ones tried, both land here. It reports what it
 * measured and a person reads the diff, which is the same division of labour section 7 draws.
 */

/**
 * The values a probe calls with. Fixed and small: this is a variance check, not a fuzzer, and
 * a ladder that grows with the function under test would make two runs incomparable.
 */
export const probeInputs: readonly unknown[] = [
  0,
  1,
  -1,
  2.5,
  "",
  "a",
  "abcdef",
  true,
  false,
  null,
  [],
  [1, 2, 3],
  {},
];

export interface ExportProbe {
  readonly name: string;
  readonly arity: number;
  /** Distinct outcomes across the ladder, counting a throw as its own outcome. */
  readonly distinct: number;
  readonly called: number;
  readonly threw: number;
}

export interface ProbeReport {
  readonly module: string;
  readonly exports: readonly ExportProbe[];
  /** Why nothing was probed, or null when the module loaded. */
  readonly failure: string | null;
}

export interface ConstantReturnFinding {
  readonly path: string;
  readonly name: string;
  readonly arity: number;
  /** How much the base version varied, which is what makes the constancy a change. */
  readonly baseDistinct: number;
}

/**
 * Functions that varied before the change and do not after.
 *
 * Every condition is a measurement rather than a reading. Arity above zero, because a function
 * taking nothing cannot vary with its input and saying so about one is noise. More than one
 * distinct outcome on the base, because a function that was always constant is not one this
 * change made constant. Exactly one on the submitted version, and at least one call that did
 * not throw, because a function that throws on every input is a different finding and the
 * placeholder gate or the tests gate is where that shows up.
 */
export function constantReturnFindings(
  path: string,
  base: ProbeReport,
  submitted: ProbeReport,
): readonly ConstantReturnFinding[] {
  if (base.failure !== null || submitted.failure !== null) {
    return [];
  }
  const before = new Map(base.exports.map((one) => [one.name, one]));

  return submitted.exports
    .filter((one) => {
      const was = before.get(one.name);
      return (
        was !== undefined &&
        one.arity > 0 &&
        was.distinct > 1 &&
        one.distinct === 1 &&
        one.called > one.threw
      );
    })
    .map((one) => ({
      path,
      name: one.name,
      arity: one.arity,
      baseDistinct: before.get(one.name)?.distinct ?? 0,
    }));
}

/**
 * Where the base version of a file is written so both versions can be loaded at once.
 *
 * Beside the file rather than in a directory of its own, because a module's relative imports
 * resolve against where it sits: moving it elsewhere would make every one of them fail and turn
 * every probe into a load error. Dot-prefixed and named for the file it copies, so a stray one
 * is obvious and cannot be mistaken for source.
 */
export function baseCopyPath(workspaceRoot: string, path: string): string {
  const extension = extname(path);
  const stem = basename(path, extension);
  return join(workspaceRoot, dirname(path), `.swarm-probe-base-${stem}${extension}`);
}

/**
 * The script the harness spawns. Written out rather than inlined into an argument, so nothing
 * a shell could re-read carries it, and it takes its work as JSON on argv.
 *
 * It reports and never decides. Comparing the two reports happens here, in the harness, where
 * the code being measured is not running.
 */
export const probeScript = `
const [, , payload] = process.argv;
const { modules, names, inputs } = JSON.parse(payload);

function outcomeOf(fn, args) {
  try {
    const value = fn(...args);
    // A promise is not awaited: the ladder is synchronous, and awaiting would make a rejected
    // one an unhandled rejection that takes the process rather than the reading.
    if (value !== null && typeof value === "object" && typeof value.then === "function") {
      return "pending";
    }
    return JSON.stringify(value) ?? String(value);
  } catch (cause) {
    return "threw:" + (cause instanceof Error ? cause.name : "value");
  }
}

async function probe(modulePath) {
  let loaded;
  try {
    loaded = await import(modulePath);
  } catch (cause) {
    return { module: modulePath, exports: [], failure: String(cause && cause.message ? cause.message : cause) };
  }
  const exports = [];
  for (const name of names) {
    const value = loaded[name];
    if (typeof value !== "function") {
      continue;
    }
    const arity = value.length;
    const outcomes = new Set();
    let called = 0;
    let threw = 0;
    for (const input of inputs) {
      const args = Array.from({ length: Math.max(arity, 1) }, () => input);
      const outcome = outcomeOf(value, args);
      called += 1;
      if (outcome.startsWith("threw:")) {
        threw += 1;
      }
      outcomes.add(outcome);
    }
    exports.push({ name, arity, distinct: outcomes.size, called, threw });
  }
  return { module: modulePath, exports, failure: null };
}

const reports = [];
for (const modulePath of modules) {
  reports.push(await probe(modulePath));
}
process.stdout.write(JSON.stringify(reports));
`;

/** The reports a probe run printed, or null where it printed something else. */
export function readProbeReports(stdout: string): readonly ProbeReport[] | null {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? (parsed as ProbeReport[]) : null;
  } catch {
    return null;
  }
}

/** What the harness hands the probe process, as one JSON argument. */
export function probePayload(modules: readonly string[], names: readonly string[]): string {
  return JSON.stringify({ modules, names, inputs: probeInputs });
}

const exportedFunction =
  /\bexport\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)|\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g;

/** Enough for any module worth probing, and a bound so one file cannot spend the timeout. */
const maxProbedExports = 50;

/**
 * The exported names in a module, read from the text it stands at.
 *
 * Read from the whole file rather than from the lines the change added, and that is not a
 * widening for its own sake: the stub this exists for edits a function body, so the `export
 * function` line it is declared on is not in the diff at all. Reading the diff found nothing
 * to probe in exactly the case the probe was built for. The change still decides which files
 * are probed; within one, the unit is the module.
 */
export function exportedFunctionNames(text: string): readonly string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(exportedFunction)) {
    const name = match[1] ?? match[2];
    if (name !== undefined) {
      names.add(name);
    }
  }
  return [...names].sort().slice(0, maxProbedExports);
}

/** Files a probe can load: modules this runtime imports, and never a test file. */
export function isProbeableModule(path: string): boolean {
  return /\.[cm]?[jt]s$/.test(path) && !/\.(test|spec)\.[cm]?[jt]s$/.test(path);
}
