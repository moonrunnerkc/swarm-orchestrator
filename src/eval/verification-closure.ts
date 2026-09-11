import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

/**
 * Which files a `swarm ci` verdict actually comes out of.
 *
 * Walked from the entry point rather than listed, because a list goes stale the moment somebody
 * adds an import and nothing tells you. Relative imports only, which is what this tree uses
 * between its own modules; a package dependency is not a file a commit of this repository moves.
 */
export function closureOf(entry: string, root = process.cwd()): readonly string[] {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file) || !existsSync(file)) {
      return;
    }
    seen.add(file);
    for (const found of readFileSync(file, "utf8").matchAll(/from "(\.[^"]+)"/g)) {
      walk(resolve(dirname(file), found[1] ?? ""));
    }
  };
  walk(resolve(root, entry));
  return [...seen].map((file) => relative(root, file).split("\\").join("/"));
}

/**
 * Whether a set of harness commits differ where a verdict comes from.
 *
 * A rate assembled across tool versions is not one number, which is why the corpus records the
 * commit that produced every row. The guard that reads those records used to compare commit ids,
 * so a documentation commit landing between two corpus stages made the rate "span tool versions"
 * and refused to be quoted. That is the right instinct and the wrong test: what must not be pooled
 * is rows produced by different verification code.
 *
 * `changedBetween` is asked for the files that differ between two commits, and is expected to
 * return null where it cannot answer. A comparison nobody could make is not a comparison that
 * passed, so that reads as different rather than as safe: an unknown commit or a shallow clone
 * has to widen the doubt rather than close it.
 */
export function harnessesDifferWhereItMatters(
  harnesses: readonly string[],
  changedBetween: (from: string, to: string) => readonly string[] | null,
  entry = "src/gates/independent-verification.ts",
): boolean {
  const distinct = [...new Set(harnesses)];
  if (distinct.length <= 1) {
    return false;
  }
  const closure = new Set(closureOf(entry));
  const [first, ...rest] = distinct;
  for (const other of rest) {
    const changed = changedBetween(first ?? "", other);
    if (changed === null) {
      return true;
    }
    if (changed.some((file) => closure.has(file))) {
      return true;
    }
  }
  return false;
}
