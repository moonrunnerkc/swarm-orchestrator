import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Clock } from "../core/clock.ts";
import {
  type CommandOptions,
  type GateCommandRunner,
  type GateObservation,
  unavailableObservation,
} from "./gate-definition.ts";
import { harnessControlledEnvironment } from "./node-test-command.ts";

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
 *
 * Two ways in, and the difference between them is the whole of invariant 7's "an invocation the
 * harness recognizes in full". A declared command is text the project wrote, so a shell reads
 * it and no artifact is asked of it. A vouched vector is one the harness built argument by
 * argument, so it is spawned with no shell in between and under an environment built here
 * rather than inherited: nothing re-reads the arguments on the way to the process, and no name
 * the workspace set decides what that process loads.
 */
export function createNodeCommandRunner(clock: Clock): GateCommandRunner {
  const observe = async (
    file: string,
    args: readonly string[],
    options: CommandOptions,
    environment?: Record<string, string>,
  ): Promise<GateObservation> => {
    const startedAt = clock.now();
    try {
      const { stdout, stderr } = await runProcess(file, [...args], {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 16_000_000,
        ...(environment === undefined ? {} : { env: environment }),
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
            ? `the command was killed after ${options.timeoutMs}ms, so it measured nothing. ` +
              "A command that runs this long without finishing is usually waiting for " +
              "something that is never coming: standard input nobody is typing, a prompt, or " +
              "a server that does not exit. Node's test runner gives each test file its own " +
              "standard input with no writer and never closes it, so a test that reads input " +
              "waits for ever rather than reaching the end of it. Take the input as an " +
              "argument and have the test pass it in, and keep any prompting behind the " +
              "entry-point guard so importing the file does not start it."
            : null,
      };
    }
  };

  return {
    run: (command: string, options: CommandOptions): Promise<GateObservation> =>
      observe("/bin/sh", ["-c", command], options),

    runVouched: (argv: readonly string[], options: CommandOptions): Promise<GateObservation> => {
      const [program, ...args] = argv;
      if (program === undefined) {
        return Promise.resolve(
          unavailableObservation("the harness was handed an empty vector, so nothing was run"),
        );
      }
      return observe(program, args, options, harnessControlledEnvironment(process.env));
    },
  };
}
