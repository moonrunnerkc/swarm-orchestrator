import { describe, expect, it } from "vitest";
import { buildManifest, defaultBudgets, eligibleAArms } from "./manifest.mjs";

const digest = `sha256:${"a".repeat(64)}`;
const goal = (id, set, preset, conditions = 6) => ({
  goal: {
    id,
    set,
    conditions: Array.from({ length: conditions }, (_, at) => ({ id: `c${at}-x` })),
  },
  contract: { preset: preset === null ? undefined : { kind: preset } },
  frozen: { id, set, digest },
});
const inputs = (loadedGoals) => ({
  loadedGoals,
  protocol: { path: "docs/verifier-first/campaign-protocol-2026-09-29.md", digest },
  pins: {
    swarmRevision: "b".repeat(40),
    swarmCli: "/x/dist/cli.js",
    model: "local:qwen3.8:27b",
    endpoint: "http://127.0.0.1:8000/v1",
    vera: "v1.0.0-rc.4",
  },
  seed: "seed-for-tests",
  repetitions: 3,
  budgets: defaultBudgets,
  unsupportedA: { "a-ranex": "needs x86-64 Linux", "a-critique": "needs a model route" },
});

describe("the campaign manifest", () => {
  it("lists every launch once, in a stable seeded order, development first", () => {
    const goals = [
      goal("dev-one-bugfix", "development", "bugfix"),
      goal("final-refactor-x", "final", "refactor"),
    ];
    const first = buildManifest(inputs(goals));
    const second = buildManifest(inputs([...goals].reverse()));
    expect(first.launches.map((one) => one.id).sort()).toEqual(
      second.launches.map((one) => one.id).sort(),
    );
    expect(first.launches.length).toBe(2 * (6 * eligibleAArms.length) + 2 * 5 * 3);
    expect(first.launches[0].set).toBe("development");
    expect(new Set(first.launches.map((one) => one.order)).size).toBe(first.launches.length);
  });

  it("records a workflow arm the goal cannot natively run as unsupported, never as a launch", () => {
    const manifest = buildManifest(inputs([goal("final-feature-x", "final", null)]));
    const bArms = manifest.launches.filter((one) => one.comparison === "B").map((one) => one.arm);
    expect(new Set(bArms)).toEqual(new Set(["b1-ci", "b5-vera"]));
    expect(manifest.unsupported.filter((one) => one.comparison === "B")).toHaveLength(3);
    expect(
      manifest.unsupported.filter((one) => one.comparison === "A").map((one) => one.arm),
    ).toEqual(["a-ranex", "a-critique"]);
  });

  it("keeps a cell's repetitions apart in the order", () => {
    const manifest = buildManifest(inputs([goal("final-bugfix-x", "final", "bugfix")]));
    const b = manifest.launches.filter((one) => one.comparison === "B");
    const firstOfSecond = b.findIndex((one) => one.repetition === 2);
    expect(b.slice(0, firstOfSecond).every((one) => one.repetition === 1)).toBe(true);
  });
});
