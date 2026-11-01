import { describe, expect, it } from "vitest";
import { eligibility, memoryNeed, modelMemoryBudget } from "./capacity.ts";
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
