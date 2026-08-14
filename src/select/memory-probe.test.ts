import { describe, expect, it } from "vitest";
import { createOllamaMemoryProbe, nativeEndpointFor } from "./memory-probe.ts";

function serving(body: unknown, url = "http://127.0.0.1:11434/api/ps") {
  const seen: string[] = [];
  const probe = createOllamaMemoryProbe({
    baseUrl: "http://127.0.0.1:11434/v1",
    fetch: (requested) => {
      seen.push(requested);
      if (requested !== url) {
        return Promise.reject(new Error(`ECONNREFUSED ${requested}`));
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    },
  });
  return { probe, seen };
}

describe("nativeEndpointFor", () => {
  it("derives the runtime's own endpoint from its OpenAI-compatible base", () => {
    expect(nativeEndpointFor("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434/api/ps");
  });

  it("copes with a base that has no version suffix or a trailing slash", () => {
    expect(nativeEndpointFor("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434/api/ps");
    expect(nativeEndpointFor("http://127.0.0.1:11434/v1/")).toBe("http://127.0.0.1:11434/api/ps");
  });
});

describe("createOllamaMemoryProbe", () => {
  it("reads the resident size of what the runtime has loaded", async () => {
    const { probe, seen } = serving({
      models: [{ name: "qwen2.5-coder:7b", size: 5_400_000_000, size_vram: 5_400_000_000 }],
    });

    expect(await probe()).toBe(5_400_000_000);
    expect(seen).toEqual(["http://127.0.0.1:11434/api/ps"]);
  });

  it("takes the largest when the runtime is holding more than one", async () => {
    // Summing would count a model this run never touched, so the largest is the honest reading.
    const { probe } = serving({
      models: [
        { name: "small", size: 1_000_000_000 },
        { name: "large", size: 9_000_000_000 },
      ],
    });

    expect(await probe()).toBe(9_000_000_000);
  });

  it("reports nothing rather than zero when the runtime has nothing loaded", async () => {
    const { probe } = serving({ models: [] });

    expect(await probe()).toBeNull();
  });

  it("reports nothing when the runtime is not there at all", async () => {
    const { probe } = serving({ models: [] }, "http://elsewhere/api/ps");

    expect(await probe()).toBeNull();
  });

  it("reports nothing when the answer is not a model list", async () => {
    const { probe } = serving({ running: "yes" });

    expect(await probe()).toBeNull();
  });
});
