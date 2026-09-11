import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { canonicalJson, type JsonValue } from "./canonical-json.ts";
import { openEvidenceSession } from "./session.ts";
import { reconstructTranscript, recordTranscript } from "./transcript.ts";

it("reconstructs exact prompts while storing growing histories once", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-transcript-"));
  try {
    const evidence = await openEvidenceSession({
      root,
      sessionId: "transcript",
      clock: { now: () => 0, sleep: async () => {} },
    });
    const messages: JsonValue[] = [];
    let inlineBytes = 0;
    let referenceBytes = 0;
    for (let turn = 0; turn < 40; turn += 1) {
      messages.push({ role: "user", text: `${turn}: ${"sample prose ".repeat(200)}` });
      const prompt = {
        system: "test",
        tools: [],
        messages: [...messages],
        maxOutputTokens: 100,
        sampling: null,
      };
      const reference = await recordTranscript(evidence, prompt);
      inlineBytes += canonicalJson(prompt).length;
      referenceBytes += canonicalJson(reference).length;
      expect(reconstructTranscript(reference, evidence.payloads())).toEqual(prompt);
    }
    const stored =
      [...evidence.payloads().values()].reduce<number>(
        (sum, payload) => sum + canonicalJson(payload).length,
        0,
      ) + referenceBytes;
    expect(stored).toBeLessThan(inlineBytes / 10);
    expect(evidence.records()).toHaveLength(42);
    const reference = await recordTranscript(evidence, {
      system: "test",
      tools: [],
      messages,
      maxOutputTokens: 100,
      sampling: null,
    });
    const damaged = new Map(evidence.payloads());
    damaged.delete(evidence.records().at(-1)?.payloadDigest ?? "");
    expect(() => reconstructTranscript(reference, damaged)).toThrow(/missing/);
    expect(reconstructTranscript({ messages: [] }, new Map())).toEqual({ messages: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
