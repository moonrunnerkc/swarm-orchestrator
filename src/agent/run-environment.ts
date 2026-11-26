import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExecutionPolicy } from "swarm-verify";
import {
  containedExecutor,
  type Executor,
  hostExecutor,
  refusingExecutor,
} from "../tools/executor.ts";
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
 * executor every command goes through, the run's deadline, and where the verifier runs the
 * checks. Isolated, the executor is a container; one that cannot be made leaves an executor that
 * runs nothing and the reason, never the host. On the host the worktree's Python environment is
 * built here; in a container the dependencies are installed there (dependencies.ts).
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
  readonly executor: Executor;
  /** Why the run cannot execute anything, with what to do; null where it can. */
  readonly unavailable: string | null;
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
  const isolated = options.isolation === "isolated";
  const opened = isolated
    ? await containedExecutor({
        workspace: guard.workspaceRoot,
        home: input.childHome,
        cache: join(input.home, "cache"),
        accounts: join(dirname(input.childHome), "accounts"),
        gitCopy: join(dirname(input.childHome), "worker-git"),
      })
    : hostExecutor(guard.workspaceRoot, guard.childEnvironment.variables);
  const unavailable =
    "unavailable" in opened
      ? `${opened.unavailable.replace(/, or verify on the host.*$/, "")}, or pass --host to run the model's commands and the checks on this machine, which the report states as host, not isolated`
      : null;
  const executor = "unavailable" in opened ? refusingExecutor(opened.unavailable) : opened;
  const python = isolated
    ? null
    : await preparePythonEnvironment({
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
  return { guard, deadline, python, execution, executor, unavailable };
}
