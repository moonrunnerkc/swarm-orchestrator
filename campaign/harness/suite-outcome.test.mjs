import { describe, expect, it } from "vitest";
import { classifySuiteRun } from "./suite-outcome.mjs";

describe("classifying a suite run", () => {
  it("reads exit 0 as passed whatever was printed", () => {
    expect(classifySuiteRun("node", 0, "not ok 1 - printed by a test\n")).toBe("passed");
  });

  it("reads a test failure in each runner's own words", () => {
    expect(classifySuiteRun("node", 1, "not ok 1 - clamp\n# fail 1\n")).toBe("test-failure");
    expect(classifySuiteRun("node", 1, "Tests:       1 failed, 2 passed\n")).toBe("test-failure");
    expect(classifySuiteRun("python", 1, "1 failed, 4 passed in 0.2s\n")).toBe("test-failure");
    expect(classifySuiteRun("go", 1, "--- FAIL: TestClamp (0.00s)\nFAIL\n")).toBe("test-failure");
    expect(classifySuiteRun("rust", 101, "test result: FAILED. 1 passed; 1 failed\n")).toBe(
      "test-failure",
    );
    // What cargo prints after a failing test target, which is not a build failure.
    expect(
      classifySuiteRun(
        "rust",
        101,
        "test clamp::above ... FAILED\n\ntest result: FAILED. 3 passed; 1 failed\n\nerror: test failed, to rerun pass `--lib`\n",
      ),
    ).toBe("test-failure");
  });

  it("reads a tree the tests could not run over as a build failure, ahead of any test marker", () => {
    expect(classifySuiteRun("node", 1, "SyntaxError: Unexpected token\nnot ok 1\n")).toBe(
      "build-failure",
    );
    expect(classifySuiteRun("python", 2, "ERROR collecting\n")).toBe("build-failure");
    expect(classifySuiteRun("python", 1, "ModuleNotFoundError: No module named x\n1 failed\n")).toBe(
      "build-failure",
    );
    expect(classifySuiteRun("go", 1, "# example.com/x\n./a.go:3:2: undefined: y\nFAIL\texample.com/x [build failed]\n")).toBe(
      "build-failure",
    );
    expect(classifySuiteRun("rust", 101, "error[E0308]: mismatched types\n")).toBe("build-failure");
  });

  it("does not attribute a failure it has no marker for", () => {
    expect(classifySuiteRun("node", 1, "something else happened\n")).toBe("unknown-failure");
  });

  it("refuses a runner it knows no markers for", () => {
    expect(() => classifySuiteRun("haskell", 1, "")).toThrow("no suite markers are known for haskell");
  });
});
