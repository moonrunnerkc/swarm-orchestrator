import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runnerWitnessHeld as derivedHeld } from "../evidence/verifier/status.mjs";
import type { GateObservation } from "./gate-definition.ts";
import type { InstrumentObservation } from "./instrument-identity.ts";
import {
  type RunnerWitness,
  runnerSourceChanges,
  runnerWitnessHeld,
  withWitnesses,
  witnessTest,
} from "./runner-witness.ts";

const digest = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;

/** A runner's source file changed, reached as code its program loads and loaded by its tests. */
const runnerSource: InstrumentObservation = {
  rule: "instrument-identity-v1",
  tools: [],
  files: [
    { path: "bin/run.mjs", reference: digest(1), current: digest(1) },
    { path: "lib/report.mjs", reference: digest(2), current: digest(3) },
  ],
  dependencies: [],
  installed: [],
  complete: true,
  residuals: [],
  programCode: ["bin/run.mjs", "lib/report.mjs"],
  programSubjects: ["lib/report.mjs"],
};

const observed = (stdout: string, exitCode = 1, extra: Partial<GateObservation> = {}) => ({
  exitCode,
  stdout,
  stderr: "",
  durationMs: 1,
  unavailable: null,
  ...extra,
});

const markers = ["wabc123", "wdef456"];
const both = "failed: wabc: wabc123\nfailed: wdef: wdef456\n";
const witness = (candidate: GateObservation, reference = observed(both)): RunnerWitness => ({
  rule: "runner-source-v1",
  files: ["test/a.spec.mjs", "test/b.spec.mjs"],
  markers,
  candidate,
  reference,
});

/** Both implementations, the harness's and the offline verifier's, give one answer. */
function held(reading: RunnerWitness, instrument: InstrumentObservation | undefined) {
  const answer = runnerWitnessHeld(reading, instrument);
  expect(derivedHeld(reading, instrument)).toBe(answer);
  return answer;
}

describe("the runner-source reading", () => {
  it("stands where the change's runner reports every added failure the base's runner does", () => {
    expect(held(witness(observed(both)), runnerSource)).toBe(true);
  });

  it("is withheld where the change's runner reports fewer, exits 0 or was cut", () => {
    expect(held(witness(observed("failed: wabc: wabc123\n")), runnerSource)).toBe(false);
    expect(held(witness(observed(both, 0)), runnerSource)).toBe(false);
    expect(held(witness(observed(both, 1, { outputTruncated: true })), runnerSource)).toBe(false);
  });

  it("is withheld where the base's runner reported none of the added tests", () => {
    expect(held(witness(observed(""), observed("")), runnerSource)).toBe(false);
  });

  it("applies only where every change is runner source the tests load too", () => {
    const configured: InstrumentObservation = {
      ...runnerSource,
      files: [
        ...runnerSource.files,
        { path: "package.json#scripts.test", reference: digest(4), current: digest(5) },
      ],
    };
    expect(runnerSourceChanges(configured)).toBeNull();
    expect(held(witness(observed(both)), configured)).toBe(false);
    const harnessOnly: InstrumentObservation = { ...runnerSource, programSubjects: [] };
    expect(runnerSourceChanges(harnessOnly)).toBeNull();
    expect(held(witness(observed(both)), harnessOnly)).toBe(false);
    expect(held(witness(observed(both)), undefined)).toBe(false);
  });

  it("adds a test whose failure message is whole only once it runs", () => {
    const source = witnessTest("w0123456789");
    expect(source).not.toContain("w0123456789");
    const registered: { title: string; fn: () => void }[] = [];
    new Function("it", source)((title: string, fn: () => void) => registered.push({ title, fn }));
    expect(registered).toHaveLength(1);
    expect(() => registered[0]?.fn()).toThrow("w0123456789");
  });

  it("writes every file back byte for byte, even where the measurement throws", async () => {
    const checkout = await mkdtemp(join(tmpdir(), "swarm-witness-"));
    try {
      const original = Buffer.from([0x2f, 0x2f, 0x20, 0xe2, 0x9c, 0x93]);
      await writeFile(join(checkout, "a.spec.js"), original);
      await expect(
        withWitnesses(checkout, ["a.spec.js"], ["wfeed"], async () => {
          expect(await readFile(join(checkout, "a.spec.js"), "utf8")).toContain("it(");
          throw new Error("measurement failed");
        }),
      ).rejects.toThrow("measurement failed");
      expect(await readFile(join(checkout, "a.spec.js"))).toEqual(original);
    } finally {
      await rm(checkout, { recursive: true, force: true });
    }
  });
});
