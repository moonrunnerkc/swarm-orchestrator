import { describe, expect, it } from "vitest";
import { parseModelSpec } from "./model-spec.ts";
import { createProviderRegistry } from "./registry.ts";

/**
 * The request body is what this is about, so it is read off a fetch the registry was handed
 * rather than off the settings that produced it.
 */
async function bodyOfOneCall(localThinking: boolean | null): Promise<Record<string, unknown>> {
  let sent: Record<string, unknown> = {};
  const registry = createProviderRegistry({
    localBaseUrl: "http://127.0.0.1:8000/v1",
    localThinking,
    fetch: (_input, init) => {
      sent = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return Promise.resolve(
        new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
      );
    },
  });

  const client = registry.create(parseModelSpec("local:qwen3.8:27b"));
  await client
    .generate({
      system: "s",
      messages: [{ role: "user", text: "hello" }],
      tools: [],
      maxOutputTokens: 16,
      abortSignal: new AbortController().signal,
    })
    .catch(() => undefined);
  return sent;
}

describe("whether the local model reasons before it answers", () => {
  it("sends nothing at all when no setting asked for it", async () => {
    const body = await bodyOfOneCall(null);

    // The field is a vendor extension: a server that rejects what it does not recognise would
    // fail every call, so silence is the only safe default.
    expect(body).not.toHaveProperty("enable_thinking");
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });

  it("turns it off in both spellings the servers that accept it use", async () => {
    const body = await bodyOfOneCall(false);

    expect(body.enable_thinking).toBe(false);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("turns it on where a setup wants it on", async () => {
    const body = await bodyOfOneCall(true);

    expect(body.enable_thinking).toBe(true);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
  });
});
