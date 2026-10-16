/**
 * The known-good implementation of a task, as the validator and the verification replays use
 * it: the maintainer's historical change, with any range declaration rewritten to the exact one
 * the task requires. The replay's form is limited to the paths the task authorizes, the change
 * a solver could make; the upstream test files stay hidden material either way.
 */
import { mirrorOf } from "../comparison/workspace.mjs";

/**
 * A maintainer's upgrade that declared a range, rewritten to the exact declaration the task
 * requires, in package.json and the lockfile's root entry and nowhere else: the resolved and
 * installed version, the integrity hashes and the tree are the maintainer's own. Two
 * declarations and exactly two, or the reference is not the shape this rewrite is for.
 */
export function exactlyDeclaredReference(referencePatch, dependency) {
  const escaped = dependency.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const range = new RegExp(`^(\\+\\s+"${dependency.name}": )"\\^${escaped}",$`, "gm");
  const count = (referencePatch.match(range) ?? []).length;
  if (count !== 2)
    throw new Error(
      `the reference patch carries ${count} range declaration(s) of ${dependency.name}, not the 2 an exact-declaration task rewrites`,
    );
  return referencePatch.replace(range, `$1"${dependency.declared}",`);
}

/** The reference a solver could have written: the maintainer's change to the authorized paths only. */
export async function solverReference(log, task, base, upstream) {
  const paths = task.hidden.allowedPaths;
  if (paths === undefined)
    throw new Error(`${task.id} authorizes no closed set of paths to restrict its reference to`);
  const diff = await log.run(["git", "diff", "--binary", base, upstream, "--", ...paths], {
    cwd: mirrorOf(task.repository),
    timeoutMs: 60_000,
  });
  if (diff.exitCode !== 0) throw new Error(`${task.id}: the reference diff could not be read`);
  return (task.hidden.upgrade ?? [])
    .filter((one) => one.declared !== undefined)
    .reduce(
      (patch, dependency) => exactlyDeclaredReference(patch, dependency),
      diff.stdout.toString(),
    );
}
