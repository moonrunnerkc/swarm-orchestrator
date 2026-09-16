import { describe, expect, it } from "vitest";
import type { DiscoveredLocalEndpoint } from "../providers/local-discovery.ts";
import type { HardwareProfile } from "./hardware-probe.ts";
import { pickServedModel } from "./served-pick.ts";
import { parseShortlist, type Shortlist } from "./shortlist.ts";

/**
 * ADR 0011, decision 2. When nothing pins a model, the run takes the best model a local
 * backend actually serves, ranked by the shortlist's tier for the probed hardware. Served
 * decides: a shortlist entry nobody pulled is not a candidate, and a served model the
 * shortlist has never heard of is a candidate only where nothing ranked is served.
 */
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
    ],
  }),
  "the test shortlist",
);

const appleSilicon: HardwareProfile = {
  platform: "darwin",
  arch: "arm64",
  appleSilicon: true,
  totalRamGb: 64,
  gpus: [{ vendor: "apple", name: "Apple M4", vramGb: null, unifiedMemory: true }],
  notes: [],
};

function served(
  models: Record<"ollama" | "rapid-mlx", readonly string[]>,
): DiscoveredLocalEndpoint[] {
  const endpoints: DiscoveredLocalEndpoint[] = [
    { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", models: models.ollama },
    { name: "rapid-mlx", baseUrl: "http://127.0.0.1:8000/v1", models: models["rapid-mlx"] },
  ];
  return endpoints.filter((endpoint) => endpoint.models.length > 0);
}

describe("picking the model a local backend serves", () => {
  it("takes the highest tier this hardware matches whose model is served, in shortlist order", () => {
    const pick = pickServedModel({
      served: served({ ollama: ["small", "ollama-big"], "rapid-mlx": ["mlx-big"] }),
      shortlist,
      profile: appleSilicon,
    });

    expect(pick).toMatchObject({ modelSpec: "local:mlx-big", endpoint: "rapid-mlx", ranked: true });
    expect(pick?.reason).toContain("Apple Silicon, 32 GB class");
  });

  it("falls to a lower tier when the higher one's models are not served", () => {
    const pick = pickServedModel({
      served: served({ ollama: ["small"], "rapid-mlx": [] }),
      shortlist,
      profile: appleSilicon,
    });

    expect(pick).toMatchObject({ modelSpec: "local:small", endpoint: "ollama", ranked: true });
  });

  it("takes an unlisted served model where nothing ranked is served, and says it is unranked", () => {
    const pick = pickServedModel({
      served: served({ ollama: ["gemma4:31b"], "rapid-mlx": [] }),
      shortlist,
      profile: appleSilicon,
    });

    expect(pick).toMatchObject({
      modelSpec: "local:gemma4:31b",
      endpoint: "ollama",
      ranked: false,
    });
    expect(pick?.reason).toContain("not on the shortlist");
  });

  it("is null where nothing is served", () => {
    expect(pickServedModel({ served: [], shortlist, profile: appleSilicon })).toBeNull();
  });
});
