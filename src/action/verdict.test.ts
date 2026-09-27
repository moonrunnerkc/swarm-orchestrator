import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalVerdict, type Verdict, verdictSchema } from "./verdict.ts";

const sample: Verdict = {
  schema: "swarm-verify.verdict.v1",
  repository: "owner/repo",
  pullRequest: 1,
  target: "head",
  head: "1".repeat(40),
  eventHead: "1".repeat(40),
  base: "2".repeat(40),
  comparisonBase: "2".repeat(40),
  tree: "3".repeat(40),
  patchDigest: `sha256:${"4".repeat(64)}`,
  verifier: { name: "swarm-verify", version: "1.0.0" },
  policy: {
    isolation: "docker",
    image: "node:24-bookworm",
    goalContractDigest: null,
    oracle: null,
    packages: [],
    install: false,
    requireTask: false,
  },
  execution: {
    eventName: "pull_request",
    runId: "5",
    runAttempt: "1",
    workflowRef: "w",
    runnerEnvironment: "github-hosted",
    executionTrust: "isolated",
  },
  evidence: {
    reportDigest: null,
    summaryDigest: null,
    assessmentDigest: null,
    bundleChainHead: null,
  },
  decision: {
    status: 0,
    verifierStatus: 0,
    result: "verified",
    regression: "pass",
    task: "accepted",
    unmeasured: [],
    reason: null,
  },
};

describe("the verdict document", () => {
  it("renders canonically, so the digest a signer binds is the digest a reader recomputes", () => {
    const one = canonicalVerdict(sample);
    const reordered = canonicalVerdict({
      ...sample,
      decision: { ...sample.decision },
      evidence: { ...sample.evidence },
    });
    expect(reordered.bytes).toBe(one.bytes);
    expect(one.digest).toBe(
      `sha256:${createHash("sha256").update(one.bytes.trimEnd()).digest("hex")}`,
    );
    expect(JSON.parse(one.bytes)).toEqual(sample);
  });

  it("refuses a field it does not declare and a malformed commit id", () => {
    expect(() => verdictSchema.parse({ ...sample, extra: 1 })).toThrow();
    expect(() => verdictSchema.parse({ ...sample, head: "not-a-sha" })).toThrow();
  });
});
