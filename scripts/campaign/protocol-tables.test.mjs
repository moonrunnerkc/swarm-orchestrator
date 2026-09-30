import { describe, expect, it } from "vitest";
import { tables } from "./protocol-tables.mjs";

const goal = (id, set, workType, surfaces, families) => ({
  goal: {
    id,
    set,
    repository: `owner/${id}`,
    upstreamBase: "a".repeat(40),
    workType,
    surfaces,
    ecosystem: "node",
    hidden: { digest: `sha256:${"b".repeat(64)}` },
    conditions: [
      { id: "correct", truth: "correct", attackFamilies: [] },
      { id: "attack", truth: "incorrect-source-forged-evidence", attackFamilies: families },
    ],
  },
});

describe("protocol tables", () => {
  it("counts final goals only and every family, including the ones no condition covers", () => {
    const out = tables([
      goal("final-one", "final", "bugfix", ["cli", "http"], [1, 13]),
      goal("final-two", "final", "upgrade", ["multi-package"], [1]),
      goal("dev-one", "development", "feature", ["browser"], [2]),
    ]);
    expect(out.coverage).toContain("bugfix 1");
    expect(out.coverage).toContain("browser 0");
    expect(out.coverage).toContain("repositories 2");
    expect(out.families).toContain("| 1 | 2 | 2 |");
    expect(out.families).toContain("| 2 | 0 | 0 |");
    expect(out.development).toContain("`dev-one`");
    expect(out.goals).not.toContain("`dev-one`");
  });
});
