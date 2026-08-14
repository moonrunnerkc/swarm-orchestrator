import { describe, expect, it } from "vitest";
import { assessRespecification, clearedTests, findNewSpecifications } from "./respecification.ts";
import { createStubBaseControl } from "./test-doubles.ts";

describe("the re-specification escape hatch", () => {
  it("exempts a submitted test that fails on the base source and passes on the submitted source", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
    );

    expect(finding.exempt).toBe(true);
    // The file's controls came back clean, which is a precondition. Nothing is cleared until
    // a test is named, and the stub named none.
    expect(finding.newSpecifications).toEqual([]);
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
    expect(await findNewSpecifications([{ file: "spec.test.ts", newTests: ["a"] }], null)).toEqual(
      [],
    );
  });

  it("assesses each candidate file on its own", async () => {
    const findings = await findNewSpecifications(
      [
        { file: "new-spec.test.ts", newTests: ["adds mul"] },
        { file: "weakened.test.ts", newTests: ["adds mul"] },
      ],
      createStubBaseControl((file) =>
        file === "new-spec.test.ts"
          ? { onBase: "failed", onSubmitted: "passed", failedOnBase: ["adds mul"] }
          : { onBase: "passed", onSubmitted: "passed" },
      ),
    );

    expect(findings.map((finding) => [finding.file, finding.exempt])).toEqual([
      ["new-spec.test.ts", true],
      ["weakened.test.ts", false],
    ]);
    expect([...clearedTests(findings)]).toEqual(["new-spec.test.ts::adds mul"]);
  });
});

describe("which tests a cleared file actually clears", () => {
  it("clears only the tests that are new in the file and failed on the base source", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        // The base run reports two failures: the run's own broken test, which existed at the
        // base, and the genuinely new one.
        failedOnBase: ["adds", "multiplies"],
      })),
      { newTests: ["multiplies"] },
    );

    expect(finding.newSpecifications).toEqual(["multiplies"]);
  });

  it("clears nothing when the base run named no failing test", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({ onBase: "failed", onSubmitted: "passed" })),
      { newTests: ["multiplies"] },
    );

    expect(finding.exempt).toBe(true);
    expect(finding.newSpecifications).toEqual([]);
    expect(finding.reason).toContain("named no failing test");
  });

  it("clears nothing when no new test is among the ones that failed on base", async () => {
    const finding = await assessRespecification(
      "spec.test.ts",
      createStubBaseControl(() => ({
        onBase: "failed",
        onSubmitted: "passed",
        failedOnBase: ["adds"],
      })),
      { newTests: ["multiplies"] },
    );

    expect(finding.newSpecifications).toEqual([]);
  });

  it("does not treat a base-only load failure as a specification failure", async () => {
    // A test that imports a symbol the base does not export fails to load there. The file
    // never ran, so it never failed as a specification, and this is every test written
    // beside a new function: without this the exemption is free for the asking.
    const finding = await assessRespecification("spec.test.ts", {
      runOnBaseSource: () =>
        Promise.resolve({
          outcome: "failed" as const,
          detail: "Cannot find module './mul.ts'",
          exitCode: 1,
          failedTests: null,
        }),
      runOnSubmittedSource: () =>
        Promise.resolve({
          outcome: "passed" as const,
          detail: "exited 0",
          exitCode: 0,
          failedTests: null,
        }),
    });

    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
    expect(finding.reason).toContain("failed to load");
  });
});
