import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

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
 * A node test command rewritten to write an lcov report where the harness can read it, or
 * null when this is not a command that can be asked for one. Null is the honest answer: the
 * arm then abstains by name rather than falling back to whatever the run printed.
 *
 * The flags go directly after `--test` because node rejects them once the file patterns have
 * started and refuses them in NODE_OPTIONS. The stdout reporter is restated because naming
 * any reporter replaces the default one, and the test counters the ratchet reads still have
 * to arrive on stdout.
 */
export function coverageReportingCommand(
  body: string | undefined,
  artifactPath: string,
): string | null {
  if (body === undefined || /[|&;]/.test(body)) {
    return null;
  }
  // A project that already configured coverage or a reporter is left alone: rewriting it
  // would change what its own gate command means.
  if (body.includes("--experimental-test-coverage") || body.includes("--test-reporter")) {
    return null;
  }
  const runner = /\bnode\b[^\n]*?\s--test(?![\w-])/.exec(body);
  if (runner === null) {
    return null;
  }

  const flags = [
    "--experimental-test-coverage",
    "--test-reporter=tap",
    "--test-reporter-destination=stdout",
    "--test-reporter=lcov",
    `--test-reporter-destination=${quote(artifactPath)}`,
  ].join(" ");
  const at = runner.index + runner[0].length;
  return `${body.slice(0, at)} ${flags}${body.slice(at)}`;
}

function quote(path: string): string {
  return `'${path.replaceAll("'", "'\\''")}'`;
}
