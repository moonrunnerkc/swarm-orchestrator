import { readFile } from "node:fs/promises";
import {
  freezeGoalContract,
  type GoalContract,
  goalImmutablePaths,
} from "./evidence/goal-contract.ts";
import { parseTaskContract, type TaskContract } from "./evidence/task-contract.ts";

/** Preserve user obligations and narrow upgrade authority on the ordinary task path. */
export function presetTaskContract(options: {
  goal: GoalContract;
  task: string;
  originalObjective?: string;
  maxSteps: number;
  maxWallMs: number;
  network: "denied" | "unrestricted";
}): TaskContract {
  const { goal } = options;
  const upgrade = goal.preset?.kind === "upgrade" ? goal.preset : undefined;
  return parseTaskContract({
    version: 3,
    scopeKind: upgrade === undefined ? "workspace" : "files",
    taskId: "preset",
    objective:
      options.originalObjective ??
      `${options.task}\nSealed objective: ${goal.goal}\nRequired behavior: ${JSON.stringify(goal.requirements.map(({ id, description }) => ({ id, description })))}\nPreset: ${JSON.stringify(goal.preset ?? null)}`,
    dependsOn: [],
    allowedPaths:
      upgrade === undefined ? ["**"] : [upgrade.manifest, upgrade.lockfile, ...upgrade.sourcePaths],
    immutablePaths: [...goalImmutablePaths(goal)],
    allowedTools: ["read", "write", "edit", "list", "search", "shell"],
    network: options.network,
    requiredChecks: ["task-acceptance"],
    budget: { maxSteps: options.maxSteps, maxWallMs: options.maxWallMs },
    riskTier: "medium",
    scopeAuthority: "human",
  });
}

/** The sealed contract a run was handed, or an error that names the file and what is wrong with it. */
export async function readGoalContractFile(path: string): Promise<GoalContract> {
  const describe = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`--goal-contract ${path} cannot be read: ${describe(cause)}`, { cause });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(`--goal-contract ${path} is not JSON: ${describe(cause)}`, { cause });
  }
  try {
    return freezeGoalContract(parsed).contract;
  } catch (cause) {
    throw new Error(`--goal-contract ${path} is not a valid goal contract: ${describe(cause)}`, {
      cause,
    });
  }
}

/**
 * A preset is named in two places or in neither. The contract's preset carries the policy the
 * verifier enforces (base controls, invariants, upgrade scope), and the flag is the operator
 * saying they meant it; a contract whose preset the command line did not name is not silently
 * run under that policy, and a flag the contract does not back cannot invent one.
 */
export function assertPresetSelection(
  flag: "bugfix" | "refactor" | "upgrade" | undefined,
  contract: GoalContract,
): void {
  const sealed = contract.preset?.kind;
  if (flag === sealed) return;
  if (flag === undefined)
    throw new Error(
      `the goal contract names the ${sealed} preset; pass --preset ${sealed} to run under that policy` +
        (sealed === "upgrade" ? " (with --install)" : ""),
    );
  if (sealed === undefined)
    throw new Error(
      `--preset ${flag} was named but the goal contract carries no preset; a general task runs ` +
        "without --preset, and a preset task seals its preset in the contract",
    );
  throw new Error(
    `--preset ${flag} does not match the ${sealed} preset sealed in the goal contract`,
  );
}
