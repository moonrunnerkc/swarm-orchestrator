import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixedRandom, createTestClock } from "../core/test-doubles.ts";
import { createRecordingModelClient } from "../evidence/model-call-recording.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { parseModelSpec } from "../providers/model-spec.ts";
import { createProviderRegistry } from "../providers/registry.ts";
import { calibrationSampling, seedForRepeat } from "./calibration-run.ts";

/**
 * The settings a calibration run is measured under have to be two things at once: what the
 * backend was actually asked for, and what the bundle says it was asked for. Testing either
 * alone leaves the gap where the two disagree, which is the gap a report of a distribution
 * lands in: a temperature the SDK dropped and a temperature the ledger asserts read the same
 * to everyone downstream.
 */

let root = "";
let evidence: EvidenceRecorder;
const clock = createTestClock();

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-sampling-"));
  evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: createSessionId(clock, createFixedRandom()),
    clock,
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface WireCall {
  readonly body: Record<string, unknown>;
}

/** One local call through the real adapter, with the bodies it put on the wire captured. */
async function callLocalModel(options: {
  readonly seed: number | null;
  readonly warnUnsupportedSeed?: boolean;
}): Promise<{ readonly wire: readonly WireCall[]; readonly recorded: Record<string, unknown> }> {
  const wire: WireCall[] = [];
  const registry = createProviderRegistry({
    localBaseUrl: "http://127.0.0.1:11434/v1",
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      wire.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      const frames = [
        'data: {"choices":[{"delta":{"content":"ok"},"index":0}]}\n\n',
        'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}],' +
          '"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}\n\n',
        "data: [DONE]\n\n",
      ];
      return new Response(frames.join(""), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as typeof fetch,
  });

  const model = createRecordingModelClient(
    registry.create(parseModelSpec("local:qwen3.6:35b-a3b")),
    evidence,
  );

  await model.generate({
    system: "you are a coding agent",
    messages: [{ role: "user", text: "make greet shout" }],
    tools: [],
    maxOutputTokens: 4096,
    sampling: { ...calibrationSampling, seed: options.seed },
    abortSignal: new AbortController().signal,
  });

  const payloads = evidence.payloads();
  const call = evidence.records().find((record) => record.type === "model-call");
  if (call === undefined) {
    throw new Error("no model-call record was written");
  }
  return { wire, recorded: payloads.get(call.payloadDigest) as Record<string, unknown> };
}

describe("the decoding settings a calibration run is measured under", () => {
  it("puts the pinned temperature, top_p and seed on the wire", async () => {
    const seed = seedForRepeat("edit-loud-greeting", "local:qwen3.6:35b-a3b", 2);
    const { wire } = await callLocalModel({ seed });

    expect(wire).toHaveLength(1);
    expect(wire[0]?.body).toMatchObject({
      temperature: calibrationSampling.temperature,
      top_p: calibrationSampling.topP,
      seed,
    });
  });

  it("records the same three values in the ledger entry for that call", async () => {
    const seed = seedForRepeat("edit-loud-greeting", "local:qwen3.6:35b-a3b", 2);
    const { wire, recorded } = await callLocalModel({ seed });

    const prompt = recorded.prompt as { sampling: Record<string, unknown> };
    expect(prompt.sampling).toEqual({
      temperature: calibrationSampling.temperature,
      topP: calibrationSampling.topP,
      seed,
    });
    // Same numbers, both places: a ledger entry that agrees with itself and not with the wire
    // is the failure this pair of assertions exists to catch.
    expect(wire[0]?.body).toMatchObject({
      temperature: prompt.sampling.temperature,
      top_p: prompt.sampling.topP,
      seed: prompt.sampling.seed,
    });
  });

  it("leaves decoding stochastic, because a spread is what is being measured", () => {
    expect(calibrationSampling.temperature).toBeGreaterThan(0);
  });

  it("gives a distinct seed to each repeat of one case and model", () => {
    const seeds = [1, 2, 3].map((repeat) => seedForRepeat("case-a", "local:m", repeat));

    expect(new Set(seeds).size).toBe(3);
  });

  it("records what the backend would not take, so a seed is never read as one that applied", async () => {
    const { recorded } = await callLocalModel({ seed: 522_856_934 });

    // Empty against a backend that took everything. The field being present at all is the
    // point: a run whose backend drops the seed says so here rather than leaving the seed in
    // the prompt record implying a replay nobody can perform.
    expect(recorded.unsupportedFeatures).toEqual([]);
  });

  it("sends no sampling fields at all when the caller pinned none", async () => {
    const wire: WireCall[] = [];
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:11434/v1",
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        wire.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return new Response("data: [DONE]\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });

    await registry.create(parseModelSpec("local:qwen3.6:35b-a3b")).generate({
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      tools: [],
      maxOutputTokens: 16,
      abortSignal: new AbortController().signal,
    });

    expect(wire[0]?.body).not.toHaveProperty("temperature");
    expect(wire[0]?.body).not.toHaveProperty("top_p");
    expect(wire[0]?.body).not.toHaveProperty("seed");
  });
});
