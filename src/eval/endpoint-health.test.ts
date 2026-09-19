import { describe, expect, it } from "vitest";
import {
  attributeInvocation,
  endpointGenerates,
  endpointListsModels,
  type FetchLike,
  type GenerationProbe,
} from "./endpoint-health.ts";

const endpoint = "http://127.0.0.1:8000/v1";
const model = "malekoo/Qwen3.8-27B-MLX-8bit";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Resolves never, and rejects the way fetch does when its signal fires. */
const hangs: FetchLike = (_url, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

/** A server of two routes: what `/models` does, and what a completion does. */
const server =
  (routes: { models: FetchLike; completions: FetchLike }): FetchLike =>
  (url, init) =>
    url.endsWith("/models") ? routes.models(url, init) : routes.completions(url, init);

const listing: FetchLike = async () => json({ data: [{ id: model }] });
const completion =
  (content: string): FetchLike =>
  async () =>
    json({ choices: [{ message: { role: "assistant", content } }] });

describe("a wedged server, which lists its models and completes nothing", () => {
  const wedged = server({ models: listing, completions: hangs });

  it("answers the metadata probe", async () => {
    expect(await endpointListsModels(endpoint, { fetch: wedged })).toEqual({
      listed: true,
      detail: "",
    });
  });

  it("fails the generation probe as a timeout, within the bound it was given", async () => {
    const started = Date.now();
    const probe = await endpointGenerates(endpoint, model, { fetch: wedged, timeoutMs: 40 });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(probe).toMatchObject({ generates: false, failure: "timeout" });
    expect(probe.detail).toContain("no completion within 40 ms");
  });

  it("is an infrastructure failure, not an agent that wrote nothing", async () => {
    const probe = await endpointGenerates(endpoint, model, { fetch: wedged, timeoutMs: 40 });
    expect(attributeInvocation({ probe })).toMatchObject({
      to: "infrastructure",
      reason: "endpoint-not-generating",
    });
  });
});

describe("the generation probe", () => {
  it("passes on a completion that carries text", async () => {
    const probe = await endpointGenerates(endpoint, model, {
      fetch: server({ models: listing, completions: completion("ok") }),
    });
    expect(probe).toEqual({ generates: true, failure: null, detail: "" });
  });

  it("passes on a completion that carries a tool call and no text", async () => {
    const probe = await endpointGenerates(endpoint, model, {
      fetch: async () =>
        json({ choices: [{ message: { content: null, tool_calls: [{ id: "call-1" }] } }] }),
    });
    expect(probe.generates).toBe(true);
  });

  it("asks the configured model for a bounded completion at the completions route", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    await endpointGenerates(`${endpoint}//`, model, {
      fetch: async (url, init) => {
        seen.push({ url, body: JSON.parse(String(init?.body)) });
        return json({ choices: [{ message: { content: "ok" } }] });
      },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe(`${endpoint}/chat/completions`);
    expect(seen[0]?.body).toMatchObject({ model, max_tokens: 4 });
  });

  it("fails where metadata answers and the completion errors", async () => {
    const probe = await endpointGenerates(endpoint, model, {
      fetch: server({
        models: listing,
        completions: async () => json({ error: "Insufficient Memory" }, 500),
      }),
    });
    expect(probe).toMatchObject({ generates: false, failure: "http-error" });
    expect(probe.detail).toContain("HTTP 500");
  });

  it.each([
    ["an empty list of choices", { choices: [] }],
    ["no choices field", { object: "chat.completion" }],
    ["a choice with empty content", { choices: [{ message: { content: "" } }] }],
    ["a choice with whitespace content", { choices: [{ message: { content: " \n" } }] }],
    ["a choice with no message", { choices: [{ finish_reason: "stop" }] }],
    ["an empty tool call list", { choices: [{ message: { content: null, tool_calls: [] } }] }],
  ])("fails on HTTP success with %s", async (_name, body) => {
    const probe = await endpointGenerates(endpoint, model, { fetch: async () => json(body) });
    expect(probe).toMatchObject({ generates: false, failure: "no-usable-choice" });
  });

  it("fails on HTTP success whose body is not JSON", async () => {
    const probe = await endpointGenerates(endpoint, model, {
      fetch: async () => new Response("<html>gateway</html>", { status: 200 }),
    });
    expect(probe).toMatchObject({ generates: false, failure: "unreadable-body" });
  });

  it("fails as unreachable, not as a timeout, where nothing is listening", async () => {
    const probe = await endpointGenerates(endpoint, model, {
      fetch: async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      },
    });
    expect(probe).toMatchObject({ generates: false, failure: "unreachable" });
  });

  it("times out on a body that never finishes after the headers arrived", async () => {
    const stalled: FetchLike = async (_url, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
          },
        }),
        { status: 200 },
      );
    const probe = await endpointGenerates(endpoint, model, { fetch: stalled, timeoutMs: 40 });
    expect(probe).toMatchObject({ generates: false, failure: "timeout" });
  });
});

describe("the metadata probe", () => {
  it("reports an HTTP error and a dead socket as not listed", async () => {
    expect(await endpointListsModels(endpoint, { fetch: async () => json({}, 503) })).toMatchObject(
      { listed: false, detail: `HTTP 503 from ${endpoint}` },
    );
    expect(await endpointListsModels(endpoint, { fetch: hangs, timeoutMs: 30 })).toMatchObject({
      listed: false,
    });
  });
});

describe("whether an invocation may be read as the agent's", () => {
  const generating: GenerationProbe = { generates: true, failure: null, detail: "" };

  it("is the agent's where the endpoint generates and calls were answered", () => {
    expect(
      attributeInvocation({ probe: generating, calls: { modelCalls: 35, failedCalls: 1 } }),
    ).toEqual({ to: "agent" });
  });

  it("is the agent's where no ledger could be read and the endpoint generates", () => {
    expect(
      attributeInvocation({ probe: generating, calls: { modelCalls: null, failedCalls: null } }),
    ).toEqual({ to: "agent" });
    expect(attributeInvocation({ probe: generating })).toEqual({ to: "agent" });
  });

  it("is infrastructure where no call was answered, even on an endpoint that recovered", () => {
    expect(
      attributeInvocation({ probe: generating, calls: { modelCalls: 1, failedCalls: 1 } }),
    ).toMatchObject({ to: "infrastructure", reason: "no-model-call-answered" });
  });

  it("says nothing either way about an invocation that made no call", () => {
    expect(
      attributeInvocation({ probe: generating, calls: { modelCalls: 0, failedCalls: 0 } }),
    ).toEqual({ to: "agent" });
  });
});
