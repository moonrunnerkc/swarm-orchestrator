import { isAbsolute, relative, sep } from "node:path";
import { resolvedPath } from "./resolved-path.ts";

/**
 * Whether the task oracle executed the lines the patch added.
 *
 * An oracle is only evidence about code it ran. `swarm ci` already refuses to certify on an oracle
 * that accepts the base, which catches one that tests nothing; this catches one that tests only
 * part of what changed.
 *
 * It is not hypothetical. koa#1946 was certified by an oracle that never reached the branch a
 * held-back oracle then refused: running the sealed half under coverage left lines 270 to 273 of
 * the file the patch changed unexecuted, and those lines are exactly where the defect was. The
 * tool asserted more than it had measured.
 *
 * This does not need the specification. It compares two things the verifier already holds, the
 * patch and the coverage of the run it just performed, which is why it can be applied to an oracle
 * written by somebody else for a purpose nobody declared.
 */
/**
 * Whether a changed path is one of the patch's own tests.
 *
 * Named as what it is: a convention, not a guarantee. A file under a test directory, or one whose
 * name ends in `.test.*` or `.spec.*`, is read as a test; `latest.ts`, `contest.js` and
 * `testing-helpers.ts` are not, because the word appearing inside a name says nothing.
 *
 * Reach exists to ask whether the oracle judged the behaviour the patch introduced, and a test
 * file is not that behaviour. An acceptance oracle runs its own test file and never the
 * candidate's, so the candidate's tests are absent from every coverage report by construction.
 * Counting them turned two koa patches that both oracles accept into refusals.
 *
 * What being wrong costs, in each direction: a source file mistaken for a test drops out of reach,
 * which weakens the check by one file; a test file not recognized is reported unreached, which
 * refuses a patch that is fine. Neither is silent, since the unreached files are named.
 */
function namesATestFile(path: string): boolean {
  const segments = path.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.slice(0, -1).some((segment) => /^(__tests__|__test__|tests?|specs?)$/.test(segment)) ||
    /\.(test|spec)\.[^.]+$/.test(basename)
  );
}

/**
 * The report's own names for the files it measured, as paths the patch would name.
 *
 * node's lcov reporter writes `SF:` relative to the directory the run started in; jest and vitest
 * write it absolute. The patch names one spelling, so the report is brought to it rather than the
 * comparison being loosened to accept both, which is the kind of loosening that turns a file the
 * oracle never ran into a file nobody noticed.
 */
export function lineHitsByWorkspacePath(
  sections: readonly { readonly file: string; readonly hits: ReadonlyMap<number, number> }[],
  workspaceRoot: string,
): Record<string, Record<number, number>> {
  const measured: Record<string, Record<number, number>> = {};
  const root = resolvedPath(workspaceRoot);
  for (const section of sections) {
    const path = isAbsolute(section.file)
      ? relative(root, resolvedPath(section.file))
      : section.file;
    if (path.length === 0 || path.startsWith("..") || isAbsolute(path)) {
      continue;
    }
    measured[path.split(sep).join("/")] = Object.fromEntries(section.hits);
  }
  return measured;
}

export interface ChangedLines {
  readonly path: string;
  readonly addedLines: readonly number[];
}

export interface OracleReach {
  readonly reached: boolean;
  /** Added lines the oracle never executed, per file, in the order the patch names them. */
  readonly unreached: readonly { readonly path: string; readonly lines: readonly number[] }[];
}

export function oracleReachedTheChange(input: {
  changed: readonly ChangedLines[];
  /**
   * Hits by line, per file, as the coverage report gave them. Presence and hit count carry two
   * different facts and both are needed: a line the report names with zero hits is one the oracle
   * could have run and did not, while a line it does not name at all is not executable.
   *
   * Reading absence as a skipped line was the earlier shape of this, and it marks nearly every
   * patch unreached. A report has no entry for a blank line, a comment, a closing brace or a bare
   * `else`, so a change adding a comment beside a line the oracle ran came back as a change the
   * oracle skipped, and the check would have refused certification over a line nothing can run.
   */
  measured: Readonly<Record<string, Readonly<Record<number, number>>>>;
}): OracleReach {
  const unreached: { path: string; lines: number[] }[] = [];

  for (const file of input.changed) {
    if (file.addedLines.length === 0 || namesATestFile(file.path)) {
      continue;
    }
    // A file the report does not mention was not measured, and not measured is not covered.
    // Treating a missing entry as full reach would let an oracle that ran nothing look thorough.
    const hits = input.measured[file.path];
    const missed =
      hits === undefined
        ? [...file.addedLines]
        : file.addedLines.filter((line) => hits[line] === 0);
    if (missed.length > 0) {
      unreached.push({ path: file.path, lines: missed });
    }
  }

  return { reached: unreached.length === 0, unreached };
}
