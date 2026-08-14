import { describe, expect, it } from "vitest";
import { type ProbeCommandRunner, type ProbeEnvironment, probeHardware } from "./hardware-probe.ts";

const gibibyte = 1024 ** 3;

/** Answers the named probes and nothing else, the way a machine missing a tool would. */
function answering(replies: Readonly<Record<string, string>>): ProbeCommandRunner {
  return (command) => Promise.resolve(replies[command] ?? null);
}

function environment(overrides: Partial<ProbeEnvironment> = {}): ProbeEnvironment {
  return {
    platform: "linux",
    arch: "x64",
    totalMemoryBytes: 8 * gibibyte,
    runCommand: answering({}),
    ...overrides,
  };
}

describe("probeHardware", () => {
  it("reports system memory in gigabytes", async () => {
    const profile = await probeHardware(environment({ totalMemoryBytes: 64 * gibibyte }));

    expect(profile.totalRamGb).toBe(64);
  });

  it("rounds the reported memory to one decimal rather than claiming the nominal size", async () => {
    // A "16 GB" Linux box reserves some of it, so the honest number is not 16.
    const profile = await probeHardware(environment({ totalMemoryBytes: 16_695_398_400 }));

    expect(profile.totalRamGb).toBe(15.5);
  });

  it("reads the GPU name and VRAM from nvidia-smi", async () => {
    const profile = await probeHardware(
      environment({
        runCommand: answering({ "nvidia-smi": "NVIDIA GeForce RTX 4090, 24564\n" }),
      }),
    );

    expect(profile.gpus).toEqual([
      { vendor: "nvidia", name: "NVIDIA GeForce RTX 4090", vramGb: 24, unifiedMemory: false },
    ]);
    expect(profile.notes).toEqual([]);
  });

  it("reads every GPU nvidia-smi lists", async () => {
    const profile = await probeHardware(
      environment({
        runCommand: answering({
          "nvidia-smi": "NVIDIA GeForce RTX 4090, 24564\nNVIDIA RTX A6000, 49140\n",
        }),
      }),
    );

    expect(profile.gpus.map((gpu) => gpu.vramGb)).toEqual([24, 48]);
  });

  it("detects Apple Silicon and reports its memory as the GPU's too", async () => {
    const profile = await probeHardware(
      environment({
        platform: "darwin",
        arch: "arm64",
        totalMemoryBytes: 36 * gibibyte,
        runCommand: answering({ sysctl: "Apple M3 Max\n" }),
      }),
    );

    expect(profile.appleSilicon).toBe(true);
    expect(profile.gpus).toEqual([
      { vendor: "apple", name: "Apple M3 Max", vramGb: 36, unifiedMemory: true },
    ]);
  });

  it("still reports Apple Silicon when the chip name cannot be read", async () => {
    const profile = await probeHardware(
      environment({ platform: "darwin", arch: "arm64", totalMemoryBytes: 16 * gibibyte }),
    );

    expect(profile.gpus).toEqual([
      { vendor: "apple", name: "Apple Silicon", vramGb: 16, unifiedMemory: true },
    ]);
  });

  it("does not call an Intel Mac Apple Silicon", async () => {
    const profile = await probeHardware(environment({ platform: "darwin", arch: "x64" }));

    expect(profile.appleSilicon).toBe(false);
    expect(profile.gpus).toEqual([]);
  });

  it("falls back to lspci when nvidia-smi is missing, and says VRAM is unknown", async () => {
    const profile = await probeHardware(
      environment({
        runCommand: answering({
          lspci: [
            "00:02.0 Host bridge: Intel Corporation Device 7d14",
            "03:00.0 VGA compatible controller: Advanced Micro Devices, Inc. " +
              "[AMD/ATI] Navi 31 [Radeon RX 7900 XTX] (rev cc)",
          ].join("\n"),
        }),
      }),
    );

    expect(profile.gpus).toEqual([
      {
        vendor: "amd",
        name: "Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [Radeon RX 7900 XTX]",
        vramGb: null,
        unifiedMemory: false,
      },
    ]);
    expect(profile.notes).toEqual([
      "lspci named the GPU but not its memory size, so VRAM is unknown for " +
        "Advanced Micro Devices, Inc. [AMD/ATI] Navi 31 [Radeon RX 7900 XTX].",
    ]);
  });

  it("prefers nvidia-smi over lspci when both answer, because only one reports VRAM", async () => {
    const profile = await probeHardware(
      environment({
        runCommand: answering({
          "nvidia-smi": "NVIDIA GeForce RTX 4070, 12282",
          lspci: "01:00.0 VGA compatible controller: NVIDIA Corporation AD104 (rev a1)",
        }),
      }),
    );

    expect(profile.gpus).toEqual([
      { vendor: "nvidia", name: "NVIDIA GeForce RTX 4070", vramGb: 12, unifiedMemory: false },
    ]);
  });

  it("names the probes it tried when nothing reports a GPU", async () => {
    const profile = await probeHardware(environment());

    expect(profile.gpus).toEqual([]);
    expect(profile.notes).toEqual(["no GPU was detected: nvidia-smi and lspci did not answer."]);
  });

  it("only tries nvidia-smi off Linux, and says so", async () => {
    const profile = await probeHardware(environment({ platform: "win32" }));

    expect(profile.notes).toEqual(["no GPU was detected: nvidia-smi did not answer."]);
  });

  it("survives a probe that answers with something unparseable", async () => {
    const profile = await probeHardware(
      environment({ runCommand: answering({ "nvidia-smi": "Failed to initialize NVML\n" }) }),
    );

    expect(profile.gpus).toEqual([]);
    expect(profile.notes).toEqual(["no GPU was detected: nvidia-smi and lspci did not answer."]);
  });

  it("carries the platform and architecture through unchanged", async () => {
    const profile = await probeHardware(environment({ platform: "linux", arch: "arm64" }));

    expect(profile).toMatchObject({ platform: "linux", arch: "arm64", appleSilicon: false });
  });
});
