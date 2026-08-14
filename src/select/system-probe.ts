import { execFile } from "node:child_process";
import { arch, platform, totalmem } from "node:os";
import { promisify } from "node:util";
import type { ProbeCommandRunner, ProbeEnvironment } from "./hardware-probe.ts";

const runCommandAndWait = promisify(execFile);

/** Long enough for a cold nvidia-smi, short enough that `swarm select` never appears to hang. */
const probeTimeoutMs = 5_000;

/**
 * Every probe is a fixed command with fixed arguments and no shell: nothing from the model or
 * the user reaches this, so it needs no allowlist of its own.
 */
const runProbeCommand: ProbeCommandRunner = async (command, args) => {
  try {
    const { stdout } = await runCommandAndWait(command, [...args], {
      timeout: probeTimeoutMs,
      windowsHide: true,
    });
    return stdout;
  } catch {
    // Not installed, not permitted, and crashed all mean the same thing here: no answer.
    return null;
  }
};

export function systemProbeEnvironment(): ProbeEnvironment {
  return {
    platform: platform(),
    arch: arch(),
    totalMemoryBytes: totalmem(),
    runCommand: runProbeCommand,
  };
}
