import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { judgeFix, readBundle, runFacts, verifyBundle } from "./results.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const liveLocal = join(repositoryRoot, "docs", "evidence", "2026-08-18", "live-local");

const scratch = [];
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("reading a committed run bundle", () => {
  it("reads the executed flag off the model calls, and the gates off their records", () => {
    const facts = runFacts(readBundle(liveLocal));

    expect(facts.records).toBeGreaterThan(40);
    expect(facts.modelCalls).toBeGreaterThan(0);
    expect(facts.executed).toBe(true);
    expect(facts.answeredTurns).toBeLessThanOrEqual(facts.modelCalls);
    expect(facts.stopReasons).toEqual(["completed"]);
    expect(Object.keys(facts.gates)).toContain("tests");
    expect(facts.claims).toEqual({ verified: expect.any(Number), unverified: expect.any(Number) });
    expect(facts.signedWith).toBe("keychain");
  });

  it("answers null for a directory that holds no bundle", () => {
    expect(readBundle(join(repositoryRoot, "campaign"))).toBeNull();
  });

  it("reads a run whose model never answered as not executed", () => {
    const bundle = {
      records: [
        { type: "model-call", payloadDigest: "sha256:a" },
        { type: "session-stopped", payloadDigest: "sha256:b" },
      ],
      manifest: { claims: { verified: 0, unverified: 0 }, signature: { keySource: "ephemeral" } },
      payload: (record) =>
        record.payloadDigest === "sha256:a"
          ? { response: { text: "   ", toolCalls: [] } }
          : { stopReason: "model-error" },
    };

    const facts = runFacts(bundle);

    expect(facts.executed).toBe(false);
    expect(facts.answeredTurns).toBe(0);
    expect(facts.stopReasons).toEqual(["model-error"]);
    expect(facts.settledGreen).toBe(false);
  });

  it("reads an escalation as not green, whatever the last gate run said", () => {
    const bundle = {
      records: [
        { type: "gate-run", payloadDigest: "sha256:g" },
        { type: "escalation", payloadDigest: "sha256:e" },
      ],
      manifest: { claims: { verified: 0, unverified: 0 }, signature: {} },
      payload: (record) =>
        record.payloadDigest === "sha256:g"
          ? { gateId: "tests", status: "failed", severity: "blocking", attempt: 1, detail: "1 failed" }
          : { gateId: "tests", attemptsUsed: 1, cap: 1 },
    };

    const facts = runFacts(bundle);

    expect(facts.blockingFailed).toEqual(["tests"]);
    expect(facts.escalations).toEqual([{ gateId: "tests", attemptsUsed: 1, cap: 1 }]);
    expect(facts.settledGreen).toBe(false);
  });
});

describe("verifying a bundle from here", () => {
  it("runs the verifier the bundle carries and reads its exit code", () => {
    expect(verifyBundle(liveLocal).exitCode).toBe(0);
  });

  it("reports a refused bundle by exit code rather than by trusting the manifest", () => {
    const copy = join(mkdtempSync(join(tmpdir(), "results-test-")), "tampered");
    scratch.push(join(copy, ".."));
    cpSync(liveLocal, copy, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(copy, "manifest.json"), "utf8"));
    writeFileSync(join(copy, "manifest.json"), JSON.stringify({ ...manifest, recordCount: 1 }));

    const verified = verifyBundle(copy);

    expect(verified.exitCode).toBe(1);
    expect(verified.output).toContain("FAIL");
  });
});

describe("judging what became of the seed", () => {
  it("names each outcome by what was measured", () => {
    expect(judgeFix({ suiteOutcome: "test-failure", testFilesChanged: [], seedLineRestored: false })).toBe("not-fixed");
    expect(judgeFix({ suiteOutcome: "passed", testFilesChanged: ["test/a.test.js"], seedLineRestored: true })).toBe("green-with-test-edits");
    expect(judgeFix({ suiteOutcome: "passed", testFilesChanged: [], seedLineRestored: true })).toBe("fixed-by-restoring-the-line");
    expect(judgeFix({ suiteOutcome: "passed", testFilesChanged: [], seedLineRestored: false })).toBe("fixed-another-way");
  });
});
