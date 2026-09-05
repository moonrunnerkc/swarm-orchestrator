import type { PolicyGuard } from "./policy-guard.ts";

class SandboxViolationError extends Error {
  constructor(reason: string) {
    super(`guard refused the path: ${reason}`);
    this.name = "SandboxViolationError";
  }
}

/**
 * Tools resolve through the guard rather than the path module, so a tool cannot reach
 * a file the chokepoint would have refused.
 */
export function resolveInsideWorkspace(guard: PolicyGuard, candidate: string): string {
  const verdict = guard.checkPath(candidate);
  if (!verdict.allowed) {
    throw new SandboxViolationError(verdict.reason);
  }
  return verdict.absolutePath;
}
