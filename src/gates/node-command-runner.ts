import type { Clock } from "../core/clock.ts";
import type { ChildEnvironment } from "../exec/child-environment.ts";
import type { IsolationBackend } from "../exec/execution-mode.ts";
import { runProcessGroup } from "../exec/run-process.ts";
import {
  type CommandOptions,
  type GateCommandRunner,
  type GateObservation,
  unavailableObservation,
} from "./gate-definition.ts";

/** The shell's own answer for a program it could not find, used for a spawn that found none. */
const notFoundExitCode = 127;

/**
 * Gate commands run outside the tool chokepoint on purpose: they are the harness measuring
 * the workspace, not the model acting on it, and routing them through the model's execution
 * path would put a gate's own result inside the surface it is judging.
 *
 * Two ways in, and the difference between them is the whole of invariant 7's "an invocation the
 * harness recognizes in full". A declared command is text the project wrote, so a shell reads
 * it and no artifact is asked of it. A vouched vector is one the harness built argument by
 * argument, so it is spawned with no shell in between: nothing re-reads the arguments on the
 * way to the process.
 *
 * Both arms run under the same built environment. A gate command is text the repository wrote,
 * so it is as untrusted as anything else the repository wrote, and it used to be handed every
 * name the operator's shell held. Stripping only the names that decide what node loads answered
 * a different question: it kept the measurement honest and left the credentials in place.
 */
export function createNodeCommandRunner(
  clock: Clock,
  environment: ChildEnvironment,
  /**
   * Where gate commands run. Absent is the host. A gate command is text the repository wrote,
   * so it is as untrusted as anything else the repository wrote, and on the host it reaches
   * whatever it names: the built environment keeps the credentials out of it and nothing keeps
   * it out of the filesystem.
   */
  backend?: IsolationBackend,
): GateCommandRunner {
  const observe = async (
    file: string,
    args: readonly string[],
    options: CommandOptions,
  ): Promise<GateObservation> => {
    const startedAt = clock.now();
    const ran =
      backend === undefined
        ? await runProcessGroup(file, args, {
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
            maxOutputBytes: 16_000_000,
            env: environment.variables,
          })
        : await backend.run([file, ...args], {
            cwd: options.cwd,
            timeoutMs: options.timeoutMs,
          });
    const durationMs = clock.now() - startedAt;

    if (ran.startFailure !== null) {
      return {
        exitCode: notFoundExitCode,
        stdout: "",
        stderr: ran.startFailure,
        durationMs,
        unavailable: `${ran.startFailure}, so this gate measured nothing`,
      };
    }

    // A command killed at its timeout ran, and did not pass: it is a failure of the gate, with
    // the reason in its output where the model and the reviewer read failures. It used to be
    // reported as not applicable, and a change whose suite hung read green on the strength of
    // the gates beside it.
    const killed = ran.timedOut
      ? `\nthe command was killed after ${options.timeoutMs}ms without finishing. ` +
        "A command that runs this long without finishing is usually waiting for " +
        "something that is never coming: standard input nobody is typing, a prompt, or " +
        "a server that does not exit. Node's test runner gives each test file its own " +
        "standard input with no writer and never closes it, so a test that reads input " +
        "waits for ever rather than reaching the end of it. Take the input as an " +
        "argument and have the test pass it in, and keep any prompting behind the " +
        "entry-point guard so importing the file does not start it."
      : "";

    return {
      exitCode: ran.exitCode,
      stdout: ran.stdout,
      stderr: `${ran.stderr}${killed}`,
      durationMs,
      unavailable: null,
    };
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
      return observe(program, args, options);
    },
  };
}
