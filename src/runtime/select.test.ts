import { describe, expect, it } from "vitest";
import type { Eligibility } from "./capacity.ts";
import type { InstalledModel } from "./ollama.ts";
import type { Profile } from "./profile.ts";
import { type Candidate, choose } from "./select.ts";

const model = (name: string, parameters: number): InstalledModel => ({
  runtime: "ollama",
  name,
  digest: `digest-${name}`,
  sizeBytes: 1e9,
  quantization: "Q4_K_M",
  parameters,
  family: "f",
  capabilities: ["completion"],
  remote: false,
  contextLength: 65536,
  attention: [{ kvHeads: 1, keyLength: 1, valueLength: 1, window: null }],
});
const candidate = (
  name: string,
  parameters: number,
  ready = true,
  tokensPerSecond = 20,
): Candidate => ({
  eligibility: {
    model: model(name, parameters),
    eligible: true,
    reason: "fits",
    need: { weightsBytes: 1, kvCacheBytes: 1, overheadBytes: 1, totalBytes: 2 ** 30 },
  } satisfies Eligibility,
  probe: {
    ready,
    reason: ready ? "ready" : "did not follow",
    latencyMs: 1,
    tokensPerSecond,
    at: "now",
  },
});
const profile = (outcomes: Profile["outcomes"] = {}): Profile => ({
  version: 1,
  machine: { hostname: "h", platform: "darwin", arch: "arm64", totalMemory: 1 },
  probes: {},
  outcomes,
});

describe("choosing a model", () => {
  it("takes the largest ready model as a conservative default and says so", () => {
    const choice = choose(
      [candidate("small", 4e9), candidate("large", 3e10), candidate("broken", 7e10, false)],
      profile(),
      32768,
    );
    expect(choice?.chosen.eligibility.model.name).toBe("large");
    expect(choice?.reason).toMatch(/^conservative default: the largest installed model that fits/);
    expect(choice?.escalation).toBeNull();
  });

  it("prefers a model with a better record once three tasks are recorded, and offers the larger one to escalate to", () => {
    const outcomes = {
      "digest-small": { complete: 3, other: 0 },
      "digest-large": { complete: 1, other: 2 },
    };
    const choice = choose(
      [candidate("small", 4e9), candidate("large", 3e10)],
      profile(outcomes),
      32768,
    );
    expect(choice?.chosen.eligibility.model.name).toBe("small");
    expect(choice?.reason).toMatch(/^the best record here: 100% of its finished tasks complete/);
    expect(choice?.escalation?.eligibility.model.name).toBe("large");
  });

  it("chooses nothing where no model is ready", () => {
    expect(choose([candidate("broken", 7e10, false)], profile(), 32768)).toBeNull();
  });
});
