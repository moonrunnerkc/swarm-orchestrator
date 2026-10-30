import { describe, expect, it } from "vitest";
import { endingTable } from "./report.mjs";

describe("how the runs ended", () => {
  it("counts trials and benchmark passes per stop reason and verdict", () => {
    const rows = [
      { arm: "swarm", stop: "unmeasured", verdict: "unmeasured", pass: true },
      { arm: "swarm", stop: "unmeasured", verdict: "unmeasured", pass: false },
      { arm: "swarm", stop: "token-budget", verdict: "not verified", pass: false },
      { arm: "opencode", pass: true },
    ];
    expect(endingTable(rows)).toBe(
      [
        "| Arm | Stop | Verifier verdict | Trials | Passed |",
        "| --- | --- | --- | ---: | ---: |",
        "| swarm | token-budget | not verified | 1 | 0 |",
        "| swarm | unmeasured | unmeasured | 2 | 1 |",
      ].join("\n"),
    );
  });

  it("prints nothing when no row records how it ended", () => {
    expect(endingTable([{ arm: "swarm", pass: true }])).toBeNull();
  });
});
