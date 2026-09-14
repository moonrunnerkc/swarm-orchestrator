import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import { evaluateClaim } from "./claim.ts";
import { indexCitedRecords } from "./record-index.ts";
import { recordRoutineClaims } from "./routine-claims.ts";
import { openEvidenceSession } from "./session.ts";

it("never treats model prose as an observed fact and preserves ambiguous digest refusal", async () => {
  const root = await mkdtemp(join(tmpdir(), "swarm-routine-"));
  try {
    const evidence = await openEvidenceSession({
      root,
      sessionId: "facts",
      clock: createTestClock(),
    });
    const invented = await evidence.record({
      type: "gate-run",
      actor: "model",
      provenance: ["model"],
      payload: { gateId: "invented", status: "passed" },
    });
    const payload = { gateId: "tests", status: "passed" };
    const gate = await evidence.record({
      type: "gate-run",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    await evidence.record({
      type: "session-stopped",
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
    await recordRoutineClaims(evidence, [invented.record.payloadDigest, gate.record.payloadDigest]);
    const claims = evidence.records().filter((record) => record.type === "claim");
    expect(claims).toHaveLength(1);
    const claim = evidence.payloads().get(claims[0]?.payloadDigest ?? "");
    expect(claim).toMatchObject({ recordSequence: null, recordKind: "gate-run:tests" });
    const index = indexCitedRecords(evidence.records(), evidence.payloads());
    const evaluation = evaluateClaim(
      {
        predicate: 'status == "passed"',
        record: gate.record.payloadDigest,
        recordKind: "gate-run:tests",
        narrative: "",
        recordSequence: null,
      },
      (digest) => index.get(digest),
    );
    expect(evaluation.verdict).toBe("unverified");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
