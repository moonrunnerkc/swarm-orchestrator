import { describe, expect, it } from "vitest";
import { attemptSchedule, failingTestNames, isSourcePath, isTestPath, rankSourceFiles, seedRecord } from "./seed.mjs";

describe("telling a test file from a source file", () => {
  it("reads the usual directories and suffixes as tests", () => {
    for (const path of ["test/a.js", "src/__tests__/b.ts", "a.spec.ts", "b.test.mjs", "tests/test_x.py", "pkg/x_test.go", "src/tests.rs", "conftest.py", "e2e/flow.js"]) {
      expect(isTestPath(path), path).toBe(true);
    }
    for (const path of ["src/a.js", "lib/b.ts", "pkg/x.go", "src/lib.rs", "module/attest.py"]) {
      expect(isTestPath(path), path).toBe(false);
    }
  });

  it("counts a source file only where the line count would, and never a test", () => {
    expect(isSourcePath("Go", "pkg/x.go")).toBe(true);
    expect(isSourcePath("Go", "pkg/x_test.go")).toBe(false);
    expect(isSourcePath("Go", "vendor/x.go")).toBe(true);
    expect(isSourcePath("Go", "api/x.pb.go")).toBe(false);
  });
});

describe("ranking the source files", () => {
  it("puts files a test names first, then the rest, each group in path order", () => {
    const ranked = rankSourceFiles(["src/zeta.js", "src/alpha.js", "src/clamp.js", "src/index.js"], [
      'import { clamp } from "../src/clamp.js";\nimport z from "./zeta"',
    ]);

    expect(ranked).toEqual(["src/clamp.js", "src/zeta.js", "src/alpha.js", "src/index.js"]);
  });

  it("does not count index-like names as mentions", () => {
    expect(rankSourceFiles(["src/index.js", "src/b.js"], ["index"])).toEqual(["src/b.js", "src/index.js"]);
  });
});

describe("the attempt schedule", () => {
  const sites = {
    "a.js": { "flip-comparison": [{ line: 1 }], "off-by-one": [] },
    "b.js": { "flip-comparison": [{ line: 2 }, { line: 9 }], "off-by-one": [{ line: 3 }] },
  };
  const sitesOf = (operator, path) => sites[path][operator];

  it("is operator-major, one site per file, in rank order", () => {
    expect(attemptSchedule(["flip-comparison", "off-by-one"], ["a.js", "b.js"], sitesOf)).toEqual([
      { operator: "flip-comparison", path: "a.js", site: { line: 1 } },
      { operator: "flip-comparison", path: "b.js", site: { line: 2 } },
      { operator: "off-by-one", path: "b.js", site: { line: 3 } },
    ]);
  });

  it("stops at the sealed maximum", () => {
    expect(attemptSchedule(["flip-comparison", "off-by-one"], ["a.js", "b.js"], sitesOf, 2)).toHaveLength(2);
  });
});

describe("naming the tests that failed", () => {
  it("reads each runner's own failure line", () => {
    expect(failingTestNames("node", "not ok 2 - clamps above\nnot ok 3 - clamps below\n")).toEqual(["clamps above", "clamps below"]);
    expect(failingTestNames("node", "  ✖ clamps above (2.1ms)\n")).toEqual(["clamps above"]);
    expect(failingTestNames("python", "FAILED tests/test_x.py::test_clamp - assert 1 == 2\n")).toEqual(["tests/test_x.py::test_clamp"]);
    expect(failingTestNames("go", "--- FAIL: TestClamp (0.00s)\n")).toEqual(["TestClamp"]);
    expect(failingTestNames("rust", "test clamp::above ... FAILED\n")).toEqual(["clamp::above"]);
  });

  it("answers an empty list rather than a guess where the output names nothing", () => {
    expect(failingTestNames("node", "something broke\n")).toEqual([]);
  });
});

describe("the manifest entry", () => {
  it("carries the provenance and the expected detection, stated before any run", () => {
    const record = seedRecord({
      repository: "someone/thing",
      commit: "abc",
      language: "Go",
      type: "go",
      testCommand: "go test ./...",
      attempt: { operator: "flip-comparison", path: "pkg/x.go", site: { line: 7, before: "if a < b {", after: "if a <= b {" } },
      failure: { output: "--- FAIL: TestX (0.00s)\nFAIL\n" },
    });

    expect(record).toMatchObject({
      repository: "someone/thing",
      commit: "abc",
      operator: "flip-comparison",
      file: "pkg/x.go",
      line: 7,
      before: "if a < b {",
      after: "if a <= b {",
      failingTests: ["TestX"],
    });
    expect(record.expectedDetection.gate).toBe("tests");
    expect(record.failureExcerpt).toContain("--- FAIL: TestX");
  });
});
