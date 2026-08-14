import { arch, platform, totalmem } from "node:os";
import { describe, expect, it } from "vitest";
import { probeHardware } from "./hardware-probe.ts";
import { systemProbeEnvironment } from "./system-probe.ts";

describe("systemProbeEnvironment", () => {
  it("reads the machine this process is running on", () => {
    const environment = systemProbeEnvironment();

    expect(environment.platform).toBe(platform());
    expect(environment.arch).toBe(arch());
    expect(environment.totalMemoryBytes).toBe(totalmem());
  });

  it("hands back what a probe printed", async () => {
    const printed = await systemProbeEnvironment().runCommand("node", [
      "-e",
      "process.stdout.write('probed')",
    ]);

    expect(printed).toBe("probed");
  });

  it("treats a probe that is not installed as an absence, not an error", async () => {
    const missing = await systemProbeEnvironment().runCommand("swarm-no-such-probe", []);

    expect(missing).toBeNull();
  });

  it("treats a probe that fails as an absence too", async () => {
    const failed = await systemProbeEnvironment().runCommand("node", ["-e", "process.exit(3)"]);

    expect(failed).toBeNull();
  });

  it("describes the machine the tests are running on", async () => {
    const profile = await probeHardware(systemProbeEnvironment());

    expect(profile.totalRamGb).toBeGreaterThan(0);
    expect(profile.appleSilicon).toBe(platform() === "darwin" && arch() === "arm64");
    // Either a GPU was described or the probe said which tools failed to describe one.
    expect(profile.gpus.length > 0 || profile.notes.length > 0).toBe(true);
  });
});
