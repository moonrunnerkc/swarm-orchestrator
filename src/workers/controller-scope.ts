import { z } from "zod";
import {
  contractPath,
  parseTaskContract,
  protectsPath,
  type TaskContract,
} from "../evidence/task-contract.ts";

export const controllerScopeSchema = z
  .strictObject({
    kind: z.enum(["files", "workspace"]),
    allowedPaths: z.array(z.string()).max(1024),
    immutablePaths: z.array(z.string()).max(1024),
  })
  .refine(
    (scope) =>
      scope.kind === "workspace" ? scope.allowedPaths.length === 0 : scope.allowedPaths.length > 0,
    { message: "workspace authority has no file list; file authority requires exact paths" },
  );
export type ControllerScope = z.infer<typeof controllerScopeSchema>;

export function parseControllerScope(input: unknown): ControllerScope {
  const scope = controllerScopeSchema.parse(input);
  return {
    ...scope,
    allowedPaths: [...new Set(scope.allowedPaths.map(contractPath))].sort(),
    immutablePaths: [
      ...new Set(
        scope.immutablePaths.map((path) =>
          path.endsWith("/**") ? `${contractPath(path.slice(0, -3))}/**` : contractPath(path),
        ),
      ),
    ].sort(),
  };
}

/** This is allocation authority inside the user scope, never an exception to the tool guard. */
export function amendControllerScope(
  contract: TaskContract,
  additions: readonly string[],
  scope: ControllerScope | undefined,
): TaskContract {
  if (scope === undefined) throw new Error("this graph has no declared scope amendment authority");
  if (contract.scopeAuthority !== "controller" || contract.scopeKind === "workspace")
    throw new Error("this task requires human scope authority or already holds workspace scope");
  const paths = [...new Set(additions.map(contractPath))];
  if (paths.length === 0 || paths.every((path) => contract.allowedPaths.includes(path)))
    throw new Error("scope amendment must authorize at least one additional file");
  if (
    paths.some(
      (path) =>
        scope.immutablePaths.some((immutable) => protectsPath(immutable, path)) ||
        (scope.kind === "files" && !scope.allowedPaths.includes(path)),
    )
  )
    throw new Error("scope amendment exceeds the pinned user authority or names an immutable path");
  return parseTaskContract({ ...contract, allowedPaths: [...contract.allowedPaths, ...paths] });
}

export function assertNarrowerContract(
  replacement: TaskContract,
  originals: readonly TaskContract[],
): void {
  if (
    originals.some((contract) => contract.scopeAuthority === "human") &&
    replacement.scopeAuthority !== "human"
  )
    throw new Error("graph revision cannot delegate human scope authority");
  const allowed = originals.flatMap((contract) => contract.allowedPaths);
  const immutable = originals.flatMap((contract) => contract.immutablePaths);
  const required = originals.flatMap((contract) => contract.requiredChecks);
  if (
    replacement.allowedPaths.some(
      (path) =>
        !allowed.includes(path) &&
        !originals.some((contract) => contract.scopeKind === "workspace"),
    ) ||
    replacement.allowedPaths.some((path) =>
      immutable.some((protectedPath) => protectsPath(protectedPath, path)),
    ) ||
    immutable.some((path) => !replacement.immutablePaths.includes(path)) ||
    required.some((check) => !replacement.requiredChecks.includes(check))
  )
    throw new Error(
      "graph revision cannot broaden paths or weaken immutable paths and required checks",
    );
  if (
    replacement.allowedTools.some(
      (tool) => !originals.every((contract) => contract.allowedTools.includes(tool)),
    ) ||
    originals.some(
      (contract) =>
        contract.network !== replacement.network ||
        contract.execution !== replacement.execution ||
        contract.riskTier !== replacement.riskTier,
    ) ||
    replacement.budget.maxSteps >
      Math.max(...originals.map((contract) => contract.budget.maxSteps)) ||
    replacement.budget.maxWallMs >
      Math.max(...originals.map((contract) => contract.budget.maxWallMs)) ||
    (replacement.budget.maxTokens ?? 200000) >
      Math.max(...originals.map((contract) => contract.budget.maxTokens ?? 200000))
  )
    throw new Error("graph revision cannot broaden execution, tool or budget policy");
}
