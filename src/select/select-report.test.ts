import { describe, expect, it } from "vitest";
import { bundledShortlistLocation, readBundledShortlist } from "./bundled-shortlist.ts";
import type { HardwareProfile } from "./hardware-probe.ts";
import { recommendModel } from "./recommendation.ts";
import { renderSelectReport } from "./select-report.ts";

const shortlist = await readBundledShortlist();

/** Renders exactly what `swarm select` prints, against the shortlist that ships. */
function report(profile: HardwareProfile): string {
  return renderSelectReport({
    profile,
    loaded: {
      shortlist,
      origin: "bundled",
      location: bundledShortlistLocation,
      fallbackReason: null,
    },
    recommendation: recommendModel(profile, shortlist),
  }).join("\n");
}

const lowMemoryLaptop: HardwareProfile = {
  platform: "linux",
  arch: "x64",
  appleSilicon: false,
  totalRamGb: 7.7,
  gpus: [],
  notes: ["no GPU was detected: nvidia-smi and lspci did not answer."],
};

const consumerGpuDesktop: HardwareProfile = {
  platform: "linux",
  arch: "x64",
  appleSilicon: false,
  totalRamGb: 62.7,
  gpus: [{ vendor: "nvidia", name: "NVIDIA GeForce RTX 4090", vramGb: 24, unifiedMemory: false }],
  notes: [],
};

const macBookPro: HardwareProfile = {
  platform: "darwin",
  arch: "arm64",
  appleSilicon: true,
  totalRamGb: 36,
  gpus: [{ vendor: "apple", name: "Apple M3 Max", vramGb: 36, unifiedMemory: true }],
  notes: [],
};

describe("swarm select on a low-memory laptop with no GPU", () => {
  const text = report(lowMemoryLaptop);

  it("shows what the probe measured, including the GPU it did not find", () => {
    expect(text).toContain("  platform          linux x64");
    expect(text).toContain("  system memory     7.7 GB");
    expect(text).toContain("  gpu               none detected");
  });

  it("recommends a model small enough to hold, and shows the arithmetic", () => {
    expect(text).toContain("  model             qwen2.5-coder:3b");
    expect(text).toContain("4.6 GB usable, 60% of the 7.7 GB of system memory the probe measured");
  });

  it("says the system-memory fit is a rule of thumb", () => {
    expect(text).toMatch(/caveats[\s\S]*rule of thumb/);
  });

  it("gives the exact commands to pull it and point swarm at it", () => {
    expect(text).toContain("  ollama pull qwen2.5-coder:3b");
    expect(text).toContain("  ollama serve");
    expect(text).toContain(
      '  SWARM_LOCAL_BASE_URL=http://127.0.0.1:11434/v1 swarm --model local:qwen2.5-coder:3b "your task"',
    );
  });
});

describe("swarm select on a desktop with one consumer GPU", () => {
  const text = report(consumerGpuDesktop);

  it("reports the card and its VRAM", () => {
    expect(text).toContain("  gpu               NVIDIA GeForce RTX 4090, 24.0 GB VRAM");
  });

  it("reaches the 24 GB tier and names the numbers that got it there", () => {
    expect(text).toContain("  tier              gpu-24gb (24 GB class discrete GPU)");
    expect(text).toContain(
      "it asks for 22.0 GB of VRAM: the probe measured 24.0 GB on NVIDIA GeForce RTX 4090.",
    );
  });

  it("recommends an Ollama model that fits in 24 GB, and shows the headroom", () => {
    expect(text).toContain("  model             qwen3-coder:30b-a3b");
    expect(text).toContain("  backend           Ollama");
    expect(text).toMatch(/needs about 21\.0 GB resident.*leaving 3\.0 GB/);
  });

  it("says why the 48 GB tier was out of reach", () => {
    expect(text).toContain(
      'the next tier up, "gpu-48gb" (48 GB class discrete GPU), was ruled out: it asks for ' +
        "44.0 GB of VRAM and the probe measured 24.0 GB.",
    );
  });
});

describe("swarm select on Apple Silicon", () => {
  const text = report(macBookPro);

  it("names the chip and calls the memory unified", () => {
    expect(text).toContain("  platform          darwin arm64 (Apple Silicon)");
    expect(text).toContain("  gpu               Apple M3 Max, 36.0 GB unified memory");
  });

  it("prefers rapid-mlx, as the build guide calls for on this platform", () => {
    expect(text).toContain("  backend           rapid-mlx");
    expect(text).toContain("  model             mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit");
  });

  it("gives the rapid-mlx serve command with the port swarm will look at", () => {
    expect(text).toContain(
      "  rapid-mlx serve --model mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit --port 8000",
    );
    expect(text).toContain("SWARM_LOCAL_BASE_URL=http://127.0.0.1:8000/v1 swarm --model");
  });

  it("measures the fit against three quarters of unified memory", () => {
    expect(text).toContain("27.0 GB usable, 75% of the 36.0 GB of unified memory");
  });
});

describe("the report itself", () => {
  it("says where the shortlist came from and when it was curated", () => {
    expect(report(macBookPro)).toContain(`  source            ${bundledShortlistLocation}`);
    expect(report(macBookPro)).toContain(`  revision          ${shortlist.revision}`);
  });

  it("says when it fell back to the snapshot, rather than looking like a normal run", () => {
    const text = renderSelectReport({
      profile: macBookPro,
      loaded: {
        shortlist,
        origin: "bundled",
        location: bundledShortlistLocation,
        fallbackReason: "https://example.test/s.json could not be read (ECONNREFUSED)",
      },
      recommendation: recommendModel(macBookPro, shortlist),
    }).join("\n");

    expect(text).toContain("  fell back         https://example.test/s.json could not be read");
  });

  it("leaves the caveats block out when there is nothing to warn about", () => {
    expect(report(macBookPro)).not.toContain("caveats");
  });

  it("prints the reasoning as a list, so no line reads as a claim about the machine", () => {
    expect(report(consumerGpuDesktop)).toMatch(/\nwhy\n {2}- tier "gpu-24gb"/);
  });

  it("names it a curated estimate rather than a measurement", () => {
    expect(report(macBookPro)).toMatch(/curated estimate/);
  });

  it("explains itself when no tier matches, instead of printing an empty recommendation", () => {
    const tiny: HardwareProfile = { ...lowMemoryLaptop, totalRamGb: 2 };
    const text = renderSelectReport({
      profile: tiny,
      loaded: {
        shortlist,
        origin: "bundled",
        location: bundledShortlistLocation,
        fallbackReason: null,
      },
      recommendation: recommendModel(tiny, shortlist),
    }).join("\n");

    expect(text).toContain("no tier in the shortlist matches this machine.");
    expect(text).not.toContain("run it");
  });
});
