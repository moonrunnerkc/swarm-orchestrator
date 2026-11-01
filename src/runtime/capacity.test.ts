import { describe, expect, it } from "vitest";
import { capacityAdvice, eligibility, memoryNeed, modelMemoryBudget } from "./capacity.ts";
import type { InstalledModel } from "./ollama.ts";

const gib = 1024 ** 3;
const model = (over: Partial<InstalledModel>): InstalledModel => ({
  runtime: "ollama",
  name: "m",
  digest: "d",
  sizeBytes: 20 * gib,
  quantization: "Q4_K_M",
  parameters: 3e10,
  family: "f",
  capabilities: ["completion", "tools"],
  remote: false,
  contextLength: 131072,
  attention: Array.from({ length: 40 }, () => ({
    kvHeads: 8,
    keyLength: 128,
    valueLength: 128,
    window: null,
  })),
  ...over,
});

describe("what a model needs and who may run", () => {
  it("counts the full KV cache at the configured context, not the file size alone", () => {
    const need = memoryNeed(model({}), 32768);
    // 32768 tokens x 40 layers x 8 heads x (128 + 128) x 2 bytes
    expect(need?.kvCacheBytes).toBe(32768 * 40 * 8 * 256 * 2);
    expect(need?.totalBytes).toBe(20 * gib + 5 * gib + gib);
  });

  it("counts a sliding-window layer at its window, not the whole context", () => {
    const layers = [
      { kvHeads: 16, keyLength: 256, valueLength: 256, window: 1024 },
      { kvHeads: 4, keyLength: 512, valueLength: 512, window: null },
    ];
    const need = memoryNeed(model({ attention: layers }), 32768);
    expect(need?.kvCacheBytes).toBe(1024 * 16 * 512 * 2 + 32768 * 4 * 1024 * 2);
  });

  it("holds back a quarter of memory, and at least 8 GiB, for everything else", () => {
    expect(modelMemoryBudget(64 * gib)).toBe(48 * gib);
    expect(modelMemoryBudget(16 * gib)).toBe(8 * gib);
  });

  it("excludes remote and embedding models before any probe, and says why", () => {
    const listed = eligibility(
      [
        model({ name: "cloud", remote: true, sizeBytes: 300, attention: null }),
        model({ name: "embed", capabilities: ["embedding"] }),
        model({ name: "small-context", contextLength: 8192 }),
        model({ name: "unknown-shape", attention: null }),
        model({ name: "too-big", sizeBytes: 60 * gib }),
        model({ name: "fits" }),
      ],
      32768,
      48 * gib,
    );
    expect(listed.map((one) => [one.model.name, one.eligible])).toEqual([
      ["cloud", false],
      ["embed", false],
      ["small-context", false],
      ["unknown-shape", false],
      ["too-big", false],
      ["fits", true],
    ]);
    expect(listed[0]?.reason).toBe("served remotely, with no local weights");
    expect(listed[4]?.reason).toMatch(/^needs 66\.0 GiB/);
  });
});

describe("what to do when no model fits", () => {
  // 40 layers of 8 KV heads at 256 values of 2 bytes: 160 KiB of KV cache per token.
  const big = model({ name: "big", sizeBytes: 30 * gib, parameters: 3e10 });
  const small = model({ name: "small", sizeBytes: 10 * gib, parameters: 1e10 });

  it("names the largest context at which a model fits, and the strongest model that fits there", () => {
    // small needs 10 + 20 (128k tokens) + 1 = 31 GiB; at 64k, 10 + 10 + 1 = 21 GiB. big needs 41 there.
    expect(capacityAdvice([big, small], 131072, 24 * gib)).toBe(
      "no local chat model fits a 131072-token context in the 24.0 GiB models may use here: run with --context 65536, where small fits (it needs 21.0 GiB), or install a smaller chat model",
    );
  });

  it("never suggests a context beyond what the model states it takes", () => {
    const short = model({ name: "short", sizeBytes: 10 * gib, contextLength: 40960 });
    expect(capacityAdvice([short], 131072, 24 * gib)).toBe(
      "no local chat model fits a 131072-token context in the 24.0 GiB models may use here: run with --context 32768, where short fits (it needs 16.0 GiB), or install a smaller chat model",
    );
  });

  it("says to install a smaller model when none fits at the smallest useful context", () => {
    expect(capacityAdvice([big, small], 32768, 8 * gib)).toBe(
      "no local chat model fits a 32768-token context in the 8.0 GiB models may use here, nor an 8192-token one: install a smaller chat model",
    );
  });

  it("says to install a chat model when there is none to size", () => {
    const remote = model({ name: "cloud", remote: true });
    expect(capacityAdvice([remote], 32768, 24 * gib)).toBe(
      "no local chat model is installed: install one with `ollama pull <model>`, or name an OpenAI-compatible server with --endpoint",
    );
    expect(capacityAdvice([model({ name: "shapeless", attention: null })], 32768, 24 * gib)).toBe(
      "the installed chat models state no attention shape, so their memory cannot be estimated: name one with --model to use it without the estimate",
    );
  });

  it("breaks a tie on parameters by name, as selection does", () => {
    const twin = (name: string) => model({ name, sizeBytes: 10 * gib, parameters: 1e10 });
    expect(capacityAdvice([twin("zeta"), twin("alpha")], 131072, 24 * gib)).toContain(
      "where alpha fits",
    );
  });

  it("gives no capacity advice when a model fits, since then the failure was not capacity", () => {
    expect(capacityAdvice([small], 32768, 24 * gib)).toBeNull();
  });
});
