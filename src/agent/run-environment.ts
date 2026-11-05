import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import type { ExecutionPolicy } from "swarm-verify";
import {
  createPolicyGuard,
  defaultShellAllowlist,
  type PolicyGuard,
} from "../tools/policy-guard.ts";
import { type PythonEnvironment, preparePythonEnvironment } from "./python-environment.ts";
import type { RunOptions } from "./run.ts";
import { dependencyPolicy } from "./verification.ts";

/**
 * What a run's commands and checks run under: the path policy with a private child HOME, the
 * run's deadline, the worktree's Python environment, and where the verifier runs the checks.
 */
export async function runEnvironment(input: {
  readonly options: RunOptions;
  readonly workspace: string;
  readonly repository: string;
  readonly home: string;
  readonly childHome: string;
  readonly started: number;
}): Promise<{
  readonly guard: PolicyGuard;
  readonly deadline: number;
  readonly python: PythonEnvironment | null;
  readonly execution: ExecutionPolicy;
}> {
  const { options, workspace, repository } = input;
  await mkdir(input.childHome, { recursive: true, mode: 0o700 });
  const guard = createPolicyGuard({
    workspaceRoot: workspace,
    homeDir: homedir(),
    shellAllowlist: defaultShellAllowlist,
    // The session store, its verifications and the sealed checks are never the agent's to read.
    deniedRoots: [input.home],
    childHomeDir: input.childHome,
  });
  const deadline =
    options.maxWallMs === null ? Number.POSITIVE_INFINITY : input.started + options.maxWallMs;
  const python = await preparePythonEnvironment({
    worktree: workspace,
    repository,
    env: guard.childEnvironment.variables,
    deadline,
    signal: options.signal,
  });
  const execution: ExecutionPolicy =
    options.isolation === "isolated"
      ? { mode: "isolated", network: "closed", dependencies: "prepare" }
      : {
          mode: "host",
          network: "open",
          dependencies: options.dependencies ?? (await dependencyPolicy(repository)),
        };
  return { guard, deadline, python, execution };
}
