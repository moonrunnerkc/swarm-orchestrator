import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cellKey,
  cellState,
  classifyStop,
  exposureHits,
  progressLine,
  revealHidden,
  sealHidden,
  studyOrder,
} from "./study.mjs";

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

  it("gives a second sample of the same task and arm its own cell", () => {
    expect(cellKey({ task: "acorn", arm: "swarm" })).toBe("acorn");
    expect(cellKey({ task: "acorn", arm: "swarm", sample: 1 })).toBe("acorn");
    expect(cellKey({ task: "acorn", arm: "swarm", sample: 2 })).toBe("acorn~2");
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

describe("hidden verdicts during a frozen block", () => {
  const launch = { order: 4, task: "svgo-bugfix", arm: "swarm", sample: 1 };
  const scored = {
    outcome: "scored",
    invocation: { wallMs: 175_400, tokens: 912_004 },
    scores: { visible: { passed: false }, hidden: { sealed: "sealed-hidden/x.json", digest: "d" } },
  };

  it("never prints a verdict on the progress line, hidden or visible", () => {
    const line = progressLine(launch, scored, null);
    expect(line).toBe("4 svgo-bugfix swarm: scored, 175 s, 912004 tokens, scored, sealed");
    expect(line).not.toMatch(/hidden|visible|pass|fail/);
  });

  it("keeps the verdict out of the record and gives it back only once every launch has an outcome", () => {
    const runs = mkdtempSync(join(tmpdir(), "study-seal-"));
    try {
      const sealed = sealHidden(runs, "svgo-bugfix.swarm.json", { verdict: "fail", basis: "b" });
      expect(statSync(join(runs, sealed.sealed)).mode & 0o777).toBe(0o600);
      writeFileSync(
        join(runs, "svgo-bugfix.swarm.json"),
        JSON.stringify({ outcome: "scored", scores: { hidden: sealed } }),
      );
      expect(readFileSync(join(runs, "svgo-bugfix.swarm.json"), "utf8")).not.toContain("fail");
      const second = { order: 5, task: "svgo-bugfix", arm: "opencode", sample: 1 };
      expect(() => revealHidden(runs, [launch, second])).toThrow(/pending: 5 svgo-bugfix opencode/);
      writeFileSync(
        join(runs, "svgo-bugfix.opencode.json"),
        JSON.stringify({ outcome: "setup-failures-exhausted" }),
      );
      const revealed = revealHidden(runs, [launch, second]);
      expect(revealed[0].scores.hidden).toEqual({ verdict: "fail", basis: "b" });
      writeFileSync(join(runs, sealed.sealed), JSON.stringify({ verdict: "pass", basis: "b" }));
      expect(() => revealHidden(runs, [launch, second])).toThrow(/is not the verdict/);
    } finally {
      rmSync(runs, { recursive: true, force: true });
    }
  });
});
