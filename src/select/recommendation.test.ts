import { describe, expect, it } from "vitest";
import type { HardwareProfile } from "./hardware-probe.ts";
import { calibrationCandidates, recommendModel } from "./recommendation.ts";
import { parseShortlist, type Shortlist } from "./shortlist.ts";

function model(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    backend: "ollama",
    parameters: "7B",
    quantization: "Q4_K_M",
    diskGb: 4.7,
    residentGb: 6,
    contextWindow: 32768,
    ...overrides,
  };
}

const shortlist: Shortlist = parseShortlist(
  JSON.stringify({
    schemaVersion: 1,
    revision: "2026-08-01",
    backends: [
      {
        name: "ollama",
        label: "Ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
        install: "ollama pull {model}",
        serve: "ollama serve",
      },
      {
        name: "rapid-mlx",
        label: "rapid-mlx",
        baseUrl: "http://127.0.0.1:8000/v1",
        install: "rapid-mlx pull {model}",
        serve: "rapid-mlx serve --model {model} --port 8000",
      },
    ],
    tiers: [
      {
        id: "cpu-small",
        label: "8 GB class, no usable GPU",
        rank: 10,
        minRamGb: 6,
        minVramGb: null,
        appleSilicon: null,
        models: [model({ id: "small", residentGb: 1.6 })],
      },
      {
        id: "cpu-large",
        label: "32 GB class, no usable GPU",
        rank: 30,
        minRamGb: 30,
        minVramGb: null,
        appleSilicon: null,
        models: [model({ id: "mid", residentGb: 11 })],
      },
      {
        id: "apple-32",
        label: "Apple Silicon, 32 GB class",
        rank: 65,
        minRamGb: 30,
        minVramGb: null,
        appleSilicon: true,
        models: [
          model({ id: "mlx-big", backend: "rapid-mlx", residentGb: 20 }),
          model({ id: "ollama-big", residentGb: 21 }),
        ],
      },
      {
        id: "gpu-24",
        label: "24 GB class discrete GPU",
        rank: 70,
        minRamGb: 30,
        minVramGb: 24,
        appleSilicon: false,
        models: [model({ id: "big", residentGb: 21 }), model({ id: "mid", residentGb: 11 })],
      },
      {
        id: "gpu-48",
        label: "48 GB class discrete GPU",
        rank: 80,
        minRamGb: 60,
        minVramGb: 48,
        appleSilicon: false,
        models: [model({ id: "huge", residentGb: 40 })],
      },
    ],
  }),
  "the test shortlist",
);

function profile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    platform: "linux",
    arch: "x64",
    appleSilicon: false,
    totalRamGb: 8,
    gpus: [],
    notes: [],
    ...overrides,
  };
}

const consumerGpu = profile({
  totalRamGb: 64,
  gpus: [{ vendor: "nvidia", name: "NVIDIA GeForce RTX 4090", vramGb: 24, unifiedMemory: false }],
});

const appleSilicon = profile({
  platform: "darwin",
  arch: "arm64",
  appleSilicon: true,
  totalRamGb: 36,
  gpus: [{ vendor: "apple", name: "Apple M3 Max", vramGb: 36, unifiedMemory: true }],
});

function recommended(hardware: HardwareProfile) {
  const recommendation = recommendModel(hardware, shortlist);
  if (recommendation.outcome !== "model") {
    throw new Error(`expected a model, got ${recommendation.outcome}`);
  }
  return recommendation;
}

describe("recommendModel on a single consumer GPU", () => {
  it("takes the highest-ranked tier the machine satisfies", () => {
    expect(recommended(consumerGpu).tier.id).toBe("gpu-24");
  });

  it("cites the measured VRAM and memory as the reason that tier matched", () => {
    expect(recommended(consumerGpu).reasoning).toContain(
      "it asks for 24.0 GB of VRAM: the probe measured 24.0 GB on NVIDIA GeForce RTX 4090.",
    );
    expect(recommended(consumerGpu).reasoning).toContain(
      "it asks for 30.0 GB of system memory: the probe measured 64.0 GB.",
    );
  });

  it("says why the next tier up was ruled out, with the number that ruled it out", () => {
    expect(recommended(consumerGpu).reasoning).toContain(
      'the next tier up, "gpu-48" (48 GB class discrete GPU), was ruled out: it asks for ' +
        "48.0 GB of VRAM and the probe measured 24.0 GB.",
    );
  });

  it("serves it with Ollama, because rapid-mlx is Apple Silicon only", () => {
    expect(recommended(consumerGpu).backend.name).toBe("ollama");
    expect(recommended(consumerGpu).reasoning).toContain(
      "the backend is Ollama: rapid-mlx serves Apple Silicon only.",
    );
  });

  it("takes the tier's first model that fits the VRAM, and shows the headroom", () => {
    const recommendation = recommended(consumerGpu);

    expect(recommendation.model.id).toBe("big");
    expect(recommendation.reasoning).toContain(
      'the shortlist ranks big first among the models in tier "gpu-24" that fit: it needs ' +
        "about 21.0 GB resident, " +
        "against the 24.0 GB of VRAM the probe measured on NVIDIA GeForce RTX 4090, " +
        "leaving 3.0 GB.",
    );
  });

  it("hands back a model spec the run command accepts", () => {
    expect(recommended(consumerGpu).modelSpec).toBe("local:big");
  });

  it("adds no caveats when every number was measured", () => {
    expect(recommended(consumerGpu).caveats).toEqual([]);
  });
});

