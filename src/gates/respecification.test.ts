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

  it("reads a compile diagnostic as a load failure, whichever toolchain reported it", async () => {
    // A type-checked runner never executes the file at all: the compiler refuses it because
    // the base does not export the symbol yet. Reading that as a failing specification granted
    // the exemption to exactly the case the exemption exists to exclude.
    const diagnostics = [
      "math.test.ts(3,10): error TS2305: Module '\"./math\"' has no exported member 'multiplies'.",
      "src/math.test.ts:3:10 - error TS2339: Property 'mul' does not exist on type 'Math'.",
      '✘ [ERROR] Could not resolve "./math.ts"\nTransform failed with 1 error',
      "# github.com/scratch/math [build failed]",
      "error[E0425]: cannot find function `multiplies` in this scope",
    ];

    for (const detail of diagnostics) {
      const finding = await assessRespecification(
        "math.test.ts",
        {
          runOnBaseSource: () =>
            Promise.resolve({
              outcome: "failed" as const,
              detail,
              exitCode: 1,
              failedTests: ["multiplies"],
            }),
          runOnSubmittedSource: () =>
            Promise.resolve({
              outcome: "passed" as const,
              detail: "exited 0",
              exitCode: 0,
              failedTests: [],
            }),
        },
        { newTests: ["multiplies"] },
      );

      expect({ detail, cleared: finding.newSpecifications, exempt: finding.exempt }).toEqual({
        detail,
        cleared: [],
        exempt: false,
      });
    }
  });

  it("still clears a test that ran on the base source and failed there as a specification", async () => {
    // The control: an assertion failure is the file executing and disagreeing with the base,
    // which is what a new specification looks like. Nothing above may cost this one.
    const finding = await assessRespecification(
      "math.test.ts",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed" as const,
            detail: [
              "✖ multiplies (0.7ms)",
              "  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 0 !== 6",
              "not ok 1 - multiplies",
            ].join("\n"),
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed" as const,
            detail: "exited 0",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );

    expect(finding.exempt).toBe(true);
    expect(finding.newSpecifications).toEqual(["multiplies"]);
  });

  it("reads the whole missing-binding family as the base not having the symbol", async () => {
    // One absence, reached three ways. A require binds the missing export to undefined, and
    // then a property read, a destructure, or a spread is the first thing that touches it. The
    // module system and the syntax at the call site decide the message and must not decide the
    // verdict: none of these is the file failing as a specification, because the base does not
    // have the symbol yet.
    const framings = [
      "TypeError: Cannot read properties of undefined (reading 'mul')",
      "TypeError: Cannot read property 'mul' of undefined",
      "TypeError: Cannot destructure property 'mul' of 'undefined' as it is undefined.",
      "TypeError: undefined is not iterable (cannot read property Symbol(Symbol.iterator))",
    ];

    for (const detail of framings) {
      const finding = await assessRespecification(
        "math.test.cjs",
        {
          runOnBaseSource: () =>
            Promise.resolve({
              outcome: "failed" as const,
              detail: ["\u2716 multiplies (0.7ms)", `  ${detail}`, "not ok 1 - multiplies"].join(
                "\n",
              ),
              exitCode: 1,
              failedTests: ["multiplies"],
            }),
          runOnSubmittedSource: () =>
            Promise.resolve({
              outcome: "passed" as const,
              detail: "exited 0",
              exitCode: 0,
              failedTests: [],
            }),
        },
        { newTests: ["multiplies"] },
      );

      expect({ detail, cleared: finding.newSpecifications, exempt: finding.exempt }).toEqual({
        detail,
        cleared: [],
        exempt: false,
      });
    }
  });

  it("reads a require of a symbol the base lacks as a load failure, as it does an import", async () => {
    // CommonJS binds the missing export to undefined rather than refusing the file, so the
    // same "the base does not have this yet" arrives from the call site as a TypeError. The
    // exemption must not depend on which module system the test file happens to use.
    const detail = [
      "✖ multiplies (0.7ms)",
      "  TypeError: mul is not a function",
      "not ok 1 - multiplies",
    ].join("\n");
    const finding = await assessRespecification(
      "math.test.cjs",
      {
        runOnBaseSource: () =>
          Promise.resolve({
            outcome: "failed" as const,
            detail,
            exitCode: 1,
            failedTests: ["multiplies"],
          }),
        runOnSubmittedSource: () =>
          Promise.resolve({
            outcome: "passed" as const,
            detail: "exited 0",
            exitCode: 0,
            failedTests: [],
          }),
      },
      { newTests: ["multiplies"] },
    );

    expect(finding.exempt).toBe(false);
    expect(finding.newSpecifications).toEqual([]);
    expect(finding.reason).toContain("failed to load");
  });
});
