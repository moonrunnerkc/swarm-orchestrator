import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { judgeRecordedVerdicts } from "./check-ci-verdicts.mjs";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ci-verdicts-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function recordedAt(rows) {
  const path = join(root, "scored.json");
  await writeFile(path, `${JSON.stringify({ runs: rows }, null, 2)}\n`);
  return path;
}

/**
 * A check nobody has watched fail is a check nobody should believe. These are the two shapes gate
 * 3a exists to catch, written as records rather than described.
 */
describe("a recorded verdict the tool's own record does not support", () => {
  it("fails on a green claim with a reason to refuse recorded beside it", async () => {
    const path = await recordedAt([
      {
        repository: "fixture/repo",
        pull: 1,
        regression: "pass",
        sealedOracle: "accepted",
        oracleReach: "unreached",
        oracleBond: "not-bonded",
        verified: true,
      },
    ]);

    await expect(
      run(process.execPath, ["scripts/check-ci-verdicts.mjs", path], { cwd: repositoryRoot }),
    ).rejects.toMatchObject({ code: 1 });
  });

  it("fails on a green claim whose record is missing a field the policy reads", () => {
    const judged = judgeRecordedVerdicts(
      [{ repository: "fixture/repo", pull: 2, regression: "pass", sealedOracle: "accepted", verified: true }],
      "fixture",
    );

    expect(judged.violations).toHaveLength(1);
    expect(judged.violations[0]).toContain("no oracleReach");
  });

  /**
   * The other direction: a refusal the record gives no reason for is the writer having dropped
   * the reason, and a verdict nobody can re-derive is not a verdict whichever way it points.
   */
  it("fails on a refusal with no reason to refuse recorded", () => {
    const judged = judgeRecordedVerdicts(
      [
        {
          repository: "fixture/repo",
          pull: 3,
          regression: "pass",
          sealedOracle: "accepted",
          oracleReach: "reached",
          oracleBond: "held",
          verified: false,
        },
      ],
      "fixture",
    );

    expect(judged.violations).toHaveLength(1);
    expect(judged.violations[0]).toContain("holds no reason to refuse");
  });

  it("passes a record whose claim follows from its own fields", async () => {
    const path = await recordedAt([
      {
        repository: "fixture/repo",
        pull: 4,
        regression: "pass",
        sealedOracle: "accepted",
        oracleReach: "reached",
        oracleBond: "held",
        verified: true,
      },
      {
        repository: "fixture/repo",
        pull: 5,
        regression: "pass",
        sealedOracle: "rejected",
        oracleReach: "unmeasured",
        oracleBond: "not-bonded",
        verified: false,
      },
    ]);

    const done = await run(process.execPath, ["scripts/check-ci-verdicts.mjs", path], {
      cwd: repositoryRoot,
    });

    expect(done.stdout).toContain("gate 3a: zero");
  });

  /**
   * A refusal whose present fields already hold a reason is determinate whatever is missing,
   * because a field nobody recorded cannot take a reason back.
   */
  it("re-derives a refusal from the fields it does carry", () => {
    const judged = judgeRecordedVerdicts(
      [{ repository: "fixture/repo", pull: 6, regression: "no-change", verified: false }],
      "fixture",
    );

    expect(judged.violations).toEqual([]);
    expect(judged.agreed).toBe(1);
  });

  /**
   * One that is genuinely indeterminate is reported rather than counted against the gate: the bar
   * is about green claims, and an absence of re-derivation is not a disagreement.
   */
  it("reports a refusal it could not re-derive without failing on it", () => {
    const judged = judgeRecordedVerdicts(
      [
        {
          repository: "fixture/repo",
          pull: 7,
          regression: "pass",
          sealedOracle: "accepted",
          verified: false,
        },
      ],
      "fixture",
    );

    expect(judged.violations).toEqual([]);
    expect(judged.notRederived).toBe(1);
  });
});
