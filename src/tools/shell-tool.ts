import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type { Sandbox } from "./sandbox.ts";
import { defineTool, type ToolDefinition } from "./tool-definition.ts";

const runCommand = promisify(execFile);

const defaultTimeoutMs = 120_000;

const shellInput = z.object({
  command: z.string().min(1).describe("Command to run from the workspace root."),
  timeoutMs: z.number().int().positive().optional(),
});

interface CommandFailure {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
}

/**
 * Runs a command from the workspace root. The allowlist and the confirmation fallback
 * live in the chokepoint, so this tool is only reached once the command is permitted.
 */
export function createShellTool(sandbox: Sandbox): ToolDefinition {
  return defineTool({
    name: "shell",
    description: "Run a shell command from the workspace root and return its combined output.",
    inputSchema: shellInput,
    kind: "shell",
    pathsFrom: () => [],
    async execute(input) {
      const timeout = input.timeoutMs ?? defaultTimeoutMs;
      try {
        const { stdout, stderr } = await runCommand("/bin/sh", ["-c", input.command], {
          cwd: sandbox.workspaceRoot,
          timeout,
          maxBuffer: 4_000_000,
        });
        return combineStreams(stdout, stderr, 0);
      } catch (cause) {
        const failure = cause as CommandFailure;
        return combineStreams(failure.stdout ?? "", failure.stderr ?? "", failure.code ?? 1);
      }
    },
  });
}

function combineStreams(stdout: string, stderr: string, exitCode: number): string {
  const sections = [`exit code: ${exitCode}`];
  if (stdout.length > 0) {
    sections.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.length > 0) {
    sections.push(`stderr:\n${stderr.trimEnd()}`);
  }
  return sections.join("\n");
}
