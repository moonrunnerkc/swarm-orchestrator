import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelRequest } from "../core/model-client.ts";
import { createTestClock } from "../core/test-doubles.ts";
import {
  createFixtureModelClient,
  failWith,
  respondWithText,
} from "../providers/fixture-provider.ts";
import { digestOfJson, type JsonValue } from "./canonical-json.ts";
import { createRecordingModelClient } from "./model-call-recording.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-model-calls-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function openSession(): Promise<EvidenceRecorder> {
  return openEvidenceSession({
    root,
    sessionId: "model-call-session",
    clock: createTestClock(1_700_000_000_000),
  });
}

function request(text: string): ModelRequest {
  return {
    system: "you are a coding agent",
    messages: [{ role: "user", text }],
    tools: [],
    maxOutputTokens: 1024,
    abortSignal: new AbortController().signal,
  };
}

describe("model call recording", () => {
  it("records the call with a prompt digest and a response digest", async () => {
    const evidence = await openSession();
    const model = createRecordingModelClient(
      createFixtureModelClient({ modelId: "fixture:one", turns: [respondWithText("hello")] }),
      evidence,
    );

    await model.generate(request("rename the widget"));

    const record = evidence.records()[0];
    expect(record).toMatchObject({ type: "model-call", actor: "fixture:one" });
    expect(record?.promptDigest).toMatch(/^sha256:/);
    expect(record?.responseDigest).toMatch(/^sha256:/);
  });

  it("addresses exactly what it stored, so a rerun can compare digests honestly", async () => {
    const evidence = await openSession();
    const model = createRecordingModelClient(
      createFixtureModelClient({ modelId: "fixture:one", turns: [respondWithText("hello")] }),
      evidence,
    );

    await model.generate(request("rename the widget"));

    const record = evidence.records()[0];
    const payload = (await evidence.blobs.get(record?.payloadDigest ?? "")) as {
      prompt: JsonValue;
      response: JsonValue;
    };
    expect(digestOfJson(payload.prompt)).toBe(record?.promptDigest);
    expect(digestOfJson(payload.response)).toBe(record?.responseDigest);
  });

  it("scrubs the prompt before hashing it, so the digest and the blob agree", async () => {
    const evidence = await openSession();
    const model = createRecordingModelClient(
      createFixtureModelClient({ modelId: "fixture:one", turns: [respondWithText("ok")] }),
      evidence,
    );

    await model.generate(request("deploy with ghp_0123456789abcdefghijklmnopqrstuvwxyz"));

    const record = evidence.records()[0];
    const payload = (await evidence.blobs.get(record?.payloadDigest ?? "")) as {
      prompt: JsonValue;
    };
    expect(JSON.stringify(payload.prompt)).not.toContain("ghp_0123456789");
    expect(digestOfJson(payload.prompt)).toBe(record?.promptDigest);
  });

  it("records a failed call as evidence and still lets the loop see the error", async () => {
    const evidence = await openSession();
    const model = createRecordingModelClient(
      createFixtureModelClient({ modelId: "fixture:one", turns: [failWith("upstream 503")] }),
      evidence,
    );

    await expect(model.generate(request("try"))).rejects.toThrow("upstream 503");

    const payload = (await evidence.blobs.get(evidence.records()[0]?.payloadDigest ?? "")) as {
      response: { failed: boolean; message: string };
    };
    expect(payload.response).toEqual({ failed: true, message: "upstream 503" });
  });

  it("numbers the steps so a reviewer can follow the transcript", async () => {
    const evidence = await openSession();
    const model = createRecordingModelClient(
      createFixtureModelClient({
        modelId: "fixture:one",
        turns: [respondWithText("one"), respondWithText("two")],
      }),
      evidence,
    );

    await model.generate(request("a"));
    await model.generate(request("b"));

    const steps = await Promise.all(
      evidence.records().map(async (record) => {
        const payload = (await evidence.blobs.get(record.payloadDigest)) as { step: number };
        return payload.step;
      }),
    );
    expect(steps).toEqual([1, 2]);
  });
});
