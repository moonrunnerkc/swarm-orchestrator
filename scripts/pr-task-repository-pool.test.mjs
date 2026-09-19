import { describe, expect, it } from "vitest";
import {
  alreadyMined,
  continuing,
  earlierWalks,
  judgeForPool,
  minedTaskLockfile,
} from "./pr-task-repository-pool.mjs";

const candidate = (overrides = {}) => ({
  fullName: "someone/thing",
  owner: "someone",
  language: "TypeScript",
  stars: 900,
  license: "MIT",
  defaultBranch: "main",
  sizeKilobytes: 1024,
  archived: false,
  fork: false,
  template: false,
  mirror: false,
  pushedAt: "2026-05-01T00:00:00Z",
  cloneUrl: "https://github.com/someone/thing.git",
  ...overrides,
});

const nodeFacts = (overrides = {}) => ({
  types: ["node"],
  testScript: "vitest run",
  placeholderTest: false,
  lockfile: minedTaskLockfile,
  workspace: [],
  serviceDependencies: [],
  configuresHarness: false,
  ...overrides,
});

const inspected =
  (facts, lines = 4000) =>
  async () => ({ failure: null, commit: "a".repeat(40), facts, lines });

describe("which repositories the miner is given next", () => {
  it("skips every JavaScript and TypeScript repository the miner already reads", () => {
    const mined = alreadyMined([
      { fullName: "a/js", language: "JavaScript", accepted: true },
      { fullName: "b/ts", language: "TypeScript" },
      { fullName: "c/py", language: "Python", accepted: true },
      { fullName: "d/rejected", language: "JavaScript", accepted: false },
    ]);
    expect([...mined].sort()).toEqual(["a/js", "b/ts"]);
  });

  it("asks nothing of a checkout for a repository already mined", async () => {
    let cloned = 0;
    const verdict = await judgeForPool(candidate(), {
      mined: new Set(["someone/thing"]),
      inspect: async () => {
        cloned += 1;
        return { failure: null };
      },
    });
    expect(verdict).toEqual({ accepted: false, reason: "already in the pool the miner reads" });
    expect(cloned).toBe(0);
  });

  it("applies the campaign's own search rules before cloning", async () => {
    const verdict = await judgeForPool(candidate({ fork: true }), {
      mined: new Set(),
      inspect: async () => {
        throw new Error("a forked repository must not be cloned");
      },
    });
    expect(verdict).toEqual({ accepted: false, reason: "fork" });
  });

  it("applies the campaign's checkout rules, in their order", async () => {
    const verdict = await judgeForPool(candidate(), {
      mined: new Set(),
      inspect: inspected(nodeFacts({ workspace: ["pnpm-workspace.yaml"] })),
    });
    expect(verdict.reason).toBe("multi-package tree: pnpm-workspace.yaml");
    const tooLarge = await judgeForPool(candidate(), {
      mined: new Set(),
      inspect: inspected(nodeFacts(), 45000),
    });
    expect(tooLarge.reason).toBe("lines: 45000");
  });

  it("refuses a lockfile the mined-task install cannot read, after the campaign rules", async () => {
    const verdict = await judgeForPool(candidate(), {
      mined: new Set(),
      inspect: inspected(nodeFacts({ lockfile: "pnpm-lock.yaml" })),
    });
    expect(verdict.accepted).toBe(false);
    expect(verdict.reason).toMatch(/pnpm-lock\.yaml.*package-lock\.json only/);
  });

  it("accepts a repository every rule passes, pinned at the commit it read", async () => {
    const verdict = await judgeForPool(candidate(), {
      mined: new Set(),
      inspect: inspected(nodeFacts()),
    });
    expect(verdict).toEqual({ accepted: true, commit: "a".repeat(40), lines: 4000 });
  });

  it("names a checkout that could not be read rather than guessing", async () => {
    const verdict = await judgeForPool(candidate(), {
      mined: new Set(),
      inspect: async () => ({ failure: "checkout unreadable: timed out" }),
    });
    expect(verdict).toEqual({ accepted: false, reason: "checkout unreadable: timed out" });
  });
});

describe("continuing an earlier walk", () => {
  it("passes over everything an earlier walk decided and keeps the order of the rest", () => {
    const prior = earlierWalks([
      {
        decisions: [
          { fullName: "a/accepted", accepted: true },
          { fullName: "b/rejected", accepted: false, reason: "fork" },
        ],
        accepted: [{ fullName: "a/accepted" }],
      },
    ]);
    const order = ["a/accepted", "c/next", "b/rejected", "d/after"].map((fullName) => ({
      fullName,
    }));
    expect(continuing(order, prior.decided).map((one) => one.fullName)).toEqual([
      "c/next",
      "d/after",
    ]);
    expect([...prior.accepted]).toEqual(["a/accepted"]);
  });
});
