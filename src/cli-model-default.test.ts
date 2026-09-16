import { describe, expect, it } from "vitest";
import { defaultModelFor, NoDefaultModelError } from "./cli-model-default.ts";
import { resolveSettings } from "./config/settings.ts";
import type { DiscoveredLocalEndpoint } from "./providers/local-discovery.ts";
import type { HardwareProfile } from "./select/hardware-probe.ts";
import { parseShortlist } from "./select/shortlist.ts";

/**
 * ADR 0011, decision 2. With nothing pinned and no calibration, a run takes the best model a
 * local backend serves for this hardware, a frontier provider only where nothing local is
 * served, and stops with the remedy named where neither exists. The choice is printed before
 * the session and recorded on the ledger as the run's own setup.
 */
const shortlist = parseShortlist(
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
    ],
    tiers: [
      {
        id: "cpu-small",
        label: "8 GB class, no usable GPU",
        rank: 10,
        minRamGb: 6,
        minVramGb: null,
        appleSilicon: null,
        models: [
          {
            id: "small",
            backend: "ollama",
            parameters: "7B",
            quantization: "Q4_K_M",
            diskGb: 4.7,
            residentGb: 1.6,
            contextWindow: 32768,
          },
        ],
      },
    ],
  }),
  "the test shortlist",
);

const profile: HardwareProfile = {
  platform: "linux",
  arch: "x64",
  appleSilicon: false,
  totalRamGb: 16,
  gpus: [],
  notes: [],
};

const noFlags = { model: null, maxSteps: null, attempts: null, localEndpoint: null };

function deps(served: readonly DiscoveredLocalEndpoint[]) {
  return {
    discover: () => Promise.resolve(served),
    probe: () => Promise.resolve(profile),
    shortlist: () => Promise.resolve(shortlist),
  };
}

describe("the model a run takes when nothing pins one", () => {
  it("is the best served local model, with the reason and the evidence of the choice", async () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml: null });

    const chosen = await defaultModelFor(
      settings,
      deps([{ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", models: ["small"] }]),
    );

    expect(chosen.modelSpec).toBe("local:small");
    expect(chosen.reason).toContain("8 GB class");
    expect(chosen.record).toMatchObject({
      modelSpec: "local:small",
      served: [{ endpoint: "ollama", models: ["small"] }],
      hardware: { totalRamGb: 16, appleSilicon: false },
      shortlistRevision: "2026-08-01",
    });
  });

  it("is the first frontier provider with a key where nothing local is served", async () => {
    const settings = resolveSettings({
      flags: noFlags,
      env: { OPENAI_API_KEY: "sk-test" },
      toml: null,
    });

    const chosen = await defaultModelFor(settings, deps([]));

    expect(chosen.modelSpec).toBe("openai:gpt-5.2");
    expect(chosen.reason).toContain("no local model is served");
  });

  it("stops with the remedy named where nothing is served and no key is set", async () => {
    const settings = resolveSettings({ flags: noFlags, env: {}, toml: null });

    await expect(defaultModelFor(settings, deps([]))).rejects.toThrow(NoDefaultModelError);
    await expect(defaultModelFor(settings, deps([]))).rejects.toThrow(/ollama pull|--model/);
  });
});
