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
  covered: Readonly<Record<string, readonly number[]>>;
}): OracleReach {
  const unreached: { path: string; lines: number[] }[] = [];

  for (const file of input.changed) {
    if (file.addedLines.length === 0) {
      continue;
    }
    // A file the report does not mention was not measured, and not measured is not covered.
    // Treating a missing entry as full reach would let an oracle that ran nothing look thorough.
    const ran = new Set(input.covered[file.path] ?? []);
    const missed = file.addedLines.filter((line) => !ran.has(line));
    if (missed.length > 0) {
      unreached.push({ path: file.path, lines: missed });
    }
  }

  return { reached: unreached.length === 0, unreached };
}
