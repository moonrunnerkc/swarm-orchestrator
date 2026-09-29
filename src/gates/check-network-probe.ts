import {
  controlledNetworkTarget,
  noProbeProgramExit,
  noProbeProgramReason,
} from "../exec/controlled-network.ts";
import { hostExecutionBackend } from "../exec/execution-mode.ts";
import type { GateCommandRunner } from "./gate-definition.ts";

export interface CheckNetworkProbe {
  /** True where the attempt ran and got nothing back; null where nothing was shown either way. */
  readonly contained: boolean | null;
  readonly observed: string;
}

/**
 * Whether a command run the way the checks run (no registry access asked for) can open a
 * connection, measured rather than read from the backend's configuration. A synthetic endpoint
 * on this host answers a control connection from the host first; only then is the same attempt
 * made through the runner. A probe that could not start, or had no program to try with, shows
 * nothing, and nothing is never read as containment.
 */
export async function probeCheckNetwork(
  commands: GateCommandRunner,
  cwd: string,
  timeoutMs = 15_000,
): Promise<CheckNetworkProbe> {
  const target = await controlledNetworkTarget();
  if (target === null)
    return { contained: null, observed: "no host endpoint to aim at, so nothing was shown" };
  try {
    const control = await hostExecutionBackend.run(
      [hostExecutionBackend.nodeProgram, "-e", target.script],
      { cwd, timeoutMs },
    );
    if (control.exitCode !== 0 || control.stdout !== "connected")
      return {
        contained: null,
        observed: "the host could not reach its own control endpoint, so nothing was shown",
      };
    const attempt = await commands.runVouched(["sh", "-c", target.shellScript], {
      cwd,
      timeoutMs,
    });
    if (attempt.unavailable !== null)
      return { contained: null, observed: `the probe did not run: ${attempt.unavailable}` };
    if (attempt.exitCode === noProbeProgramExit && attempt.stderr.includes(noProbeProgramReason))
      return { contained: null, observed: noProbeProgramReason };
    if (attempt.stdout.trim() === "connected")
      return { contained: false, observed: "a check-time command reached the control endpoint" };
    if (attempt.exitCode !== 0)
      return {
        contained: null,
        observed: `the probe exited ${attempt.exitCode} without an answer, so nothing was shown`,
      };
    return { contained: true, observed: "a check-time command could not reach the endpoint" };
  } finally {
    await target.close();
  }
}
