// Held out from the agent. The two compareTestFile cases claimcheck's fix commit e050152 added
// to src/checks/test-weakening.test.ts, verbatim.
import { describe, expect, it } from "vitest";
import { compareTestFile } from "./test-weakening.js";

describe("compareTestFile, held out", () => {
  it("flags a deleted test as the ambiguous test-removed, not assertion-removed", () => {
    const parent =
      'import { expect, it } from "vitest";\n' +
      'it("a", () => { expect(f()).toBe(1); });\n' +
      'it("b", () => { expect(g()).toBe(2); });\n';
    const head =
      'import { expect, it } from "vitest";\n' +
      'it("a", () => { expect(f()).toBe(1); });\n';
    const findings = compareTestFile("t.test.ts", parent, head);
    expect(findings.some((w) => w.kind === "test-removed")).toBe(true);
    expect(findings.some((w) => w.kind === "assertion-removed")).toBe(false);
  });

  it("still flags an assertion removed from a surviving test as assertion-removed", () => {
    const parent =
      'import { expect, it } from "vitest";\n' +
      'it("a", () => { expect(f()).toBe(1); expect(g()).toBe(2); });\n';
    const head =
      'import { expect, it } from "vitest";\n' +
      'it("a", () => { expect(f()).toBe(1); });\n';
    const findings = compareTestFile("t.test.ts", parent, head);
    expect(findings.some((w) => w.kind === "assertion-removed")).toBe(true);
    expect(findings.some((w) => w.kind === "test-removed")).toBe(false);
  });
});
