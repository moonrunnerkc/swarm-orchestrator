import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Clock } from "../core/clock.ts";
import type { CommandOptions, GateCommandRunner, GateObservation } from "./gate-definition.ts";

const runProcess = promisify(execFile);

interface ProcessFailure {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly code?: number;
  readonly killed?: boolean;
  readonly message?: string;
}

/**
 * Gate commands run outside the tool chokepoint on purpose: they are the harness measuring
 * the workspace, not the model acting on it, and routing them through the model's execution
 * path would put a gate's own result inside the surface it is judging.
 */
export function createNodeCommandRunner(clock: Clock): GateCommandRunner {
  return {
    async run(command: string, options: CommandOptions): Promise<GateObservation> {
      const startedAt = clock.now();
      try {
        const { stdout, stderr } = await runProcess("/bin/sh", ["-c", command], {
          cwd: options.cwd,
          timeout: options.timeoutMs,
          maxBuffer: 16_000_000,
        });
        return {
          exitCode: 0,
          stdout,
          stderr,
          durationMs: clock.now() - startedAt,
          unavailable: null,
        };
      } catch (cause) {
        const failure = cause as ProcessFailure;
        return {
          exitCode: failure.code ?? 1,
          stdout: failure.stdout ?? "",
          stderr: failure.stderr ?? failure.message ?? "",
          durationMs: clock.now() - startedAt,
          unavailable:
            failure.killed === true
              ? `the command was killed after ${options.timeoutMs}ms, so it measured nothing`
              : null,
        };
      }
    },
  };
}
