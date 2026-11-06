import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startStubModel } from "../../eval/stub-model.mjs";
import { resolveModel } from "./resolve.ts";

const ready = "```bash\necho swarm-ready\n```";
const saved = process.env.OLLAMA_HOST;
afterEach(() => {
  if (saved === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = saved;
});

// Rapid-MLX served qwen3.8:27b on this machine and `auto` never looked at it: an endpoint was
// used only when named, and then alone. Under auto it is one more candidate, probed and ranked.
describe("auto with an OpenAI-compatible endpoint configured", () => {
  it("considers the endpoint's model, probed like any other, where Ollama is not answering", async () => {
    const stub = await startStubModel({ replies: [ready] });
    process.env.OLLAMA_HOST = "http://127.0.0.1:9";
    try {
      const resolved = await resolveModel({
        model: "auto",
        endpoint: `http://127.0.0.1:${stub.port}/v1`,
        apiKey: null,
        contextTokens: 32_768,
        home: await mkdtemp(join(tmpdir(), "endpoint-")),
        log: () => {},
      });
      expect(resolved).toMatchObject({
        name: "stub",
        runtime: "openai-compatible",
        digest: `http://127.0.0.1:${stub.port}/v1#stub`,
        alternatives: [],
      });
      expect(resolved.reason).toBe("the configured endpoint's model; Ollama is not answering");
      // The readiness probe ran against it, as against an Ollama model.
      expect(stub.requests).toHaveLength(1);
    } finally {
      await stub.close();
    }
  });

  it("goes on without an endpoint that does not answer, and says Ollama is needed", async () => {
    process.env.OLLAMA_HOST = "http://127.0.0.1:9";
    const logged: string[] = [];
    await expect(
      resolveModel({
        model: "auto",
        endpoint: "http://127.0.0.1:9/v1",
        apiKey: null,
        contextTokens: 32_768,
        home: await mkdtemp(join(tmpdir(), "endpoint-")),
        log: (line) => logged.push(line),
      }),
    ).rejects.toThrow(/Ollama is not answering/);
    expect(logged.some((line) => line.startsWith("not considering http://127.0.0.1:9/v1"))).toBe(
      true,
    );
  });
});
