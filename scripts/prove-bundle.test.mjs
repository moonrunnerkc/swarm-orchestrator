import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseRecordToTamper,
  expectedChainFailure,
  flipOneTimestampDigit,
  judgeArms,
  proveBundle,
} from "./prove-bundle.mjs";

const repositoryRoot = join(import.meta.dirname, "..");
const referenceBundle = join(repositoryRoot, "docs", "evidence", "2026-08-18", "live-frontier");

const scratchDirectories = [];
afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scratch() {
  const directory = mkdtempSync(join(tmpdir(), "prove-bundle-test-"));
  scratchDirectories.push(directory);
  return directory;
}

function ledgerOf(...records) {
  return Buffer.from(`${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "latin1");
}

describe("choosing the record to tamper", () => {
  it("never chooses the last record, so a link and not only the head is what breaks", () => {
    expect(chooseRecordToTamper(2)).toBe(0);
    expect(chooseRecordToTamper(3)).toBe(1);
    expect(chooseRecordToTamper(42)).toBe(20);
  });

  it("refuses a ledger with no link in it", () => {
    expect(() => chooseRecordToTamper(1)).toThrow("needs at least two");
    expect(() => chooseRecordToTamper(0)).toThrow("needs at least two");
  });
});

describe("flipping one digit", () => {
  it("changes exactly one byte, inside the chosen record's timestamp", () => {
    const original = ledgerOf(
      { sequence: 0, timestamp: 1700000000008 },
      { sequence: 1, timestamp: 1700000000018 },
      { sequence: 2, timestamp: 1700000000028 },
    );

    const flipped = flipOneTimestampDigit(original);

    expect(flipped.recordIndex).toBe(1);
    expect(flipped.ledgerBytes.length).toBe(original.length);
    const differing = [...original].filter((byte, index) => byte !== flipped.ledgerBytes[index]);
    expect(differing).toHaveLength(1);
    const changedLine = flipped.ledgerBytes.toString("latin1").split("\n")[1];
    expect(changedLine).toContain('"timestamp":1700000000017');
    expect(flipped.before).toBe("8");
    expect(flipped.after).toBe("7");
  });

  it("refuses a record that carries no timestamp", () => {
    const original = ledgerOf({ sequence: 0, timestamp: 1 }, { sequence: 1 }, { sequence: 2 });
    expect(() => flipOneTimestampDigit(original)).toThrow("record 1 carries no timestamp");
  });
});

describe("judging the two arms", () => {
  const refused = (recordIndex) => ({
    exitCode: 1,
    recordIndex,
    output: `  FAIL  hash chain intact: ${expectedChainFailure(recordIndex)} sha256:aa, but the record before it hashes to sha256:bb\n`,
  });

  it("holds only where the reference verifies and the copy is refused by the chain", () => {
    expect(judgeArms({ reference: { exitCode: 0, output: "" }, tampered: refused(20) })).toEqual({
      passed: true,
      problems: [],
    });
  });

  it("fails when the reference bundle itself does not verify", () => {
    const verdict = judgeArms({ reference: { exitCode: 1, output: "" }, tampered: refused(20) });
    expect(verdict.passed).toBe(false);
    expect(verdict.problems).toEqual(["the reference bundle did not verify: its verifier exited 1"]);
  });

  it("fails when the tampered copy verifies, which is a verifier that cannot say no", () => {
    const verdict = judgeArms({
      reference: { exitCode: 0, output: "" },
      tampered: { exitCode: 0, recordIndex: 20, output: "bundle verified: every check passed\n" },
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.problems[0]).toContain("the tampered copy verified");
    expect(verdict.problems[0]).toContain("record 20");
  });

  it("fails when the copy is refused for a reason other than the broken link", () => {
    const verdict = judgeArms({
      reference: { exitCode: 0, output: "" },
      tampered: { exitCode: 1, recordIndex: 20, output: "  FAIL  ledger parses: line 21\n" },
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.problems[0]).toContain("not by the hash chain");
    expect(verdict.problems[0]).toContain("record 21 carries previousHash");
  });
});

describe("over a committed bundle and its own verifier", () => {
  it("holds for the bundle the tamper demonstration used", () => {
    const transcript = [];

    const verdict = proveBundle(referenceBundle, (line) => transcript.push(line));

    expect(verdict).toEqual({ passed: true, problems: [] });
    const text = transcript.join("\n");
    expect(text).toContain("bundle verified: every check passed");
    expect(text).toContain("FAIL  hash chain intact: record 21 carries previousHash");
    expect(text).toContain("proof holds");
  });

  it("leaves the committed bundle untouched", () => {
    const before = readFileSync(join(referenceBundle, "ledger.jsonl"));

    proveBundle(referenceBundle, () => {});

    expect(readFileSync(join(referenceBundle, "ledger.jsonl")).equals(before)).toBe(true);
  });

  /** The proof's own bond: a verifier that says yes to everything must fail it. */
  it("fails against a bundle whose verifier cannot say no", () => {
    const copy = join(scratch(), "agreeable");
    cpSync(referenceBundle, copy, { recursive: true });
    writeFileSync(
      join(copy, "verify.mjs"),
      'console.log("bundle verified: every check passed");\nprocess.exit(0);\n',
    );
    const transcript = [];

    const verdict = proveBundle(copy, (line) => transcript.push(line));

    expect(verdict.passed).toBe(false);
    expect(verdict.problems).toEqual([
      "the tampered copy verified: one changed byte in record 20 went unnoticed, so this verifier cannot say no",
    ]);
    expect(transcript.join("\n")).toContain("proof FAILED");
  });
});
