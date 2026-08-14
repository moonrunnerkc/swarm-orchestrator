import type { Sandbox } from "./sandbox.ts";

class SandboxViolationError extends Error {
  constructor(reason: string) {
    super(`sandbox refused the path: ${reason}`);
    this.name = "SandboxViolationError";
  }
}

/**
 * Tools resolve through the sandbox rather than the path module, so a tool cannot reach
 * a file the chokepoint would have refused.
 */
export function resolveInsideWorkspace(sandbox: Sandbox, candidate: string): string {
  const verdict = sandbox.checkPath(candidate);
  if (!verdict.allowed) {
    throw new SandboxViolationError(verdict.reason);
  }
  return verdict.absolutePath;
}
