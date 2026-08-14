import { describe, expect, it } from "vitest";
import { canonicalJson, digestOfJson, type JsonValue } from "./canonical-json.ts";
import { type CitedRecord, type ClaimPayload, evaluateClaim } from "./claim.ts";
import { evaluatePredicate, parsePredicate } from "./predicate.ts";
import { recordKindOf } from "./record-kind.ts";
import * as embedded from "./verifier/verify.mjs";

/**
 * The embedded verifier reimplements canonical JSON, the predicate language, and claim
 * evaluation in plain JavaScript, because it must not import anything this package ships.
 * That duplication is the point, and this is what keeps the two honest about each other.
 */

const subject: JsonValue = {
  tests: { collected: 47, failed: 0, suite: "vitest" },
  facts: { exitCode: 0, stdoutBytes: 812 },
  ok: true,
  gates: [{ name: "lint", passed: true }],
};

const predicates = [
  "tests.failed == 0 && tests.collected >= 47",
  "tests.collected >= 48",
  "tests.failed == 0 || tests.collected == 1",
  "(tests.failed == 0 || ok == false) && facts.exitCode == 0",
  'tests.suite == "vitest"',
  "tests.passed == 47",
  "tests.suite > 3",
  'gates.0.name == "lint"',
  "ok == true",
  "tests.failed != 1",
];

describe("the embedded verifier agrees with the implementation it ships beside", () => {
  it("canonicalizes the same bytes", () => {
    const values: JsonValue[] = [
      { b: 1, a: 2 },
      [1, "two", null, true],
      { nested: { z: [1, { y: 2, x: 3 }] } },
      "plain",
      42,
    ];

    for (const value of values) {
      expect(embedded.canonicalJson(value)).toBe(canonicalJson(value));
    }
  });

  it("computes the same digests", () => {
    expect(embedded.sha256(canonicalJson(subject))).toBe(digestOfJson(subject));
  });

  it("evaluates every predicate to the same result", () => {
    for (const source of predicates) {
      const mine = evaluatePredicate(parsePredicate(source), subject);
      const theirs = embedded.evaluatePredicate(embedded.parsePredicate(source), subject);

      expect({ source, ...theirs }).toEqual({ source, ...mine });
    }
  });

  it("rejects the same malformed predicates", () => {
    for (const source of ["", "true", "tests.failed", "tests.failed = 0", "(a == 1"]) {
      expect(() => parsePredicate(source)).toThrow();
      expect(() => embedded.parsePredicate(source)).toThrow();
    }
  });

  it("computes the same record kind, including the subject a type does not name", () => {
    const records: [Parameters<typeof recordKindOf>[0], JsonValue][] = [
      ["gate-run", { gateId: "tests", status: "passed" }],
      ["gate-run", { status: "passed" }],
      ["tool-call", { toolName: "shell" }],
      ["session-stopped", { stopReason: "completed" }],
    ];

    for (const [type, payload] of records) {
      expect(embedded.recordKindOf(type, payload)).toBe(recordKindOf(type, payload));
    }
  });

  it("reaches the same verdict on every way a claim can fail", () => {
    const digest = digestOfJson(subject);
    const cited: CitedRecord = { type: "gate-run", payload: subject };
    const lookup = (candidate: string): CitedRecord | undefined =>
      candidate === digest ? cited : undefined;
    const kind = recordKindOf(cited.type, cited.payload);

    const claims: ClaimPayload[] = [
      { predicate: "tests.failed == 0", record: digest, recordKind: kind, narrative: "" },
      { predicate: "tests.failed == 9", record: digest, recordKind: kind, narrative: "" },
      { predicate: "tests.failed == 0", record: null, recordKind: kind, narrative: "" },
      {
        predicate: "tests.failed == 0",
        record: `sha256:${"3".repeat(64)}`,
        recordKind: kind,
        narrative: "",
      },
      { predicate: "not a predicate", record: digest, recordKind: kind, narrative: "" },
      { predicate: "coverage.lines >= 90", record: digest, recordKind: kind, narrative: "" },
      {
        predicate: "tests.failed == 0",
        record: digest,
        recordKind: "gate-run:tests",
        narrative: "",
      },
      { predicate: "tests.failed == 0", record: digest, recordKind: "escalation", narrative: "" },
    ];

    for (const claim of claims) {
      const mine = evaluateClaim(claim, lookup);
      const theirs = embedded.evaluateClaim(claim, lookup);

      expect({ ...claim, ...theirs, detail: "" }).toEqual({ ...claim, ...mine, detail: "" });
    }
  });
});
