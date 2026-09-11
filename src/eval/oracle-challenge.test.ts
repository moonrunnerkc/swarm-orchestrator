import { expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { admitOracleChallenge, freezeChallengeRegistry } from "./oracle-challenge.ts";

const digest = digestOfBytes("fixture");
function challenge() {
  const pass = { status: "passed", evidenceDigest: digest };
  return {
    version: 1,
    repository: "repo",
    baseCommit: "abc",
    author: "independent fixture author",
    exposure: "held-out",
    oracle: { artifactDigest: digest, argv: ["node", "check.mjs"] },
    heldBack: { artifactDigest: digest, argv: ["node", "held-back.mjs"] },
    referencePatch: digest,
    counterexamplePatch: digest,
    reference: { regression: pass, supplied: pass, heldBack: pass },
    counterexample: {
      regression: pass,
      supplied: pass,
      heldBack: { status: "assertion-failed", evidenceDigest: digest },
    },
  };
}
it("admits an instrument before grading and rejects duplicate oracle identities", () => {
  expect(admitOracleChallenge(challenge()).oracleId).toMatch(/^sha256:/);
  expect(() => freezeChallengeRegistry([challenge(), challenge()])).toThrow(/duplicate oracle/);
});
it("does not admit unavailable or load-error controls as assertion failures", () => {
  const proposed = challenge();
  proposed.counterexample.heldBack.status = "load-error";
  expect(() => admitOracleChallenge(proposed)).toThrow(/assertion failure/);
});
it("refusing every patch cannot win the frozen challenge population", async () => {
  const { gradeChallengeRegistry } = await import("./oracle-challenge.ts");
  const oracleId = admitOracleChallenge(challenge()).oracleId;
  const row = { oracleId, reference: "refused", counterexample: "refused", evidenceDigest: digest };
  expect(gradeChallengeRegistry([challenge()], [row])).toMatchObject({
    admitted: 1,
    validPatchAccepted: 0,
    counterexampleRefused: 1,
    bothCorrect: 0,
    missing: [],
  });
  expect(gradeChallengeRegistry([challenge()], []).missing).toEqual([oracleId]);
  expect(() => gradeChallengeRegistry([challenge()], [row, row])).toThrow(/duplicate/);
});
