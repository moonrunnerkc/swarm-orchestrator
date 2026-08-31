import { describe, expect, it } from "vitest";
import { countsForCycle, parseTestCounts, testCountArtifactPath } from "./test-count-artifact.ts";

const result = [
  "TAP version 13",
  "# Subtest: adds",
  "ok 1 - adds",
  "1..1",
  "# tests 7",
  "# suites 0",
  "# pass 6",
  "# fail 0",
  "# skipped 1",
  "# todo 0",
].join("\n");

describe("the count a runner wrote down", () => {
  it("reads the collected and skipped counters out of the result", () => {
    expect(parseTestCounts(result)).toEqual({ collected: 7, skipped: 1 });
  });

  it("reads no count out of a result that declares none", () => {
    expect(parseTestCounts("TAP version 13\nok 1 - adds\n1..1\n")).toBeNull();
    expect(parseTestCounts("")).toBeNull();
  });

  it("keeps a missing skipped counter apart from a skipped count of zero", () => {
    expect(parseTestCounts("# tests 3")).toEqual({ collected: 3, skipped: null });
    expect(parseTestCounts("# tests 3\n# skipped 0")).toEqual({ collected: 3, skipped: 0 });
  });

  it("ignores a counter line that is not at the left margin, which is where a producer writes", () => {
    expect(parseTestCounts("  # tests 900\n# tests 3")).toEqual({ collected: 3, skipped: null });
  });

  it("takes the last block, so a forgery cannot get in front of the producer's own summary", () => {
    // Node escapes a leading hash in output it captured from a test, so this cannot arise
    // through node's own reporter. Reading the last block costs nothing and holds anyway.
    expect(parseTestCounts(`# tests 9999\n${result}`)?.collected).toBe(7);
  });

  it("gives two test gates two paths, so neither reads the other's numbers", () => {
    expect(testCountArtifactPath("/session/coverage", "tests:node")).toBe(
      "/session/coverage/tests-node.tap",
    );
    expect(testCountArtifactPath("/s", "tests")).not.toBe(testCountArtifactPath("/s", "tests:go"));
  });
});

describe("what a cycle's results add up to", () => {
  it("is the one result, where one arm wrote one", () => {
    expect(countsForCycle([result])).toEqual({ collected: 7, skipped: 1 });
  });

  it("abstains where nothing wrote one", () => {
    expect(countsForCycle([])).toBeNull();
    expect(countsForCycle(["not a tap result"])).toBeNull();
  });

  it("abstains where two arms wrote two, rather than adding them", () => {
    // Two results are two suites, and their sum depends on how many arms happened to produce
    // one. A number that moves with that is not a measurement of how many tests exist.
    expect(countsForCycle([result, "# tests 4"])).toBeNull();
  });
});
