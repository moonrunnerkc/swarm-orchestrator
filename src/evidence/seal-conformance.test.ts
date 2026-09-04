import { describe, expect, it } from "vitest";
import type { JsonValue } from "./canonical-json.ts";
import type { RecordType } from "./ledger-record.ts";
import { sealConformance } from "./verifier/verify.mjs";

/**
 * The verifier holds every gate run to the criteria sealed before the loop. These build a
 * chain by hand, so what is being tested is the rule and not the run that wrote the records.
 */
interface FakeRecord {
  readonly sequence: number;
  readonly type: RecordType;
  readonly payloadDigest: string;
}

function chain(entries: readonly { type: RecordType; payload: JsonValue }[]) {
  const records: FakeRecord[] = [];
  const payloads = new Map<string, JsonValue>();
  entries.forEach((entry, index) => {
    const digest = `sha256:${index}`;
    records.push({ sequence: index + 1, type: entry.type, payloadDigest: digest });
    payloads.set(digest, entry.payload);
  });
  return { records, payloads };
}

const seal = {
  type: "gate-set-sealed" as const,
  payload: {
    criteriaRef: "abc",
    gates: [
      { id: "tests", severity: "blocking", parser: "test-output", command: "node --test" },
      { id: "lint", severity: "blocking", parser: "exit-code", command: "npm run lint" },
    ],
  },
};

function gateRun(gateId: string, attempt: number, command?: string) {
  const declared = seal.payload.gates.find((gate) => gate.id === gateId);
  if (declared === undefined) {
    throw new Error(`the seal names no ${gateId} gate`);
  }
  return {
    type: "gate-run" as const,
    payload: {
      gateId,
      severity: "blocking",
      parser: declared.parser,
      command: command ?? declared.command,
      attempt,
    },
  };
}

describe("holding a gate run to the sealed command", () => {
  it("names a run whose command is not the one the seal declared", () => {
    const { records, payloads } = chain([
      seal,
      gateRun("tests", 0, "npm run --silent test"),
      gateRun("lint", 0),
    ]);

    const { problems } = sealConformance(records, payloads);

    expect(problems).toEqual([
      "record 2 ran tests as `npm run --silent test`; the seal declared `node --test`",
    ]);
  });
});

describe("a gate run over the base tree", () => {
  it("has to be a sealed gate, and is not part of any cycle", () => {
    const { records, payloads } = chain([
      seal,
      { ...gateRun("tests", 0), type: "gate-baseline" as const },
      { ...gateRun("lint", 0), type: "gate-baseline" as const },
      gateRun("tests", 0),
      gateRun("lint", 0),
      {
        type: "gate-baseline" as const,
        payload: {
          gateId: "spelling",
          severity: "blocking",
          parser: "exit-code",
          command: "x",
          attempt: 0,
        },
      },
    ]);

    const { problems } = sealConformance(records, payloads);

    expect(problems).toEqual(["record 6 ran gate spelling, which the seal does not name"]);
  });

  it("does not stand in for a sealed gate missing from the final cycle", () => {
    const { records, payloads } = chain([
      seal,
      gateRun("lint", 0),
      { ...gateRun("tests", 0), type: "gate-baseline" as const },
    ]);

    expect(sealConformance(records, payloads).problems).toEqual([
      "sealed gate tests did not run in the final attempt",
    ]);
  });
});

describe("the final cycle of a chain that holds more than one", () => {
  it("is the last run of gate records under one attempt, so a later turn cannot drop a gate", () => {
    // Turn one retried once and ran every gate; turn two ran only lint. The highest attempt
    // number on the chain belongs to turn one, whose cycle was complete.
    const { records, payloads } = chain([
      seal,
      gateRun("tests", 0),
      gateRun("lint", 0),
      gateRun("tests", 1),
      gateRun("lint", 1),
      gateRun("lint", 0),
    ]);

    const { problems } = sealConformance(records, payloads);

    expect(problems).toEqual(["sealed gate tests did not run in the final attempt"]);
  });

  it("accepts a second turn that ran every sealed gate", () => {
    const { records, payloads } = chain([
      seal,
      gateRun("tests", 0),
      gateRun("lint", 0),
      gateRun("tests", 1),
      gateRun("lint", 1),
      gateRun("tests", 0),
      gateRun("lint", 0),
    ]);

    expect(sealConformance(records, payloads).problems).toEqual([]);
  });
});
