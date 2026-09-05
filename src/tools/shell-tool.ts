import { z } from "zod";
import type { IsolationBackend } from "../exec/execution-mode.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import type { PolicyGuard } from "./policy-guard.ts";
import { readShellCommand } from "./shell-command.ts";
import { defineTool, type ToolDefinition, type ToolOutput } from "./tool-definition.ts";

const defaultTimeoutMs = 120_000;

const shellInput = z.object({
  command: z.string().min(1).describe("Command to run from the workspace root."),
  timeoutMs: z.number().int().positive().optional(),
});

export interface ShellToolOptions {
  /**
   * Where the command runs. Absent means the host, which is what `restricted` mode is: the
   * lexical policy has already ruled on the paths it could read out of the command, and that
   * bounds which programs start rather than what they reach once started. A backend here is
   * the layer under that one, and it is the only thing that holds for a command whose effect a
   * shell decides: a substitution names no path for any reader to rule on.
   */
  readonly backend?: IsolationBackend | undefined;
}

/**
 * Runs a command from the workspace root. The allowlist and the confirmation fallback
 * live in the chokepoint, so this tool is only reached once the command is permitted.
 */
export function createShellTool(guard: PolicyGuard, options?: ShellToolOptions): ToolDefinition {
  return defineTool({
    name: "shell",
    description: "Run a shell command from the workspace root and return its combined output.",
    inputSchema: shellInput,
    kind: "shell",
    // The words that could name a file, so the chokepoint rules on them with the same guard
    // the read and write tools answer to. Without this a shell call reached any path on the
    // machine, and `cat ~/.ssh/id_rsa` was a credential read the denylist never saw.
    pathsFrom: (input) => readShellCommand(input.command)?.operands ?? [],
    async execute(input) {
      const timeoutMs = input.timeoutMs ?? defaultTimeoutMs;
      const ran =
        options?.backend === undefined
          ? await runProcessGroup("/bin/sh", ["-c", input.command], {
              cwd: guard.workspaceRoot,
              timeoutMs,
              maxOutputBytes: 4_000_000,
              // Built rather than inherited. A path check cannot see
              // `process.env.OPENAI_API_KEY`, so the only thing between a command the model
              // wrote and the operator's own keys is what the child is handed.
              env: guard.childEnvironment.variables,
            })
          : await options.backend.run(["/bin/sh", "-c", input.command], {
              cwd: guard.workspaceRoot,
              timeoutMs,
            });
      return describeRun(input.command, ran.stdout, ran.stderr, ran.exitCode, ran.timedOut);
    },
  });
}

/**
 * The exit code is measured here and carried as a fact, not left for someone to read back
 * out of the text. A gate result or a claim about a test run has to rest on something the
 * harness observed, and text the model was shown is not that.
 */
function describeRun(
  command: string,
  stdout: string,
  stderr: string,
  exitCode: number,
  timedOut: boolean,
): ToolOutput {
  const sections = [`exit code: ${exitCode}`];
  if (timedOut) {
    sections.push("the command was killed for exceeding its timeout");
  }
  if (stdout.length > 0) {
    sections.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.length > 0) {
    sections.push(`stderr:\n${stderr.trimEnd()}`);
  }

  return {
    text: sections.join("\n"),
    facts: {
      command,
      exitCode,
      timedOut,
      stdoutBytes: stdout.length,
      stderrBytes: stderr.length,
    },
  };
}
