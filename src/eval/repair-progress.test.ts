import { describe, expect, it } from "vitest";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { type Finding, repairProgress, repairRelations } from "./repair-progress.ts";

const finding = (id: string): Finding => ({ id, kind: "unreached-line" });
const observed = (patch: string, ids: readonly string[]) => ({
  patchDigest: digestOfBytes(patch),
  findings: ids.map(finding),
});
const compare = (before: ReturnType<typeof observed>, after: ReturnType<typeof observed>) =>
  repairProgress({ comparedWithStep: 0, findingIdentity: "line-text", before, after });

describe("the relation between two sets of findings", () => {
  it.each([
    ["patch-unchanged", observed("a", ["x"]), observed("a", ["x"])],
    ["findings-identical", observed("a", ["x", "y"]), observed("b", ["y", "x"])],
    ["findings-shrank", observed("a", ["x", "y"]), observed("b", ["y"])],
    ["findings-grew", observed("a", ["x"]), observed("b", ["x", "y"])],
    ["findings-moved", observed("a", ["x"]), observed("b", ["y"])],
    ["satisfied", observed("a", ["x"]), observed("b", [])],
  ] as const)("%s", (relation, before, after) => {
    expect(compare(before, after).relation).toBe(relation);
  });

  it("names every relation this file tests, so a new one cannot arrive untested", () => {
    expect([...repairRelations].sort()).toEqual([
      "findings-grew",
      "findings-identical",
      "findings-moved",
      "findings-shrank",
      "patch-unchanged",
      "satisfied",
    ]);
  });

  it("records what went and what came, sorted, each finding once", () => {
    const progress = compare(observed("a", ["y", "x", "x"]), observed("b", ["z", "x"]));
    expect(progress.findings).toEqual({
      before: ["x", "y"],
      after: ["x", "z"],
      resolved: ["y"],
      introduced: ["z"],
    });
  });

  it("reads satisfied off the findings even where a flaky judge left the patch unchanged", () => {
    expect(compare(observed("a", ["x"]), observed("a", [])).relation).toBe("satisfied");
  });

  it("carries no file comparison where either snapshot has no file list", () => {
    expect(compare(observed("a", ["x"]), observed("b", ["x"])).paths).toBeNull();
  });

  it("names a file that entered the patch, one that left it and one rewritten in place", () => {
    const file = (path: string, content: string) => ({
      path,
      change: "modified" as const,
      diffDigest: digestOfBytes(content),
    });
    const progress = repairProgress({
      comparedWithStep: 2,
      findingIdentity: "line-number",
      before: {
        ...observed("a", ["x"]),
        files: [file("lib/a.js", "1"), file("lib/b.js", "1"), file("lib/c.js", "1")],
      },
      after: {
        ...observed("b", ["x"]),
        files: [file("lib/a.js", "1"), file("lib/b.js", "2"), file("probe-tmp.js", "1")],
      },
    });
    expect(progress.paths).toEqual({
      changed: ["lib/b.js", "lib/c.js", "probe-tmp.js"],
      enteredThePatch: ["probe-tmp.js"],
      leftThePatch: ["lib/c.js"],
    });
    expect(progress.comparedWithStep).toBe(2);
  });
});
