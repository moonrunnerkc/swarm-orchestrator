import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GoalContract } from "../evidence/goal-contract.ts";
import { runBehaviorCheck } from "./behavior-check.ts";
import type { GateCommandRunner } from "./gate-definition.ts";
import type { ChallengeRunner, ContractRun } from "./goal-challenges.ts";
import {
  goalArtifactUnchanged,
  prepareGoalArtifact,
  snapshotGoalCheckout,
} from "./goal-checkout.ts";
import { nodeSyntaxCheck } from "./mutant-parse.ts";
import type { CheckStatus } from "./oracle-bond-run.ts";

/**
 * The challenge loop's hands on a real checkout. Each contract check is run the way the goal
 * verifier runs it, artifacts written immutable and the tree held unchanged, but over the tree
 * as the challenge left it and without goal-check records: the challenge run record carries
 * the tree identity and the outcome instead, so a challenged tree is never mistaken for the
 * candidate in the verifier's own reading of the contract.
 */
export function createChallengeRunner(options: {
  readonly contract: GoalContract;
  readonly checkout: string;
  readonly commands: GateCommandRunner;
  readonly timeoutMs: number;
  /** Where a fixture patch is staged, outside the checkout. */
  readonly scratchDirectory: string;
  readonly restoreCandidate: () => Promise<boolean>;
  readonly runRepositoryChecks: () => Promise<readonly CheckStatus[]>;
  readonly signal?: AbortSignal;
}): ChallengeRunner {
  const { contract, checkout, commands, timeoutMs } = options;
  const run = (argv: readonly string[]) => commands.runVouched(argv, { cwd: checkout, timeoutMs });
  return {
    read: (path) => readFile(join(checkout, path), "utf8").catch(() => null),
    write: (path, text) => writeFile(join(checkout, path), text),
    parses: nodeSyntaxCheck(commands, { cwd: checkout, timeoutMs }),
    runRepositoryChecks: options.runRepositoryChecks,
    restore: options.restoreCandidate,
    async applyFixture(patch) {
      const path = join(options.scratchDirectory, "challenge-fixture.patch");
      await writeFile(path, patch.endsWith("\n") ? patch : `${patch}\n`, { mode: 0o600 });
      try {
        const applied = await run(["git", "apply", "--whitespace=nowarn", "--", path]);
        return {
          applied: applied.exitCode === 0 && applied.unavailable === null,
          detail:
            applied.exitCode === 0
              ? "applied"
              : (applied.unavailable ?? applied.stderr.slice(0, 500)),
        };
      } finally {
        await rm(path, { force: true });
      }
    },
    async runContractChecks(): Promise<ContractRun> {
      const staged = await run(["git", "add", "--all"]);
      const written = await run(["git", "write-tree"]);
      const tree = written.stdout.trim();
      if (staged.exitCode !== 0 || written.exitCode !== 0 || !/^[a-f0-9]{40,64}$/.test(tree))
        throw new Error("the challenged tree could not be pinned");
      const results: {
        id: string;
        status: ContractRun["checks"][number]["status"];
        detail: string;
      }[] = [];
      const snapshot = await snapshotGoalCheckout(checkout, options.signal);
      try {
        for (const check of contract.checks) {
          options.signal?.throwIfAborted();
          const restored = await run(["git", "read-tree", "--reset", "-u", tree]);
          if (restored.exitCode !== 0)
            throw new Error("cannot restore the challenged tree between checks");
          try {
            for (const artifact of check.artifacts) {
              const destination = await prepareGoalArtifact(checkout, artifact.path);
              await writeFile(destination, artifact.content, { flag: "wx", mode: 0o400 });
            }
            const behavior =
              check.behavior === undefined
                ? undefined
                : await runBehaviorCheck(check.behavior, {
                    commands,
                    checkout,
                    readOnlyFiles: check.artifacts.map((artifact) => join(checkout, artifact.path)),
                  });
            const observation =
              behavior?.observation ??
              (await commands.run(check.command, { cwd: checkout, timeoutMs }));
            const unchanged = await run(["git", "diff", "--exit-code", tree, "--"]);
            const artifactsUnchanged = (
              await Promise.all(
                check.artifacts.map((artifact) =>
                  goalArtifactUnchanged(checkout, artifact.path, artifact.content),
                ),
              )
            ).every(Boolean);
            const status =
              observation.unavailable !== null ||
              observation.outputTruncated ||
              behavior?.reading.status === "unjudged"
                ? "unjudged"
                : (behavior === undefined
                      ? observation.exitCode === 0
                      : behavior.reading.status === "accepted") &&
                    unchanged.exitCode === 0 &&
                    artifactsUnchanged
                  ? "accepted"
                  : "rejected";
            results.push({
              id: check.id,
              status,
              detail:
                behavior?.reading.detail ??
                observation.unavailable ??
                `exit ${observation.exitCode}`,
            });
          } finally {
            await snapshot.restore();
          }
        }
      } finally {
        await snapshot.dispose();
      }
      return { tree, checks: results };
    },
  };
}
