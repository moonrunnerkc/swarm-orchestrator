import { describe, expect, it } from "vitest";
import { type CalibrationCase, caseDigest, parseCalibrationCase } from "./calibration-case.ts";

const wellFormed = {
  id: "edit-add-a-flag",
  taskClass: "edit",
  prompt: "add a --loud flag that prints the greeting in capitals",
  seed: { "greet.mjs": "export const greet = (who) => `hello ${who}`;\n" },
  gateCommand: "node --test",
  origin: "bundled",
  addedAt: "2026-08-13",
};

describe("parseCalibrationCase", () => {
  it("reads a well-formed case", () => {
    const parsed = parseCalibrationCase(wellFormed, "the bundled golden set");

    expect(parsed.id).toBe("edit-add-a-flag");
    expect(parsed.seed["greet.mjs"]).toMatch(/hello/);
  });

  it("refuses a case with no seed, because there would be nothing to work on", () => {
    expect(() => parseCalibrationCase({ ...wellFormed, seed: {} }, "a source")).toThrow(
      /at least one file/,
    );
  });

  it("refuses a class that is not one of the four strata", () => {
    expect(() => parseCalibrationCase({ ...wellFormed, taskClass: "vibes" }, "a source")).toThrow(
      /taskClass/,
    );
  });

  it("says where the bad case came from, the way every other boundary does", () => {
    expect(() => parseCalibrationCase({ ...wellFormed, prompt: "" }, "cases.jsonl line 4")).toThrow(
      /cases\.jsonl line 4/,
    );
  });

  it("refuses a seed path that would escape the scratch workspace", () => {
    expect(() =>
      parseCalibrationCase({ ...wellFormed, seed: { "../outside.ts": "x" } }, "a source"),
    ).toThrow(/outside/);
  });

  it("refuses an absolute seed path for the same reason", () => {
    expect(() =>
      parseCalibrationCase({ ...wellFormed, seed: { "/etc/passwd": "x" } }, "a source"),
    ).toThrow(/outside/);
  });
});

describe("caseDigest", () => {
  const parsed: CalibrationCase = parseCalibrationCase(wellFormed, "a source");

  it("names a case by its content, so the same case is the same case", () => {
    expect(caseDigest(parsed)).toBe(caseDigest(parseCalibrationCase(wellFormed, "again")));
    expect(caseDigest(parsed)).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("changes when the case changes, which is what makes the set checkable", () => {
    const edited = parseCalibrationCase({ ...wellFormed, prompt: "something else" }, "a source");

    expect(caseDigest(edited)).not.toBe(caseDigest(parsed));
  });
});
