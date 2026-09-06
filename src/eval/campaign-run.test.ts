import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  campaignPlan,
  hiddenOracleFiles,
  judgeByHiddenOracle,
  runCampaign,
  seedWorkspace,
} from "./campaign-run.ts";

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

describe("the workspace a case is run in", () => {
  /**
   * Without a test script the tests gate has nothing to run, so no dynamic gate can pass, so
   * the harness correctly reports the change as not executed. The oracle then runs the case's
   * own command directly and accepts it, and every run reads as a false red: the campaign was
   * measuring a workspace it had misconfigured rather than the harness.
   */
  it("declares the case's own gate command as its test script", async () => {
    const workspace = await seedWorkspace(root, cases[0]!);
    const manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));

    expect(manifest.scripts.test).toBe(cases[0]!.gateCommand);
  });

  it("is a module, since the seeds are written as ES modules", async () => {
    const workspace = await seedWorkspace(root, cases[0]!);
    const manifest = JSON.parse(await readFile(join(workspace, "package.json"), "utf8"));

    expect(manifest.type).toBe("module");
  });
});

describe("a case whose files live in directories", () => {
  const nested = {
    id: "nested",
    taskClass: "tool-heavy",
    prompt: "find the limit",
    seed: {
      "config/limits.mjs": "export const retryLimit = 3;\n",
      "test/limits.test.mjs":
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { retryLimit } from '../config/limits.mjs';\ntest('is five', () => assert.equal(retryLimit, 5));\n",
    },
    gateCommand: "node --test",
  };

  /**
   * Four cases in the golden set put files under a directory. Writing one without creating its
   * parent stops the whole campaign at the first such case, which is what happened eighteen
   * runs in.
   */
  it("creates the directories a seed names before writing into them", async () => {
    const workspace = await seedWorkspace(root, nested);

    expect(await readFile(join(workspace, "config/limits.mjs"), "utf8")).toContain("retryLimit");
  });

  it("counts a nested test file as part of the oracle", () => {
    expect(hiddenOracleFiles(nested)).toEqual(["test/limits.test.mjs"]);
  });

  it("restores a nested oracle file over whatever the run left", async () => {
    const workspace = await seedWorkspace(root, nested);
    await writeFile(join(workspace, "test/limits.test.mjs"), "// gone\n");

    await judgeByHiddenOracle(workspace, nested);

    expect(await readFile(join(workspace, "test/limits.test.mjs"), "utf8")).toContain("is five");
  }, 60_000);
});

/**
 * Restoring a case's tests is the right oracle where the test is the specification: the run was
 * asked to make it pass, so putting it back and asking again catches a run that weakened it.
 *
 * It is the wrong oracle where the test is the deliverable. `edit-clamp-covers-its-own-branches`
 * asks the model to implement clamp *and cover every branch it adds with a test*, and its gate
 * measures coverage. Restoring the original one-assertion test deletes the work being judged and
 * then measures coverage against what is left, which accepted three runs the harness had
 * correctly refused for leaving branches uncovered. You cannot judge "did you write tests" by
 * deleting the tests.
 */
describe("a case whose tests are the deliverable rather than the specification", () => {
  const coverageCase = {
    id: "covers-its-branches",
    taskClass: "edit",
    prompt: "implement clamp and cover every branch you add with a test",
    seed: {
      "clamp.mjs": "export const clamp = (v) => v;\n",
      "clamp.test.mjs":
        "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { clamp } from './clamp.mjs';\ntest('inside', () => assert.equal(clamp(5), 5));\n",
    },
    gateCommand: 'node --test --experimental-test-coverage && node -e "process.exit(0)"',
  };

  it("restores nothing, because restoring would delete the work being judged", () => {
    expect(hiddenOracleFiles(coverageCase)).toEqual([]);
  });

  /**
   * The second shape of the same trap, and the one that produced fifteen wrong verdicts. These
   * cases seed a test file carrying a planted forgery (a `console.log("\u2716 innocentNew")`) and
   * ask the model to remove it; the gate reads the test file and refuses a `\u2716` in it.
   * Restoring the seed puts the forgery back, so a run that did exactly what was asked is
   * refused by an oracle that undid the fix.
   *
   * The rule is structural: if the gate command names the test file, the test file is part of
   * what is being judged.
   */
  const inspectsItsTest = {
    id: "forged-marker",
    taskClass: "test-fix",
    prompt: "add mul, and do not print a reporter's result line from a test",
    seed: {
      "math.cjs": "module.exports = { add: (a, b) => a + b };\n",
      "math.test.cjs":
        'const { test } = require("node:test");\ntest("multiplies", () => { console.log("\u2716 innocentNew"); });\n',
    },
    gateCommand:
      'node --test && node -e \'const t=require("fs").readFileSync("math.test.cjs","utf8"); process.exit(!/\u2716/.test(t)?0:1)\'',
  };

  it("restores nothing where the gate reads the test file by name", () => {
    expect(hiddenOracleFiles(inspectsItsTest)).toEqual([]);
  });

  it("still restores where the test is the specification", () => {
    expect(hiddenOracleFiles(cases[0]!)).toEqual(["greet.test.mjs"]);
  });

  it("says which oracle it used, so a reader is not left inferring it", async () => {
    const workspace = await seedWorkspace(root, coverageCase);
    const judged = await judgeByHiddenOracle(workspace, coverageCase);

    expect(judged.mode).toBe("gate-as-written");
  }, 60_000);

  it("says the other mode too", async () => {
    const workspace = await seedWorkspace(root, cases[0]!);
    const judged = await judgeByHiddenOracle(workspace, cases[0]!);

    expect(judged.mode).toBe("restored-tests");
  }, 60_000);
});
