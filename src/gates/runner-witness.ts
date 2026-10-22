import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { GateObservation } from "./gate-definition.ts";
import { type InstrumentObservation, instrumentChanges } from "./instrument-identity.ts";

/**
 * The reading of a check whose runner is the project's own code (runner-source-v1).
 *
 * mocha runs its own suite with `node bin/mocha.js`, and that program imports the package's own
 * source, so a change to `lib/cli/unparse-args.js` is a change to the instrument and to the code
 * the tests exercise at once. Putting the base's file back to measure the pass (the
 * base-configuration reading) also puts back the implementation being tested, and the tests of
 * the new behaviour then fail by construction; reading that as "measured nothing" refused every
 * change to mocha's own `lib/`. The two roles cannot be split by running: mocha's test files
 * `require("../..")` for the runner's own `describe`, so a second copy of the runner beside the
 * candidate's source does not run them at all.
 *
 * What can be shown is what the instrument rule exists to protect: that the changed runner still
 * executes the tests the base's runner executes and still reports their failures. The harness
 * adds one failing test, under a title it draws at random, to every JavaScript or TypeScript test
 * file in the checkout, and runs the check twice: under the change's runner, and with the changed
 * runner files put back to the base's. The pass stands only where both runs fail, nothing was cut
 * from either output, the base's runner reported at least one of the added tests, and the change's
 * runner reported exactly the ones the base's runner did. A runner change that skipped a test file
 * or swallowed failures reports fewer of them and keeps the pass withheld.
 *
 * Applied only where every way the instrument differs from the base is a tree file reached as code
 * a run program loads (`programCode`) and at least one of them is loaded by the tests as well
 * (`programSubjects`): never to a changed configuration, script, manifest field, dependency or
 * installed runner, which keep the base-configuration reading alone.
 *
 * The residual, named: a runner change that recognizes the added tests and hides only failures it
 * can tell apart from them is not excluded, as it is not for any source under test that runs in
 * the runner's process. The added tests show the runner reports failures; they do not show it
 * reported the change's own tests honestly.
 */
export const runnerWitnessRule = "runner-source-v1";

export interface RunnerWitness {
  readonly rule: typeof runnerWitnessRule;
  /** The test files a failing test was added to, in the order of `markers`. */
  readonly files: readonly string[];
  /**
   * The message each added test fails with, drawn at random for this reading and assembled at run
   * time from two halves, so it appears in an output only where the test ran and its failure was
   * reported: a code frame of the file shows the halves, never the whole.
   */
  readonly markers: readonly string[];
  /** The check with the tests added, under the change's runner. */
  readonly candidate: GateObservation;
  /** The check with the tests added and the changed runner files put back to the base's. */
  readonly reference: GateObservation;
}

/**
 * The instrument differences a runner-source reading can stand in for, or null where any is not
 * a tree file reached as code a run program loads, where none of them is loaded by the tests as
 * well, or where nothing differs.
 */
export function runnerSourceChanges(observation: InstrumentObservation): readonly string[] | null {
  const changes = instrumentChanges(observation);
  if (changes.length === 0 || (observation.programSubjects ?? []).length === 0) return null;
  const program = new Set(observation.programCode ?? []);
  return changes.every((change) => program.has(change)) ? changes : null;
}

/** Which added tests an output reports failing, by index into `markers`. */
export function reportedWitnesses(
  observation: GateObservation,
  markers: readonly string[],
): readonly number[] {
  const text = `${observation.stdout}\n${observation.stderr}`;
  return markers.flatMap((marker, index) => (text.includes(marker) ? [index] : []));
}

/**
 * Whether the readings show the change's runner executing and failing what the base's runner
 * does. Mirrored in src/evidence/verifier/status.mjs, which re-derives it from the record.
 */
export function runnerWitnessHeld(
  witness: RunnerWitness,
  instrument: InstrumentObservation | undefined,
): boolean {
  if (witness.rule !== runnerWitnessRule || instrument === undefined) return false;
  if (runnerSourceChanges(instrument) === null) return false;
  if (witness.markers.length === 0 || witness.markers.length !== witness.files.length) return false;
  const usable = (observation: GateObservation) =>
    observation.unavailable === null &&
    observation.outputTruncated !== true &&
    observation.exitCode !== 0;
  if (!usable(witness.candidate) || !usable(witness.reference)) return false;
  const byReference = reportedWitnesses(witness.reference, witness.markers);
  const byCandidate = reportedWitnesses(witness.candidate, witness.markers);
  return (
    byReference.length > 0 &&
    byReference.length === byCandidate.length &&
    byReference.every((index, position) => byCandidate[position] === index)
  );
}

const runGit = promisify(execFile);

/** JavaScript and TypeScript files a runner collects as tests by their name. */
const witnessedTestFile = /(^|\/)__tests__\/.*\.[cm]?[jt]sx?$|[._](test|spec)\.[cm]?[jt]sx?$/;

/** The checkout's test files a failing test is added to: tracked and untracked, ignored left out. */
export async function witnessFiles(checkout: string): Promise<readonly string[]> {
  try {
    const { stdout } = await runGit("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
      cwd: checkout,
      maxBuffer: 64_000_000,
    });
    return [...new Set(stdout.split("\0").filter((path) => witnessedTestFile.test(path)))].sort();
  } catch {
    return [];
  }
}

/** One marker per file, unguessable before the reading is taken. */
export function drawWitnessMarkers(count: number): readonly string[] {
  return Array.from({ length: count }, () => `w${randomBytes(10).toString("hex")}`);
}

/** The test appended to one file: titled by its marker's first half, failing with the whole of it. */
export function witnessTest(marker: string): string {
  const half = Math.ceil(marker.length / 2);
  const head = JSON.stringify(marker.slice(0, half));
  const tail = JSON.stringify(marker.slice(half));
  return `\n;it(${head}, function () { throw new Error(${head} + ${tail}); });\n`;
}

/**
 * Runs `measure` with a failing test appended to each file, then writes every file back byte for
 * byte, whatever `measure` did.
 */
export async function withWitnesses<T>(
  checkout: string,
  files: readonly string[],
  markers: readonly string[],
  measure: () => Promise<T>,
): Promise<T> {
  const originals = new Map<string, Buffer>();
  try {
    for (const [index, path] of files.entries()) {
      const original = await readFile(join(checkout, path));
      originals.set(path, original);
      await writeFile(
        join(checkout, path),
        Buffer.concat([original, Buffer.from(witnessTest(markers[index] ?? ""))]),
      );
    }
    return await measure();
  } finally {
    for (const [path, original] of originals) await writeFile(join(checkout, path), original);
  }
}
