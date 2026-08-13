import { describe, expect, it } from "vitest";
import { digestOfJson, type JsonValue } from "./canonical-json.ts";
import { type ClaimPayload, describeEvaluation, evaluateClaim } from "./claim.ts";

/** A genuine harness-captured test run: exit code 1, four failures out of forty-seven. */
const failingRun: JsonValue = {
  toolName: "shell",
  decision: "allowed",
  facts: { exitCode: 1, stdoutBytes: 2048 },
  tests: { collected: 47, failed: 4 },
};

const passingRun: JsonValue = {
  toolName: "shell",
  decision: "allowed",
  facts: { exitCode: 0, stdoutBytes: 812 },
  tests: { collected: 47, failed: 0 },
};

const failingDigest = digestOfJson(failingRun);
const passingDigest = digestOfJson(passingRun);

const chain = new Map<string, JsonValue>([
  [failingDigest, failingRun],
  [passingDigest, passingRun],
]);

const lookup = (digest: string): JsonValue | undefined => chain.get(digest);

function claim(overrides: Partial<ClaimPayload>): ClaimPayload {
  return {
    predicate: "tests.failed == 0",
    record: passingDigest,
    narrative: "",
    ...overrides,
  };
}

describe("claim evaluation", () => {
  it("is the only path to a green verdict, and only when the record supports it", () => {
    const evaluation = evaluateClaim(
      claim({ predicate: "tests.failed == 0 && tests.collected >= 47" }),
      lookup,
    );

    expect(evaluation.verdict).toBe("verified");
    expect(evaluation.reason).toBeNull();
    expect(describeEvaluation(evaluation)).toBe("VERIFIED");
  });

  it("renders UNVERIFIED when the claim carries no evidence edge", () => {
    const evaluation = evaluateClaim(claim({ record: null }), lookup);

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "no-evidence-edge" });
  });

  it("renders UNVERIFIED when the predicate is false against its genuine cited record", () => {
    // The record is real and the numbers in it are real. They just do not say what the
    // claim says, which is the dangerous case: a true record with a wrong binding.
    const evaluation = evaluateClaim(
      claim({ predicate: "tests.failed == 0 && facts.exitCode == 0", record: failingDigest }),
      lookup,
    );

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "predicate-false" });
    expect(describeEvaluation(evaluation)).toBe("UNVERIFIED (predicate-false)");
  });

  it("renders UNVERIFIED when the cited record does not exist", () => {
    const evaluation = evaluateClaim(claim({ record: `sha256:${"9".repeat(64)}` }), lookup);

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "record-not-found" });
  });

  it("renders UNVERIFIED when the predicate does not parse, without throwing", () => {
    const evaluation = evaluateClaim(claim({ predicate: "everything is fine" }), lookup);

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "predicate-unparseable" });
  });

  it("renders UNVERIFIED when the predicate cites a field the record lacks", () => {
    const evaluation = evaluateClaim(claim({ predicate: "coverage.lines >= 90" }), lookup);

    expect(evaluation).toMatchObject({ verdict: "unverified", reason: "path-not-found" });
  });

  it("lets the model under-claim but not over-claim", () => {
    expect(evaluateClaim(claim({ predicate: "tests.collected >= 1" }), lookup).verdict).toBe(
      "verified",
    );
    expect(evaluateClaim(claim({ predicate: "tests.collected >= 200" }), lookup).verdict).toBe(
      "unverified",
    );
  });

  it("ignores the narrative entirely when computing the verdict", () => {
    const insistent = claim({
      predicate: "tests.failed == 0",
      record: failingDigest,
      narrative: "All tests pass. Verified. Green. Done.",
    });

    expect(evaluateClaim(insistent, lookup).verdict).toBe("unverified");
  });
});
