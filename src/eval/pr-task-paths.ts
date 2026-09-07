import { join } from "node:path";

/**
 * Mined pull-request tasks generate two kinds of file, and they do not belong in the same place.
 *
 * Clones, agent workspaces and extracted oracle files are bulk: two gigabytes after eight scored
 * tasks, holding 1,753 test files belonging to other projects. Kept inside the repository they
 * made vitest walk all of them on every run, taking the suite from 50 seconds to 86 and rising.
 * Invariant 11 already states the rule they were breaking: what a session generates lives outside
 * the workspace.
 *
 * The results and the recorded patches are evidence: a few hundred kilobytes, and what `--rejudge`
 * reads to re-score a harness change without calling a model. Those stay committed, or that
 * re-score reproduces for nobody except the machine that happened to run it.
 */
export function prTaskWorkingRoot(home: string): string {
  return join(home, ".swarm", "pr-tasks");
}

export function prTaskEvidenceRoot(repositoryRoot: string): string {
  return join(repositoryRoot, "campaign/pr-tasks");
}
