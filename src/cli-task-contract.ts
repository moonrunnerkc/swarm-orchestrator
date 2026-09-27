import { type GoalContract, goalImmutablePaths } from "./evidence/goal-contract.ts";
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
