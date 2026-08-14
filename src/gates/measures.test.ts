import { describe, expect, it } from "vitest";
import { isTestFile, isTestReachableSource, measureTestFile } from "./measures.ts";

describe("test file detection", () => {
  it("recognizes the naming conventions of each language it gates", () => {
    for (const path of [
      "src/math.test.ts",
      "src/math.spec.js",
      "src/gates/ratchet.test.tsx",
      "pkg/thing_test.go",
      "tests/test_math.py",
      "app/math_test.py",
      "spec/models/user_spec.rb",
      "__tests__/helper.ts",
      "test/fixtures.ts",
    ]) {
      expect({ path, isTest: isTestFile(path) }).toEqual({ path, isTest: true });
    }
  });

  it("does not mistake production code for a test", () => {
    for (const path of ["src/math.ts", "src/latest.ts", "src/contest.ts", "docs/testing.md"]) {
      expect({ path, isTest: isTestFile(path) }).toEqual({ path, isTest: false });
    }
  });

  it("counts only source a test could reach as coverable", () => {
    expect(isTestReachableSource("src/math.ts")).toBe(true);
    expect(isTestReachableSource("README.md")).toBe(false);
    expect(isTestReachableSource("src/math.test.ts")).toBe(false);
  });
});

describe("counting a test file", () => {
  it("counts tests, assertions, and the subjects that carry an exact matcher", () => {
    const measures = measureTestFile(
      [
        "import { it, expect } from 'vitest';",
        "it('adds', () => {",
        "  expect(add(1, 2)).toBe(3);",
        "  expect(add(1, 2)).toBeGreaterThan(0);",
        "});",
        "test('subtracts', () => {",
        "  expect(sub(2, 1)).toEqual(1);",
        "});",
      ].join("\n"),
    );

    expect(measures.tests).toBe(2);
    expect(measures.assertions).toBe(3);
    expect(measures.exactSubjects).toEqual(["add(1, 2)", "sub(2, 1)"]);
    expect(measures.assertionsBySubject).toEqual({ "add(1, 2)": 2, "sub(2, 1)": 1 });
  });

  it("counts skip markers across the languages the gates support", () => {
    const measures = measureTestFile(
      [
        "it.skip('one', () => {});",
        "xit('two', () => {});",
        "describe.skip('three', () => {});",
        "@pytest.mark.skip",
        "def test_four():",
        "    t.Skip('five')",
        "#[ignore]",
        "#[test]",
      ].join("\n"),
    );

    expect(measures.skips).toBe(6);
    // it.skip, xit, def test_four, and #[test] all declare a test.
    expect(measures.tests).toBe(4);
  });

  it("measures a file that no longer exists as zero rather than as absent", () => {
    expect(measureTestFile(null)).toEqual({
      tests: 0,
      assertions: 0,
      skips: 0,
      exactSubjects: [],
      assertionsBySubject: {},
    });
  });

  it("ignores an assertion that only appears in a comment", () => {
    const measures = measureTestFile(
      [
        "it('adds', () => {",
        "  // expect(add(1, 2)).toBe(99);",
        "  expect(add(1, 2)).toBe(3);",
        "});",
      ].join("\n"),
    );

    expect(measures.assertions).toBe(1);
  });

  it("counts go and python assertion styles", () => {
    expect(
      measureTestFile(
        ["func TestAdd(t *testing.T) {", "  if got != 3 {", "    t.Fatalf('bad')", "  }", "}"].join(
          "\n",
        ),
      ),
    ).toMatchObject({ tests: 1, assertions: 1 });

    expect(
      measureTestFile(["def test_add():", "    assert add(1, 2) == 3"].join("\n")),
    ).toMatchObject({ tests: 1, assertions: 1 });
  });
});
