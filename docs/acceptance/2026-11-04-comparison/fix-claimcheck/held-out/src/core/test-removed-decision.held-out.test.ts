// Held out from the agent. The decide() case claimcheck's fix commit e050152 added to
// src/core/decision.test.ts, verbatim, with the helpers it uses copied from that file.
import { describe, expect, it } from "vitest";
import { decide } from "./decision.js";
import type {
  EvidenceRecord,
  MutantOutcome,
  AssertionReach,
} from "./evidence-record.js";

function honestRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    baseSha: "parent",
    headSha: "head",
    changedRanges: [{ file: "src/calc.ts", start: 5, end: 5 }],
    headTestsPass: true,
    coverageCollected: true,
    failsOnParent: "failed",
    coveredChangedLines: [{ file: "src/calc.ts", start: 5, end: 5 }],
    mutants: [killedNoop()],
    taint: [reaches()],
    nondeterminism: [],
    regressions: [],
    errorSuppressions: [],
    testWeakenings: [],
    staticTail: [],
    vacuousAssertions: [],
    quarantined: [],
    toolVersion: "0.1.0",
    ...overrides,
  };
}

function killedNoop(): MutantOutcome {
  return {
    id: "m-noop",
    file: "src/calc.ts",
    startLine: 5,
    startColumn: 1,
    endLine: 5,
    endColumn: 20,
    mutator: "BlockStatement",
    replacement: "{}",
    status: "killed",
    prefilter: "none",
    noopOrInversion: true,
  };
}

function reaches(): AssertionReach {
  return {
    file: "src/calc.ts",
    line: 5,
    column: 3,
    expression: "a + b",
    reachesAssertion: true,
    chain: ["a + b", "result", "expect(result)"],
  };
}

function findCheck(record: EvidenceRecord, id: string) {
  const verdict = decide(record);
  const check = verdict.checks.find((c) => c.id === id);
  if (!check) throw new Error(`no check ${id}`);
  return { verdict, check };
}

describe("decide, held out", () => {
  it("only warns when a whole test was removed, since deletion is ambiguous", () => {
    const { verdict, check } = findCheck(
      honestRecord({
        testWeakenings: [
          {
            file: "test/calc.test.ts",
            line: 1,
            kind: "test-removed",
            detail: "1 test(s) removed",
          },
        ],
      }),
      "test-weakening",
    );
    expect(check.tier).toBe("warn");
    expect(verdict.tier).not.toBe("block");
  });
});
