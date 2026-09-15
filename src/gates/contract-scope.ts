import { contractPath, protectsPath, type TaskContract } from "../evidence/task-contract.ts";
import type { FileSetRegistry } from "./file-set.ts";

/** The model's declaration is intent inside authority, never a grant of authority. */
export function restrictFileSet(
  registry: FileSetRegistry,
  contract: TaskContract,
): FileSetRegistry {
  const authorized = new Set(contract.allowedPaths);
  const checked = (files: readonly string[]): readonly string[] =>
    files.map((file) => {
      const path = contractPath(file);
      if (
        contract.immutablePaths.some((immutable) => protectsPath(immutable, path)) ||
        (contract.scopeKind !== "workspace" && !authorized.has(path))
      ) {
        throw new Error(
          `${path} is outside controller-authorized scope for ${contract.taskId}; ` +
            "request a controller scope revision before changing it",
        );
      }
      return path;
    });
  checked([...registry.state().allowed]);
  return {
    state: () => registry.state(),
    declare: (files, actor) => registry.declare(checked(files), actor),
    amend: (files, reason, actor) => registry.amend(checked(files), reason, actor),
  };
}
