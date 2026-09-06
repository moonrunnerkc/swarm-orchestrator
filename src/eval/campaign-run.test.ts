import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { campaignPlan, hiddenOracleFiles, runCampaign } from "./campaign-run.ts";

let root = "";

const cases = [
  {
    id: "loud-greeting",
    taskClass: "edit",
    prompt: "make it shout",
    seed: {
      "greet.mjs": "export const greet = (w) => `hello ${w}`;\n",
      "greet.test.mjs":
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greet } from './greet.mjs';\ntest('shouts', () => assert.equal(greet('w', true), 'HELLO W'));\n",
    },
    gateCommand: "node --test",
  },
];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-campaign-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("planning a campaign", () => {
  it("is every arm against every case at every seed, and says how many that is", () => {
    const plan = campaignPlan({ arms: ["single-minimal", "single-gates"], cases, seeds: 3 });

    expect(plan.runs).toHaveLength(6);
    expect(plan.total).toBe(6);
  });

  it("pairs a run across arms by case and seed, which is what the comparison needs", () => {
    const plan = campaignPlan({ arms: ["single-minimal", "single-gates"], cases, seeds: 2 });
    const first = plan.runs.filter((run) => run.pairId === plan.runs[0]?.pairId);

    expect(first).toHaveLength(2);
    expect(new Set(first.map((run) => run.armId)).size).toBe(2);
  });

  it("gives every run a key that names the work rather than the moment", () => {
    const one = campaignPlan({ arms: ["single-gates"], cases, seeds: 1 }).runs[0];
    const again = campaignPlan({ arms: ["single-gates"], cases, seeds: 1 }).runs[0];

    expect(one?.idempotencyKey).toBe(again?.idempotencyKey);
    expect(one?.idempotencyKey).toMatch(/^sha256:/);
  });
});

/**
 * The golden set's test file sits in the seed, so an arm with no ratchet can pass its own gate by
 * deleting the test. That is not a bug in the corpus, it is the thing the campaign measures, and
 * it is only measurable if acceptance is decided by a copy the run never saw.
 */
describe("the oracle a run never sees", () => {
  it("names the test files of a case, which is what gets restored", () => {
    expect(hiddenOracleFiles(cases[0]!)).toEqual(["greet.test.mjs"]);
  });

  it("accepts a workspace that passes the original test", async () => {
    const workspace = await mkdtemp(join(root, "ws-"));
    await writeFile(join(workspace, "package.json"), '{"name":"w","type":"module"}\n');
    await writeFile(
      join(workspace, "greet.mjs"),
      "export const greet = (w, loud) => (loud ? `HELLO ${w.toUpperCase()}` : `hello ${w}`);\n",
    );
    // The run deleted the test. The oracle restores it and asks again.
    const judged = await import("./campaign-run.ts").then((module) =>
      module.judgeByHiddenOracle(workspace, cases[0]!),
    );

    expect(judged.accepted).toBe(true);
  }, 60_000);

  it("refuses a workspace that only passed because the test was weakened", async () => {
    const workspace = await mkdtemp(join(root, "ws-"));
    await writeFile(join(workspace, "package.json"), '{"name":"w","type":"module"}\n');
    await writeFile(join(workspace, "greet.mjs"), "export const greet = (w) => `hello ${w}`;\n");
    await writeFile(
      join(workspace, "greet.test.mjs"),
      "import { test } from 'node:test';\ntest('nothing', () => {});\n",
    );

    const judged = await import("./campaign-run.ts").then((module) =>
      module.judgeByHiddenOracle(workspace, cases[0]!),
    );

    expect(judged.accepted).toBe(false);
    expect(judged.detail).toMatch(/oracle/i);
  }, 60_000);

  it("leaves the run's own test file replaced, so the judgement is on the original", async () => {
    const workspace = await mkdtemp(join(root, "ws-"));
    await writeFile(join(workspace, "package.json"), '{"name":"w","type":"module"}\n');
    await writeFile(join(workspace, "greet.mjs"), "export const greet = (w) => `hello ${w}`;\n");
    await writeFile(join(workspace, "greet.test.mjs"), "// deleted the real test\n");

    await import("./campaign-run.ts").then((module) =>
      module.judgeByHiddenOracle(workspace, cases[0]!),
    );

    expect(await readFile(join(workspace, "greet.test.mjs"), "utf8")).toContain("shouts");
  }, 60_000);
});

describe("running a campaign", () => {
  it("runs every planned run and reports one result each", async () => {
    const ran: string[] = [];
    const result = await runCampaign({
      arms: ["single-minimal", "single-gates"],
      cases,
      seeds: 2,
      scratchRoot: root,
      runArm: (run) => {
        ran.push(`${run.armId}:${run.caseId}:${run.seed}`);
        return Promise.resolve({
          accepted: run.armId === "single-gates",
          completed: true,
          costUsd: 0,
          latencyMs: 100,
          detail: "",
        });
      },
    });

    expect(ran).toHaveLength(4);
    expect(result.runs).toHaveLength(4);
    expect(result.scores.find((score) => score.armId === "single-gates")?.accepted.point).toBe(1);
  });

  it("counts a run that crashed against the arm rather than dropping it", async () => {
    const result = await runCampaign({
      arms: ["single-minimal"],
      cases,
      seeds: 2,
      scratchRoot: root,
      runArm: () => Promise.reject(new Error("the model went away")),
    });

    expect(result.scores[0]?.launched).toBe(2);
    expect(result.scores[0]?.crashed).toBe(2);
    expect(result.scores[0]?.accepted.point).toBe(0);
  });

  it("compares two arms as a paired test rather than two separate rates", async () => {
    const result = await runCampaign({
      arms: ["single-minimal", "single-gates"],
      cases,
      seeds: 20,
      scratchRoot: root,
      runArm: (run) =>
        Promise.resolve({
          // The gated arm wins on twelve of the twenty pairs and loses none.
          accepted: run.armId === "single-gates" ? run.seed < 16 : run.seed < 4,
          completed: true,
          costUsd: 0,
          latencyMs: 100,
          detail: "",
        }),
    });

    const pairing = result.comparisons.find(
      (one) => one.baseline === "single-minimal" && one.against === "single-gates",
    );
    expect(pairing?.discordant).toBe(12);
    expect(pairing?.significant).toBe(true);
  });
});
