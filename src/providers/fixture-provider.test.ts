import { describe, expect, it } from "vitest";
import type { ModelRequest } from "../core/model-client.ts";
import {
  createFixtureModelClient,
  FixtureExhaustedError,
  FixtureFailureError,
  failWith,
  respondWithText,
  respondWithToolCalls,
} from "./fixture-provider.ts";

function request(system = "system"): ModelRequest {
  return {
    system,
    messages: [{ role: "user", text: "hello" }],
    tools: [],
    maxOutputTokens: 64,
    abortSignal: new AbortController().signal,
  };
}

describe("fixture model client", () => {
  it("replays turns in order", async () => {
    const client = createFixtureModelClient({
      modelId: "fixture:demo",
      turns: [
        respondWithToolCalls("first", [{ callId: "a", toolName: "list", input: {} }]),
        respondWithText("second"),
      ],
    });

    expect((await client.generate(request())).text).toBe("first");
    expect((await client.generate(request())).toolCalls).toEqual([]);
  });

  it("records every request it was given", async () => {
    const client = createFixtureModelClient({
      modelId: "fixture:demo",
      turns: [respondWithText("one"), respondWithText("two")],
    });

    await client.generate(request("first system"));
    await client.generate(request("second system"));

    expect(client.requests.map((entry) => entry.system)).toEqual(["first system", "second system"]);
  });

  it("throws the scripted failure so retry paths can be exercised", async () => {
    const client = createFixtureModelClient({
      modelId: "fixture:demo",
      turns: [failWith("connection reset")],
    });

    await expect(client.generate(request())).rejects.toThrow(FixtureFailureError);
  });

  it("says what to do when the script runs out", async () => {
    const client = createFixtureModelClient({ modelId: "fixture:demo", turns: [] });

    await expect(client.generate(request())).rejects.toThrow(FixtureExhaustedError);
    await expect(client.generate(request())).rejects.toThrow(/Add another turn/);
  });
  it("reports no timings by default, rather than a zero that reads as a measurement", async () => {
    const client = createFixtureModelClient({
      modelId: "fixture:demo",
      turns: [respondWithText("done")],
    });

    expect((await client.generate(request())).performance).toEqual({
      firstTokenMs: null,
      outputTokensPerSecond: null,
      responseTimeMs: 0,
    });
  });

  it("lets a script set the timings, so a calibration run can be driven without a model", async () => {
    const client = createFixtureModelClient({
      modelId: "fixture:demo",
      turns: [
        respondWithText(
          "done",
          { input: 10, output: 40 },
          {
            firstTokenMs: 120,
            outputTokensPerSecond: 33.5,
            responseTimeMs: 1_400,
          },
        ),
      ],
    });

    const response = await client.generate(request());

    expect(response.performance.firstTokenMs).toBe(120);
    expect(response.performance.outputTokensPerSecond).toBe(33.5);
    expect(response.performance.responseTimeMs).toBe(1_400);
  });
});
