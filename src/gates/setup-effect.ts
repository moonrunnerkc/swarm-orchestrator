import { type CheckNetworkProbe, probeCheckNetwork } from "./check-network-probe.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";

/** One setup command, planned: what runs, where, with which network, and how its outcome reads. */
export interface SetupEffect {
  readonly argv: readonly string[];
  readonly network: "registry" | "none";
  readonly stage?:
    | "package-manager"
    | "build-requirements"
    | "source-archive"
    | "offline-lifecycle";
  /** Where the command runs, inside the unit being set up; absent is the unit itself. */
  readonly directory?: string;
  readonly networkProbe?: OfflineProof;
  readonly toolDirectory?: string;
  readonly describe: (outcome: {
    readonly observed: GateObservation;
    readonly succeeded: boolean;
  }) => string;
}

export interface SetupEffectOutcome {
  readonly observed: GateObservation;
  readonly succeeded: boolean;
  readonly sourceChanged: boolean;
  readonly detail: string;
}

export type NetworkProbe = (commands: GateCommandRunner, cwd: string) => Promise<CheckNetworkProbe>;

/** A measurement that showed a check-time command could not connect. */
export type OfflineProof = { readonly contained: true; readonly observed: string };

export interface FollowUpContext {
  readonly lockfile: string;
  readonly installArgv: readonly string[];
  readonly workspace: string;
  readonly commands: GateCommandRunner;
  readonly timeoutMs: number;
  readonly probeNetwork?: NetworkProbe;
  /** Runs one planned command as a recorded effect, intent before and completion after. */
  readonly effect: (planned: SetupEffect) => Promise<SetupEffectOutcome>;
}

export interface DeferredWork {
  readonly detail: string;
  /** A step changed source files, which fails the whole setup. */
  readonly sourceChanged: boolean;
}

export function outputTail(observed: GateObservation): string {
  return (observed.unavailable ?? `${observed.stderr}\n${observed.stdout}`.trim()).slice(-2000);
}

/** Measured once per unit, only where there is deferred work to run. */
export async function offlineProbe(
  context: FollowUpContext,
): Promise<{ proof: OfflineProof | null; probe: CheckNetworkProbe }> {
  const probe = await (context.probeNetwork ?? probeCheckNetwork)(
    context.commands,
    context.workspace,
  );
  return {
    proof: probe.contained === true ? { contained: true, observed: probe.observed } : null,
    probe,
  };
}

export function notRunOffline(what: string, probe: CheckNetworkProbe): string {
  return `${what} did not run: ${probe.contained === false ? "a check-time command here reaches the network" : `whether the checks' network is off could not be shown (${probe.observed})`}, and registry-served code is never run with network access; the checks measure the tree without it`;
}
