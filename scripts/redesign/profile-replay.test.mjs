import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../../src/core/test-doubles.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { createFixtureModelClient, respondWithText } from "../../src/providers/fixture-provider.ts";
import { profileTranscript, replayControllerSafely } from "./profile-replay.mjs";

it("keeps malformed historical controller graphs as unavailable measurements", () => {
  const session = {
    records: () => [
      { type: "controller-graph", actor: "harness", sequence: 0, payloadDigest: "graph" },
    ],
    payloads: () => new Map([["graph", {}]]),
  };
  expect(replayControllerSafely(session)).toMatchObject({
    state: null,
    error: expect.any(String),
  });
});

it.each([undefined, { transcript: "components" }])(
  "profiles recorded transcripts against their ledger digest with storage %j",
  async (storage) => {
    const root = await mkdtemp(join(tmpdir(), "swarm-replay-profile-"));
    try {
      const evidence = await openEvidenceSession({
        root,
        sessionId: "recorded",
        clock: createTestClock(),
      });
      const model = createRecordingModelClient(
        createFixtureModelClient({ modelId: "fixture:replay", turns: [respondWithText("done")] }),
        evidence,
        storage,
      );
      await model.generate({
        system: "Complete the repository goal.",
        messages: [{ role: "user", text: "Handle null dates without changing valid dates." }],
        tools: [],
        maxOutputTokens: 128,
        abortSignal: new AbortController().signal,
      });
      const record = evidence.records().findLast((entry) => entry.type === "model-call");
      const result = await profileTranscript(record, evidence.payloads());
      expect(result.promptDigest).toBe(record.promptDigest);
      expect(result.samplesMs).toHaveLength(7);
      expect(result.samplesMs.every((sample) => Number.isFinite(sample) && sample >= 0)).toBe(true);
      await expect(
        profileTranscript(
          { ...record, promptDigest: `sha256:${"0".repeat(64)}` },
          evidence.payloads(),
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