describe("recommendModel on Apple Silicon", () => {
  it("takes the Apple Silicon tier and says the probe found it", () => {
    const recommendation = recommended(appleSilicon);

    expect(recommendation.tier.id).toBe("apple-32");
    expect(recommendation.reasoning).toContain(
      "it is for Apple Silicon machines: the probe found darwin/arm64 (Apple M3 Max).",
    );
  });

  it("prefers rapid-mlx there", () => {
    expect(recommended(appleSilicon).backend.name).toBe("rapid-mlx");
    expect(recommended(appleSilicon).model.id).toBe("mlx-big");
  });

  it("measures the fit against unified memory, and says what fraction it allowed", () => {
    expect(recommended(appleSilicon).reasoning).toContain(
      'the shortlist ranks mlx-big first among the models in tier "apple-32" that fit: it ' +
        "needs about 20.0 GB resident, against 27.0 GB usable, 75% of the 36.0 GB of unified " +
        "memory the probe measured, leaving 7.0 GB.",
    );
  });

  it("never offers a tier meant for a discrete GPU, however much memory the Mac has", () => {
    const bigMac = profile({
      ...appleSilicon,
      totalRamGb: 128,
      gpus: [{ vendor: "apple", name: "Apple M3 Ultra", vramGb: 128, unifiedMemory: true }],
    });

    expect(recommended(bigMac).tier.id).toBe("apple-32");
  });

  it("falls back to Ollama when the tier lists no rapid-mlx model, and says why", () => {
    const small = recommended(
      profile({ platform: "darwin", arch: "arm64", appleSilicon: true, totalRamGb: 8 }),
    );

    expect(small.tier.id).toBe("cpu-small");
    expect(small.backend.name).toBe("ollama");
    expect(small.reasoning).toContain(
      'the backend is Ollama: rapid-mlx is preferred on Apple Silicon, but tier "cpu-small" ' +
        "lists no rapid-mlx model.",
    );
  });
});

describe("recommendModel with low memory and no GPU", () => {
  it("takes the smallest tier and measures the fit against system memory", () => {
    const recommendation = recommended(profile());

    expect(recommendation.tier.id).toBe("cpu-small");
    expect(recommendation.model.id).toBe("small");
    expect(recommendation.reasoning).toContain(
      'the shortlist ranks small first among the models in tier "cpu-small" that fit: it ' +
        "needs about 1.6 GB resident, against 4.8 GB usable, 60% of the 8.0 GB of system " +
        "memory the probe measured, leaving 3.2 GB.",
    );
  });

  it("says the allowance against system memory is a rule of thumb", () => {
    expect(recommended(profile()).caveats.join(" ")).toMatch(
      /measured against system memory.*rule of thumb/s,
    );
  });

  it("recommends nothing when the machine is below every tier, and says what it fell short of", () => {
    const recommendation = recommendModel(profile({ totalRamGb: 2 }), shortlist);

    expect(recommendation.outcome).toBe("no-tier");
    expect(recommendation.reasoning).toContain(
      'the smallest tier, "cpu-small" (8 GB class, no usable GPU), asks for 6.0 GB of system ' +
        "memory and the probe measured 2.0 GB.",
    );
  });

  it("does not reach a tier whose memory floor the probe did not clear", () => {
    // 16 GB is well over the 8 GB class floor and well under the 32 GB one.
    const recommendation = recommended(profile({ totalRamGb: 16 }));

    expect(recommendation.tier.id).toBe("cpu-small");
    expect(recommendation.reasoning).toContain(
      'the next tier up, "cpu-large" (32 GB class, no usable GPU), was ruled out: it asks for ' +
        "30.0 GB of system memory and the probe measured 16.0 GB.",
    );
  });
});

