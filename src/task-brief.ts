import type { TaskContract } from "./evidence/task-contract.ts";

/** Tell the worker the same scope enforced by its tools, before it spends calls discovering denials. */
export function taskBrief(task: string, contract?: TaskContract): string {
  if (contract === undefined) return task;
  return `${contract.objective}\n\nEffective task contract (declarations cannot enlarge this authority):\n${JSON.stringify(
    {
      taskId: contract.taskId,
      dependsOn: contract.dependsOn,
      writable:
        contract.scopeKind === "workspace"
          ? "workspace, except immutable and policy-denied paths"
          : contract.allowedPaths,
      immutable: contract.immutablePaths,
      permittedTools: contract.allowedTools,
      requiredChecks: contract.requiredChecks,
      requestedExecution: contract.execution ?? "restricted",
      requestedNetwork: contract.network,
      budget: contract.budget,
      scopeAuthority: contract.scopeAuthority,
    },
  )}\nRead relevant source, keep maintained tests within this scope, and request a controller revision if required work cannot fit. This contract describes requested restrictions; the measured execution envelope records actual capability.`;
}
