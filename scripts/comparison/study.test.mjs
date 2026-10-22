import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cellState, classifyStop, exposureHits, studyOrder } from "./study.mjs";

describe("the study's registered rules", () => {
  it("rotates the arms by task position so each goes first on an equal share of tasks", () => {
    const order = studyOrder(["a", "b", "c"], ["swarm", "swarm-direct", "opencode"]);
    expect(order).toHaveLength(9);
    const firsts = order.filter((launch) => launch.order % 3 === 0).map((launch) => launch.arm);
    expect(new Set(firsts).size).toBe(3);
    expect(order.map((launch) => launch.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const task of ["a", "b", "c"])
      expect(
        order
          .filter((launch) => launch.task === task)
          .map((launch) => launch.arm)
          .sort(),
      ).toEqual(["opencode", "swarm", "swarm-direct"]);
  });

  it("keeps a setup failure apart from an outcome, and an outcome once inference began", () => {
    expect(classifyStop({ fatal: null, inference: true })).toBe("scored");
    expect(classifyStop({ fatal: new Error("ENOENT"), inference: false })).toBe("setup-failure");
    expect(classifyStop({ fatal: new Error("endpoint died"), inference: true })).toBe(
      "retained-after-inference",
    );
  });

  it("counts every setup failure of a cell and names the next one without overwriting", () => {
    const runs = mkdtempSync(join(tmpdir(), "study-runs-"));
    try {
      writeFileSync(join(runs, "t.swarm.setup-1.json"), "{}");
      writeFileSync(join(runs, "t.opencode.json"), "{}");
      expect(cellState(runs, "t", "swarm")).toMatchObject({
        recorded: false,
        setupFailures: ["t.swarm.setup-1.json"],
        nextSetup: "t.swarm.setup-2.json",
      });
      expect(cellState(runs, "t", "opencode")).toMatchObject({ recorded: true, setupFailures: [] });
      // swarm-direct shares the "t.swarm" prefix only up to the dot; its cell is its own.
      expect(cellState(runs, "t", "swarm-direct")).toMatchObject({
        recorded: false,
        setupFailures: [],
      });
    } finally {
      rmSync(runs, { recursive: true, force: true });
    }
  });

  it("finds the sealed commit or a sealed path in what an arm left", () => {
    const upstream = "1cd3fd47d9e8a7b6c5d4e3f2a1b0c9d8e7f6a5b4";
    expect(
      exposureHits(
        [
          ["stdout", `git show ${upstream}`],
          ["session", "nothing"],
        ],
        [upstream, "swarm-heldout-2026-10-22"],
      ),
    ).toEqual([{ in: "stdout", marker: upstream }]);
    expect(exposureHits([["stdout", "short"]], ["abc"])).toEqual([]);
  });
});
