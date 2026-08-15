import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { harnessControlledNodeTest, processIsolation, shellQuoted } from "./node-test-command.ts";

/**
 * Where changed-line coverage comes from. Reading it out of a gate's stdout put the
 * measurement inside the surface being measured: a test that prints a coverage table, or a
 * stray console.log, minted a number nothing measured. So the runner writes a report of its
 * own to a path this harness named, under the session store that invariant 11 keeps outside
 * the workspace, and the harness reads that file. Nothing printed to stdout is read, and a
 * run that leaves no report is not measured rather than measured from prose.
 *
 * lcov rather than the runner's own printed table, because the table shares a stream with
 * whatever the tests wrote: node folds captured stdout into every reporter's output, so a
 * test printing "start of coverage report" opens a section in a table artifact just as it
 * does on the terminal. An lcov report carries coverage records and nothing else, so there
 * is no line in it for a test to write.
 *
 * That holds only while the harness controls the run that writes it. Under a shared process
 * the destination path is in the tests' own argv and a test can write the file the harness is
 * about to read; a loader hook in the parent can write it whatever the isolation setting says.
 * Which of those a declared command would do is not decided here by rewriting the command into
 * safety, it is decided by node-test-command.ts, which recognizes an invocation completely or
 * not at all. Not at all means no report is asked for, and the arm is not measured.
 */

/** Reads back what a gate command was told to write, and clears it first. */
export interface CoverageArtifactStore {
  /** Drops any earlier report, so a stale file can never pass as this run's measurement. */
  clear(path: string): Promise<void>;
  /** What the runner wrote, or null when it wrote nothing. */
  read(path: string): Promise<string | null>;
}

export function createFileCoverageArtifactStore(): CoverageArtifactStore {
  return {
    async clear(path: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true });
      await rm(path, { force: true });
    },

    async read(path: string): Promise<string | null> {
      try {
        return await readFile(path, "utf8");
      } catch {
        return null;
      }
    },
  };
}

/**
 * One gate's report path. Per gate id so a polyglot repo's two test gates cannot read each
 * other's numbers, and sanitized because a gate id carries a colon once there is more than
 * one language in the tree.
 */
export function coverageArtifactPath(directory: string, gateId: string): string {
  return join(directory, `${gateId.replaceAll(/[^A-Za-z0-9._-]+/g, "-")}.lcov`);
}

/**
 * The command that measures this gate, or null to abstain. Null is the honest answer wherever
 * the harness cannot vouch for the invocation in full: the arm then reports not measured by
 * name rather than reporting a number it cannot stand behind.
 *
 * The stdout reporter is restated because naming any reporter replaces the default one, and
 * the test counters the ratchet reads still have to arrive on stdout.
 *
 * What is deliberately absent is any attempt to talk a declared command into safety. A project
 * that asks for a shared process, a loader hook, or a reporter of its own is not corrected, it
 * is left unmeasured, because the correction would have to predict what the shell makes of the
 * text it is correcting.
 */
export function coverageReportingCommand(
  body: string | undefined,
  artifactPath: string,
): string | null {
  const destination = shellQuoted(artifactPath);
  if (destination === null) {
    return null;
  }
  return harnessControlledNodeTest(body, [
    "--experimental-test-coverage",
    processIsolation,
    "--test-reporter=tap",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${destination}`,
  ]);
}
