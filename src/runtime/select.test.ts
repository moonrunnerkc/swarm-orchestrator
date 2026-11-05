import { describe, expect, it } from "vitest";
import type { Eligibility } from "./capacity.ts";
import type { InstalledModel } from "./ollama.ts";
import type { Profile } from "./profile.ts";
import { type Candidate, choose, escalationFor, probedEnough } from "./select.ts";

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
    expect(choice?.alternatives.map((one) => one.eligibility.model.name)).toEqual(["small"]);
  });

  it("prefers a model with a better record once three tasks are recorded, the rest ranked after it", () => {
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
    expect(choice?.alternatives.map((one) => one.eligibility.model.name)).toEqual(["large"]);
  });

  it("chooses nothing where no model is ready", () => {
    expect(choose([candidate("broken", 7e10, false)], profile(), 32768)).toBeNull();
  });

  it("ranks a model that keeps failing below one not tried yet", () => {
    const outcomes = { "digest-large": { complete: 0, other: 3 } };
    const choice = choose(
      [candidate("large", 3e10), candidate("small", 4e9)],
      profile(outcomes),
      32768,
    );
    expect(choice?.chosen.eligibility.model.name).toBe("small");
    // Not "the largest installed model": a larger one was passed over for its record.
    expect(choice?.reason).toMatch(
      /^ranked above large \(0 of 3 finished tasks complete\), whose record is worse/,
    );
  });

  it("counts finished tasks that are too few to rank by, rather than saying there are none", () => {
    const outcomes = { "digest-large": { complete: 1, other: 1 } };
    const choice = choose([candidate("large", 3e10)], profile(outcomes), 32768);
    expect(choice?.reason).toMatch(/^conservative default: the largest installed model that fits/);
    expect(choice?.reason).toContain(
      "2 finished tasks recorded for it here (1 complete), too few to rank by",
    );
    expect(choice?.reason).not.toContain("no finished tasks");
  });
});

describe("probing strongest first", () => {
  const large = candidate("large", 3e10);
  const next = model("small", 4e9);

  it("stops at the first ready model when the next is smaller and has no better record", () => {
    expect(probedEnough([large], [next], profile())).toBe(true);
    expect(probedEnough([large], [], profile())).toBe(true);
    expect(probedEnough([candidate("large", 3e10, false)], [next], profile())).toBe(false);
  });

  it("goes on to a smaller model whose record is better than what was found", () => {
    expect(
      probedEnough([large], [next], profile({ "digest-large": { complete: 0, other: 3 } })),
    ).toBe(false);
    expect(
      probedEnough([large], [next], profile({ "digest-small": { complete: 3, other: 0 } })),
    ).toBe(false);
  });

  // The installed 16.0.3 run of 2026-11-04 (session 20261104T141857-20e7e3): qwen3.6:35b-a3b was
  // ready with 2 of 5 tasks complete, the next model was smaller with 2 of 7, and probing stopped
  // there, so gemma4:31b further down the list, with 7 of 9, was never a candidate.
  it("goes on past a smaller model to one further down whose record is better", () => {
    const records = profile({
      "digest-qwen": { complete: 2, other: 3 },
      "digest-greedy": { complete: 2, other: 5 },
      "digest-gemma": { complete: 7, other: 2 },
    });
    const qwen = candidate("qwen", 3.5e10);
    const rest = [model("greedy", 3.1e10), model("gemma", 3.1e10)];
    expect(probedEnough([qwen], rest, records)).toBe(false);
    expect(probedEnough([qwen], [model("greedy", 3.1e10)], records)).toBe(true);
  });
});

// 2026-11-04: gemma4:31b, 12 of 14 finished tasks complete here, stalled on the feature, refactor
// and upgrade and was handed to qwen3.6:35b-a3b, 3 of 8, which looped the same way. The handoff
// went to the larger model, not the better one.
describe("whom a stalled run is handed to", () => {
  const record = (complete: number, other: number, kind = "feature") => ({
    complete,
    other,
    kinds: { [kind]: { complete, other } },
  });
  const alternatives = [{ name: "qwen", digest: "digest-qwen" }];

  it("never to a model whose record on this kind of task is no better", () => {
    const outcomes = { "digest-gemma": record(5, 1), "digest-qwen": record(1, 3) };
    expect(escalationFor("digest-gemma", alternatives, profile(outcomes), "feature")).toEqual({
      to: null,
      reason:
        "no other model here has a better record on feature tasks than the current one (5 of 6 feature task(s) complete)",
    });
  });

  it("to one with a better record on it, over at least two such tasks", () => {
    const outcomes = { "digest-gemma": record(0, 2), "digest-qwen": record(2, 0) };
    expect(escalationFor("digest-gemma", alternatives, profile(outcomes), "feature")).toEqual({
      to: alternatives[0],
      reason:
        "qwen has the better record on feature tasks here (2 of 2 feature task(s) complete, against 0 of 2 feature task(s) complete)",
    });
    const once = { "digest-gemma": record(0, 2), "digest-qwen": record(1, 0) };
    expect(escalationFor("digest-gemma", alternatives, profile(once), "feature").to).toBeNull();
  });

  it("not at all where the current model has no record of this kind: no gap was measured", () => {
    const outcomes = { "digest-qwen": record(3, 0, "refactor") };
    const pick = escalationFor("digest-gemma", alternatives, profile(outcomes), "refactor");
    expect(pick.to).toBeNull();
    expect(pick.reason).toBe(
      "no record of refactor tasks here for the current model, so no measured gap to escalate across",
    );
  });
});
