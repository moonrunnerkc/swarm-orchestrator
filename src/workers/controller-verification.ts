import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GoalContract } from "../evidence/goal-contract.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyIndependently } from "../gates/independent-verification.ts";
import { createNodeCommandRunner } from "../gates/node-command-runner.ts";
import type { ParallelRunOptions } from "./parallel-run.ts";

const execute = promisify(execFile);

/** Share pinned configuration; each invocation still measures a newly created verifier checkout. */
export async function verifyControllerCommit(
  options: ParallelRunOptions & { goalContract: GoalContract },
  baseCommit: string,
  commit: string,
) {
  options.abortSignal.throwIfAborted();
  const git = async (args: readonly string[]) =>
    (
      await execute("git", [...args], {
        cwd: options.repositoryRoot,
        env: harnessChildEnvironment().variables,
        signal: options.abortSignal,
        timeout: 30000,
        maxBuffer: 64000000,
      })
    ).stdout;
  const tree = (await git(["rev-parse", `${commit}^{tree}`])).trim();
  const patch = await git(["diff", "--binary", baseCommit, commit]);
  const commands = (checkout?: string) =>
    createNodeCommandRunner(
      options.clock,
      harnessChildEnvironment(),
      checkout === undefined
        ? undefined
        : (options.verificationIsolation?.(checkout) ?? options.isolation?.(checkout)),
      options.abortSignal,
      options.runContext?.tests,
    );
  const verification = await verifyIndependently({
    repositoryRoot: options.repositoryRoot,
    checkoutRoot: options.scratchRoot,
    installDependencies: options.installDependencies === true,
    signal: options.abortSignal,
    baseCommit,
    patch,
    immutablePaths: options.immutablePaths ?? [],
    clock: options.clock,
    timeoutMs: Math.min(120000, options.remainingWallMs?.() ?? 120000),
    commands: commands(),
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    ...(options.isolation === undefined && options.verificationIsolation === undefined
      ? {}
      : { commandsForCheckout: async (checkout: string) => commands(checkout) }),
    goal: { contract: options.goalContract, evidence: options.coordinator, tree },
  });
  return { tree, patch, verification };
}
