import { describe, expect, it } from "vitest";
import { canonicalJson, digestOfJson, type JsonValue } from "./canonical-json.ts";
import { type CitedRecord, type ClaimPayload, evaluateClaim } from "./claim.ts";
import { evaluatePredicate, parsePredicate } from "./predicate.ts";
import { indexCitedRecords } from "./record-index.ts";
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
      ["attempt-selection", { taskId: "task-1", winner: "task-1-attempt-2" }],
      ["attempt-selection", { winner: "task-1-attempt-2" }],
    ];

    for (const [type, payload] of records) {
      expect(embedded.recordKindOf(type, payload)).toBe(recordKindOf(type, payload));
    }
  });

  it("resolves a cited digest to the same records, in the same order", () => {
    // The binding a claim carries is a sequence on this chain, so the two implementations
    // have to agree about which record sits there before they can agree about any verdict.
    const twin: JsonValue = { gateId: "tests", status: "passed", toolName: "shell" };
    const digest = digestOfJson(twin);
    const records = [
      { sequence: 0, type: "tool-call" as const, payloadDigest: digest },
      { sequence: 1, type: "gate-run" as const, payloadDigest: digest },
      { sequence: 2, type: "gate-run" as const, payloadDigest: `sha256:${"5".repeat(64)}` },
    ];
    const payloads = new Map<string, JsonValue>([[digest, twin]]);

    const mine = indexCitedRecords(records, payloads);
    const theirs = embedded.indexCitedRecords(records, payloads);

    expect([...theirs.keys()]).toEqual([...mine.keys()]);
    expect(theirs.get(digest)?.carriers).toEqual(mine.get(digest)?.carriers);
    // And the verdicts each index produces for the same claim.
    for (const recordSequence of [0, 1, 7, null]) {
      const claim: ClaimPayload = {
        predicate: 'status == "passed"',
        record: digest,
        recordKind: "gate-run:tests",
        recordSequence,
        narrative: "",
      };
      expect({
        recordSequence,
        ...embedded.evaluateClaim(claim, (cited: string) => theirs.get(cited)),
        detail: "",
      }).toEqual({
        recordSequence,
        ...evaluateClaim(claim, (cited) => mine.get(cited)),
        detail: "",
      });
    }
  });

  it("reaches the same verdict on every way a claim can fail", () => {
    const digest = digestOfJson(subject);
    const kind = recordKindOf("gate-run", subject);
    const cited: CitedRecord = { carriers: [{ sequence: 4, kind }], payload: subject };
    const collidedDigest = `sha256:${"7".repeat(64)}`;
    const collided: CitedRecord = {
      carriers: [
        { sequence: 1, kind: "tool-call:shell" },
        { sequence: 2, kind },
      ],
      payload: subject,
    };
    const lookup = (candidate: string): CitedRecord | undefined =>
      candidate === digest ? cited : candidate === collidedDigest ? collided : undefined;

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
      // A digest two writers already shared when the claim was submitted names neither of
      // them, so the harness bound the claim to nothing, in both implementations.
      {
        predicate: "tests.failed == 0",
        record: collidedDigest,
        recordKind: kind,
        recordSequence: null,
        narrative: "",
      },
      // The same digest, cited by a claim bound before the second writer existed. Both read
      // the binding rather than the collision.
      {
        predicate: "tests.failed == 0",
        record: collidedDigest,
        recordKind: "tool-call:shell",
        recordSequence: 1,
        narrative: "",
      },
      // A binding naming a record no chain carries resolves to nothing at all.
      {
        predicate: "tests.failed == 0",
        record: digest,
        recordKind: kind,
        recordSequence: 9,
        narrative: "",
      },
    ];

    for (const claim of claims) {
      const mine = evaluateClaim(claim, lookup);
      const theirs = embedded.evaluateClaim(claim, lookup);

      expect({ ...claim, ...theirs, detail: "" }).toEqual({ ...claim, ...mine, detail: "" });
    }
  });
});
