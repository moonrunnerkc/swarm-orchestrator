import { describe, expect, it } from "vitest";
import { caps, violations } from "./check-caps.mjs";

const within = {
  longFiles: [],
  srcNonTestLines: 1000,
  srcTestLines: 900,
  runtimeDependencies: 2,
  subcommands: 5,
  workflows: 3,
};

describe("the caps", () => {
  it("pass a tree inside every cap", () => {
    expect(violations(within)).toEqual([]);
  });

  it("name each cap a tree exceeds", () => {
    const found = violations({
      longFiles: [["src/big.ts", caps.linesPerTsFile + 1]],
      srcNonTestLines: caps.srcNonTestLines + 1,
      srcTestLines: caps.srcNonTestLines + 2,
      runtimeDependencies: caps.runtimeDependencies + 1,
      subcommands: caps.subcommands + 1,
      workflows: caps.workflows + 1,
    });
    expect(found).toHaveLength(5);
    expect(found[0]).toContain("src/big.ts");
  });

  it("never cap the test lines, which boundary tests need", () => {
    expect(violations({ ...within, srcTestLines: within.srcNonTestLines * 3 })).toEqual([]);
  });
});
