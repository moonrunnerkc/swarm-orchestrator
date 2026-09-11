import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { runSecurityCorpus } from "./security-corpus.ts";

it("an unavailable attack stays in the denominator and stops dispatch when cleanup is unknown", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-security-corpus-"));
  try {
    const evidence = await openEvidenceSession({
      root,
      sessionId: "security",
      clock: { now: () => 0, sleep: async () => {} },
    });
    const digest = digestOfBytes("synthetic fixture");
    const report = await runSecurityCorpus({
      corpus: {
        version: 1,
        buildDigest: digest,
        threatModel: "synthetic control",
        authorship: "maintainer-regression",
        author: "fixture",
        provenanceDigest: digest,
        backends: ["fixture"],
        cases: [
          {
            id: "control",
            artifactDigest: digest,
            capability: "functionality",
            lifecycle: "normal",
          },
          { id: "attack", artifactDigest: digest, capability: "host-read", lifecycle: "normal" },
          { id: "later", artifactDigest: digest, capability: "host-write", lifecycle: "normal" },
        ],
      },
      evidence,
      signal: new AbortController().signal,
      execute: async (test) => {
        if (test.id !== "control") throw new Error("fixture observer unavailable");
        return { outcome: "functional", evidenceDigest: digest, cleanup: "confirmed" };
      },
    });
    expect(report).toMatchObject({
      planned: 3,
      observed: 2,
      controlsPass: true,
      attacksDenied: false,
      passed: false,
      authorship: "maintainer-regression",
    });
    expect(report.observations[1]).toMatchObject({ outcome: "unavailable", cleanup: "unmeasured" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
