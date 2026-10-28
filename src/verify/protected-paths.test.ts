import { describe, expect, it } from "vitest";
import { categoryOf, checkProtectedPaths } from "./protected-paths.ts";

describe("protected paths", () => {
  it.each([
    ["test/clamp.test.mjs", "tests"],
    ["src/clamp.spec.ts", "tests"],
    ["pkg/tests/helpers.py", "tests"],
    ["test_clamp.py", "tests"],
    ["conftest.py", "tests"],
    ["vitest.config.ts", "tests"],
    [".github/workflows/ci.yml", "ci"],
    ["package-lock.json", "lockfiles"],
    ["uv.lock", "lockfiles"],
    ["package.json", "manifests"],
    ["swarm.toml", "config"],
    [".swarm/verify/change.patch", "config"],
  ])("puts %s in %s", (path, category) => {
    expect(categoryOf(path)).toBe(category);
  });

  it("treats ordinary source as source", () => {
    expect(categoryOf("src/clamp.mjs")).toBeNull();
    expect(categoryOf("lib/testing-utils-free.js")).toBeNull();
  });

  it("lets protected paths change on their own", () => {
    expect(checkProtectedPaths(["test/a.test.js"], []).violations).toEqual([]);
  });

  it("refuses them changed together with source unless the category is allowed", () => {
    const paths = ["src/a.js", "test/a.test.js", "package-lock.json"];
    expect(checkProtectedPaths(paths, []).violations.map((v) => v.path)).toEqual([
      "test/a.test.js",
      "package-lock.json",
    ]);
    expect(checkProtectedPaths(paths, ["tests"]).violations.map((v) => v.path)).toEqual([
      "package-lock.json",
    ]);
  });
});
