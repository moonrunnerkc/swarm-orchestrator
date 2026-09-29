import { networkInterfaces, tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { noProbeProgramExit, noProbeProgramReason } from "../exec/controlled-network.ts";
import { probeCheckNetwork } from "./check-network-probe.ts";
import type { GateCommandRunner, GateObservation } from "./gate-definition.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

/** The probe aims at an endpoint on this host's own non-loopback address; without one it measures nothing. */
const reachableHost = Object.values(networkInterfaces())
  .flat()
  .some((entry) => entry?.family === "IPv4" && !entry.internal);

function answering(observation: Partial<GateObservation>): GateCommandRunner {
  const observed: GateObservation = {
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 1,
    unavailable: null,
    ...observation,
  };
  return { run: async () => observed, runVouched: async () => observed };
}

describe.skipIf(!reachableHost)("whether a check-time command can connect", () => {
  it("reads the host itself, which reaches its own endpoint, as not contained", async () => {
    const probe = await probeCheckNetwork(
      createNodeCommandRunner(createSystemClock(), harnessChildEnvironment()),
      tmpdir(),
    );
    expect(probe.contained).toBe(false);
  });

  it("reads an attempt that ran and got nothing back as contained", async () => {
    expect(await probeCheckNetwork(answering({}), tmpdir())).toMatchObject({ contained: true });
  });

  it("never reads a probe that could not run, or had nothing to try with, as contained", async () => {
    for (const runner of [
      answering({ unavailable: "the backend could not start" }),
      answering({ exitCode: noProbeProgramExit, stderr: noProbeProgramReason }),
      answering({ exitCode: 128, stderr: "killed" }),
    ])
      expect((await probeCheckNetwork(runner, tmpdir())).contained).toBeNull();
  });
});
