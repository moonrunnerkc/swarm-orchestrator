import { describe, expect, it } from "vitest";
import { assessRespecification, findExemptFiles } from "./respecification.ts";
import { createStubBaseControl } from "./test-doubles.ts";

describe("the re-specification escape hatch", () => {
  it("exempts a submitted test that fails on the base source and passes on the submitted source", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
    );

    expect(finding.exempt).toBe(true);
    expect(finding.reason).toContain("new specification");
    expect(finding.payload.controls.submittedTestOnBaseSource).toContain("failed");
    expect(finding.payload.controls.submittedTestOnSubmittedSource).toContain("passed");
  });

  it("withholds the exemption when the submitted test still passes on the base source", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "passed", onSubmitted: "passed" })),
    );

    expect(finding.exempt).toBe(false);
    expect(finding.reason).toContain("weakened test");
  });

  it("withholds the exemption when the test fails against the submitted source too", async () => {
    // This is the infrastructure case: no dependencies installed, a broken harness. It fails
    // on base for a reason that has nothing to do with a new specification, and one control
    // alone would have handed it the exemption.
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "failed" })),
    );

    expect(finding.exempt).toBe(false);
    expect(finding.reason).toContain("failing for a reason unrelated to the change");
  });

  it("abstains when the base control could not be run cleanly", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "indeterminate", onSubmitted: "passed" })),
    );

    expect(finding.exempt).toBe(false);
    expect(finding.reason).toContain("did not run cleanly");
  });

  it("abstains when the submitted control could not be run cleanly", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "indeterminate" })),
    );

    expect(finding.exempt).toBe(false);
    expect(finding.reason).toContain("did not run cleanly");
  });

  it("grants nothing at all when no base control runner is available", async () => {
    expect(await findExemptFiles(["spec.test.ts"], null)).toEqual([]);
  });

  it("assesses each candidate file on its own", async () => {
    const findings = await findExemptFiles(
      ["new-spec.test.ts", "weakened.test.ts"],
      createStubBaseControl((file) =>
        file === "new-spec.test.ts"
          ? { onBase: "failed", onSubmitted: "passed" }
          : { onBase: "passed", onSubmitted: "passed" },
      ),
    );

    expect(findings.map((finding) => [finding.file, finding.exempt])).toEqual([
      ["new-spec.test.ts", true],
      ["weakened.test.ts", false],
    ]);
  });
});
