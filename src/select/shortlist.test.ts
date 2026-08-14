import { describe, expect, it } from "vitest";
import { MalformedShortlistError, parseShortlist, shortlistSchemaVersion } from "./shortlist.ts";

const ollamaBackend = {
  name: "ollama",
  label: "Ollama",
  baseUrl: "http://127.0.0.1:11434/v1",
  install: "ollama pull {model}",
  serve: "ollama serve",
};

function shortlistText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: shortlistSchemaVersion,
    revision: "2026-08-01",
    backends: [ollamaBackend],
    tiers: [
      {
        id: "cpu-16gb",
        label: "16 GB class, no usable GPU",
        rank: 20,
        minRamGb: 15,
        minVramGb: null,
        appleSilicon: null,
        models: [
          {
            id: "qwen2.5-coder:7b",
            backend: "ollama",
            parameters: "7B",
            quantization: "Q4_K_M",
            diskGb: 4.7,
            residentGb: 6,
            contextWindow: 32768,
          },
        ],
      },
    ],
    ...overrides,
  });
}

describe("parseShortlist", () => {
  it("reads a well-formed shortlist", () => {
    const shortlist = parseShortlist(shortlistText(), "the bundled snapshot");

    expect(shortlist.revision).toBe("2026-08-01");
    expect(shortlist.tiers[0]?.models[0]?.id).toBe("qwen2.5-coder:7b");
  });

  it("names the field that is wrong and where the shortlist came from", () => {
    const broken = shortlistText({
      tiers: [
        {
          id: "cpu-16gb",
          label: "16 GB class",
          rank: 20,
          minRamGb: 15,
          minVramGb: null,
          appleSilicon: null,
          models: [
            {
              id: "qwen2.5-coder:7b",
              backend: "ollama",
              parameters: "7B",
              quantization: "Q4_K_M",
              diskGb: "big",
              residentGb: 6,
              contextWindow: 32768,
            },
          ],
        },
      ],
    });

    expect(() => parseShortlist(broken, "https://example.test/shortlist.json")).toThrow(
      MalformedShortlistError,
    );
    expect(() => parseShortlist(broken, "https://example.test/shortlist.json")).toThrow(
      /https:\/\/example\.test\/shortlist\.json[\s\S]*tiers\[0\]\.models\[0\]\.diskGb/,
    );
  });

  it("tells the reader what to do about a bad shortlist", () => {
    expect(() => parseShortlist("{", "https://example.test/shortlist.json")).toThrow(
      /--shortlist bundled/,
    );
  });

  it("refuses text that is not JSON at all, naming it as such", () => {
    expect(() => parseShortlist("<html>404</html>", "https://example.test/x.json")).toThrow(
      /is not JSON/,
    );
  });

  it("refuses a schema version this build does not read, and says which it reads", () => {
    expect(() => parseShortlist(shortlistText({ schemaVersion: 2 }), "a source")).toThrow(
      /declares schema version 2.*reads version 1/s,
    );
  });

  it("refuses a backend it has no way to start", () => {
    const text = shortlistText({
      tiers: [
        {
          id: "t",
          label: "t",
          rank: 1,
          minRamGb: 0,
          minVramGb: null,
          appleSilicon: null,
          models: [
            {
              id: "m",
              backend: "vllm",
              parameters: "7B",
              quantization: "Q4_K_M",
              diskGb: 1,
              residentGb: 1,
              contextWindow: 8192,
            },
          ],
        },
      ],
    });

    expect(() => parseShortlist(text, "a source")).toThrow(/ollama.*rapid-mlx/);
  });

  it("refuses a tier with no models, because matching it would recommend nothing", () => {
    const text = shortlistText({
      tiers: [
        {
          id: "t",
          label: "t",
          rank: 1,
          minRamGb: 0,
          minVramGb: null,
          appleSilicon: null,
          models: [],
        },
      ],
    });

    expect(() => parseShortlist(text, "a source")).toThrow(MalformedShortlistError);
  });

  it("refuses two tiers of equal rank, because then the pick is a coin toss", () => {
    const tier = {
      label: "t",
      rank: 20,
      minRamGb: 0,
      minVramGb: null,
      appleSilicon: null,
      models: [
        {
          id: "m",
          backend: "ollama",
          parameters: "7B",
          quantization: "Q4_K_M",
          diskGb: 1,
          residentGb: 1,
          contextWindow: 8192,
        },
      ],
    };
    const text = shortlistText({
      tiers: [
        { ...tier, id: "a" },
        { ...tier, id: "b" },
      ],
    });

    expect(() => parseShortlist(text, "a source")).toThrow(/rank 20/);
  });

  it("refuses an empty shortlist", () => {
    expect(() => parseShortlist(shortlistText({ tiers: [] }), "a source")).toThrow(
      MalformedShortlistError,
    );
  });

  it("carries the commands that start each backend, so a CLI change is a data change", () => {
    const shortlist = parseShortlist(shortlistText(), "a source");

    expect(shortlist.backends).toEqual([ollamaBackend]);
  });

  it("refuses a model whose backend the shortlist never declares", () => {
    const text = shortlistText({ backends: [{ ...ollamaBackend, name: "rapid-mlx" }] });

    expect(() => parseShortlist(text, "a source")).toThrow(
      /qwen2\.5-coder:7b.*backend "ollama".*does not declare/s,
    );
  });

  it("refuses a backend declared twice", () => {
    const text = shortlistText({ backends: [ollamaBackend, ollamaBackend] });

    expect(() => parseShortlist(text, "a source")).toThrow(/ollama.*twice/s);
  });

  it("refuses a backend whose endpoint is not a URL", () => {
    const text = shortlistText({ backends: [{ ...ollamaBackend, baseUrl: "localhost:11434" }] });

    expect(() => parseShortlist(text, "a source")).toThrow(/backends\[0\]\.baseUrl/);
  });
});