describe("recommendModel when VRAM could not be read", () => {
  const unknownVram = profile({
    totalRamGb: 64,
    gpus: [
      {
        vendor: "amd",
        name: "AMD Radeon RX 7900 XTX",
        vramGb: null,
        unifiedMemory: false,
      },
    ],
    notes: ["lspci named the GPU but not its memory size, so VRAM is unknown for X."],
  });

  it("skips every tier that asks for VRAM and lands on a memory-only tier", () => {
    expect(recommended(unknownVram).tier.id).toBe("cpu-large");
  });

  it("keeps the probe's own note, and says a bigger model may still run", () => {
    const caveats = recommended(unknownVram).caveats;

    expect(caveats).toContain(
      "lspci named the GPU but not its memory size, so VRAM is unknown for X.",
    );
    expect(caveats.join(" ")).toMatch(/AMD Radeon RX 7900 XTX.*larger model/s);
  });

  it("says which tier the unknown VRAM cost it", () => {
    expect(recommended(unknownVram).reasoning).toContain(
      'the next tier up, "gpu-24" (24 GB class discrete GPU), was ruled out: it asks for ' +
        "24.0 GB of VRAM and the probe could not read any.",
    );
  });
});

describe("recommendModel within a tier", () => {
  /** A tier whose curated order disagrees with size, which is the case that decides the rule. */
  const curated = parseShortlist(
    JSON.stringify({
      schemaVersion: 1,
      revision: "r",
      backends: [
        {
          name: "ollama",
          label: "Ollama",
          baseUrl: "http://127.0.0.1:11434/v1",
          install: "ollama pull {model}",
          serve: "ollama serve",
        },
      ],
      tiers: [
        {
          id: "only",
          label: "the only tier",
          rank: 1,
          minRamGb: 0,
          minVramGb: null,
          appleSilicon: null,
          models: [
            model({ id: "fast-moe", residentGb: 15, contextWindow: 262144 }),
            model({ id: "big-dense", residentGb: 21 }),
            model({ id: "tiny", residentGb: 2 }),
          ],
        },
      ],
    }),
    "the curated shortlist",
  );

  it("keeps the shortlist's order, which knows things a size comparison does not", () => {
    const recommendation = recommendModel(consumerGpu, curated);

    if (recommendation.outcome !== "model") {
      throw new Error("expected a model");
    }
    expect(recommendation.model.id).toBe("fast-moe");
  });

  it("passes over a model the machine cannot hold and takes the next one down the list", () => {
    const recommendation = recommendModel(profile({ totalRamGb: 16 }), curated);

    if (recommendation.outcome !== "model") {
      throw new Error("expected a model");
    }
    // 60% of 16 GB is 9.6, so both the MoE and the dense model are out of reach.
    expect(recommendation.model.id).toBe("tiny");
  });
});

describe("recommendModel when nothing in the tier fits", () => {
  it("takes the smallest and says plainly that it will not fit", () => {
    const tight = parseShortlist(
      JSON.stringify({
        schemaVersion: 1,
        revision: "r",
        backends: [
          {
            name: "ollama",
            label: "Ollama",
            baseUrl: "http://127.0.0.1:11434/v1",
            install: "ollama pull {model}",
            serve: "ollama serve",
          },
        ],
        tiers: [
          {
            id: "only",
            label: "the only tier",
            rank: 1,
            minRamGb: 0,
            minVramGb: null,
            appleSilicon: null,
            models: [model({ id: "too-big", residentGb: 40 })],
          },
        ],
      }),
      "the tight shortlist",
    );
    const recommendation = recommendModel(profile({ totalRamGb: 8 }), tight);

    if (recommendation.outcome !== "model") {
      throw new Error("expected a model");
    }
    expect(recommendation.model.id).toBe("too-big");
    expect(recommendation.caveats.join(" ")).toMatch(
      /nothing in tier "only" fits the 4.8 GB measured.*too-big.*40.0 GB/s,
    );
  });
});

describe("calibrationCandidates", () => {
  it("offers the tier's models for this machine, with the static pick first", () => {
    const recommendation = recommended(appleSilicon);

    expect(calibrationCandidates(recommendation, appleSilicon, 5)).toEqual([
      "local:mlx-big",
      "local:ollama-big",
    ]);
  });

  it("leaves out a model this machine has no way to serve", () => {
    const recommendation = recommended(consumerGpu);

    // gpu-24 lists ollama models only, so nothing is dropped; the Apple tier proves the filter.
    expect(calibrationCandidates(recommendation, consumerGpu, 5)).toEqual([
      "local:big",
      "local:mid",
    ]);
  });

  it("stops at the limit, because calibration has minutes rather than hours", () => {
    expect(calibrationCandidates(recommended(consumerGpu), consumerGpu, 1)).toEqual(["local:big"]);
  });
});
