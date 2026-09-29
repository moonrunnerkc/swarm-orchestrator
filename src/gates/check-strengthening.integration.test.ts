import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { strengthenAndRepair, strengtheningLimits, strengtheningState } from "../cli-strengthen.ts";
import { probeVerifier, type TaskGoalContext, verifyCandidateUnder } from "../cli-task-goal.ts";
import type { ModelClient } from "../core/model-client.ts";
import {
  declareGoalContract,
  freezeGoalContract,
  type GoalContract,
} from "../evidence/goal-contract.ts";
import { openEvidenceSession } from "../evidence/session.ts";
import { challengeVerdictsAgree } from "../evidence/verifier/challenges.mjs";
import { strengtheningAgrees } from "../evidence/verifier/strengthening.mjs";

/**
 * The strengthening and repair lifecycle on a real Node project, every check a real process in a
 * fresh checkout. The requirement says `clamp` bounds a number to a range; its only check tests the
 * middle of the range. The candidate forgot the upper bound. The repository's own suite witnesses
 * that a mutant of the lower bound changes behaviour, so the challenge finds a gap; a proposed check
 * is admitted only because it rejects that mutant and accepts the sealed reference; it rejects the
 * candidate, so the repair runs; the final contract holds every original check and the admitted one.
 */
let repository = "";
let sessions = "";
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };

function git(args: readonly string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd: repository,
    encoding: "utf8",
  }).trim();
}

const suite = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { clamp } from "./clamp.mjs";',
  'test("keeps the middle", () => assert.equal(clamp(5, 0, 10), 5));',
  'test("raises to the floor", () => assert.equal(clamp(-1, 0, 10), 0));',
  "",
].join("\n");

const withoutCeiling = [
  "export function clamp(n, lo, hi) {",
  "  if (n < lo) return lo;",
  "  return n;",
  "}",
  "",
].join("\n");

const correct = [
  "export function clamp(n, lo, hi) {",
  "  if (n < lo) return lo;",
  "  if (n > hi) return hi;",
  "  return n;",
  "}",
  "",
].join("\n");

let base = "";
let referencePatch = "";

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), "swarm-strengthen-"));
  sessions = await mkdtemp(join(tmpdir(), "swarm-strengthen-sessions-"));
  git(["init", "-q"]);
  await writeFile(
    join(repository, "package.json"),
    '{"name":"w","private":true,"type":"module","scripts":{"test":"node --test"}}\n',
  );
  await writeFile(
    join(repository, "clamp.mjs"),
    "export function clamp(n, lo, hi) {\n  return n;\n}\n",
  );
  await writeFile(join(repository, "clamp.test.mjs"), suite.replace(/test\("raises[^\n]*\n/, ""));
  git(["add", "-A"]);
  git(["commit", "-qm", "base"]);
  base = git(["rev-parse", "HEAD"]);
  await writeFile(
    join(repository, "clamp.mjs"),
    "export function clamp(n, lo, hi) {\n  return Math.min(Math.max(n, lo), hi);\n}\n",
  );
  referencePatch = `${git(["diff"])}\n`;
  git(["checkout", "--", "."]);
  // The candidate: the floor implemented and tested, the ceiling forgotten.
  await writeFile(join(repository, "clamp.mjs"), withoutCeiling);
  await writeFile(join(repository, "clamp.test.mjs"), suite);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
  await rm(sessions, { recursive: true, force: true });
});

function contractWith(references: boolean): GoalContract {
  return freezeGoalContract({
    version: 1,
    goal: "clamp a number to a range",
    requirements: [
      {
        id: "clamp-bounds",
        description: "clamp(n, lo, hi) returns n limited to the closed range from lo to hi",
        checks: ["clamp-middle"],
      },
    ],
    checks: [
      {
        id: "clamp-middle",
        command: "node --test acceptance/clamp-middle.test.mjs",
        author: "user",
        exposure: "shared",
        artifacts: [
          {
            path: "acceptance/clamp-middle.test.mjs",
            content:
              'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { clamp } from "../clamp.mjs";\ntest("middle", () => assert.equal(clamp(5, 0, 10), 5));\n',
          },
        ],
      },
    ],
    immutablePaths: [],
    challenges: {
      version: 1,
      mutations: "auto",
      fixtures: [],
      ...(references
        ? {
            references: [
              {
                id: "min-max",
                requirement: "clamp-bounds",
                description: "the textbook implementation",
                patch: referencePatch,
              },
            ],
          }
        : {}),
    },
  }).contract;
}

const rangeCheck = {
  id: "clamp-range",
  command: "node --test acceptance/strengthened/clamp-range.test.mjs",
  artifacts: [
    {
      path: "acceptance/strengthened/clamp-range.test.mjs",
      content: [
        'import test from "node:test";',
        'import assert from "node:assert/strict";',
        'import { clamp } from "../../clamp.mjs";',
        'test("bounds both ends", () => {',
        "  assert.equal(clamp(-1, 0, 10), 0);",
        "  assert.equal(clamp(11, 0, 10), 10);",
        "  assert.equal(clamp(5, 0, 10), 5);",
        "});",
        "",
      ].join("\n"),
    },
  ],
  rationale: "correct code bounds both ends; the mutant returns a sentinel below the floor",
};

/** A proposer that answers from a script, recording nothing of its own. */
function scriptedModel(answers: readonly string[]): ModelClient & { calls: number } {
  const model = {
    modelId: "scripted",
    calls: 0,
    async generate() {
      const text = answers[model.calls] ?? "{}";
      model.calls++;
      return {
        text,
        toolCalls: [],
        inputTokens: 10,
        outputTokens: 10,
        finishReason: "stop",
        unsupportedFeatures: [],
        performance: { firstTokenMs: 1, outputTokensPerSecond: 1, responseTimeMs: 1 },
      };
    },
  };
  return model as unknown as ModelClient & { calls: number };
}

async function context(contract: GoalContract) {
  const evidence = await openEvidenceSession({
    root: sessions,
    sessionId: `s-${Date.now()}`,
    clock,
  });
  await declareGoalContract(evidence, contract);
  const goal: TaskGoalContext = {
    contract,
    workspace: repository,
    baseCommit: base,
    evidence,
    clock,
    signal: new AbortController().signal,
    isolation: null,
    install: false,
    challengePolicy: "required",
  };
  return goal;
}

describe("check strengthening and repair", () => {
  it("admits a check that catches the witnessed gap, repairs the candidate, and keeps the originals", async () => {
    const contract = contractWith(true);
    const goal = await context(contract);
    const model = scriptedModel([JSON.stringify(rangeCheck)]);
    const repairs: string[] = [];
    const outcome = await strengthenAndRepair({
      evidence: goal.evidence,
      workspace: repository,
      baseCommit: base,
      root: contract,
      policy: "required",
      limits: strengtheningLimits({}),
      model,
      clock,
      signal: goal.signal,
      deadline: null,
      reserveMs: 30_000,
      remainingTokens: () => 100_000,
      verifyCandidate: (next, policy) => verifyCandidateUnder(goal, next, policy),
      verifyProbe: probeVerifier(goal),
      repair: async (brief) => {
        repairs.push(brief);
        await writeFile(join(repository, "clamp.mjs"), correct);
      },
    });

    expect(model.calls).toBe(1);
    expect(outcome.admitted).toEqual(["clamp-range"]);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toContain("clamp-range");
    expect(outcome.contract.requirements[0]?.checks).toEqual(["clamp-middle", "clamp-range"]);
    expect(outcome.contract.checks[0]).toEqual(contract.checks[0]);

    // The final verification of the exact repaired tree, against the original and admitted checks.
    const final = await verifyCandidateUnder(goal, outcome.contract, "required");
    expect(final.goalAcceptance?.accepted).toBe(true);

    const records = goal.evidence.records();
    const payloads = goal.evidence.payloads();
    const findings = strengtheningAgrees(records, payloads);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((finding) => finding.agrees)).toBe(true);
    expect(challengeVerdictsAgree(records, payloads).every((finding) => finding.agrees)).toBe(true);
    // The admission cites the three probe runs by their goal verifications.
    const admission = [...payloads.values()].find(
      (payload) =>
        (payload as { rule?: string; phase?: string }).rule === "check-admission-v1" &&
        (payload as { phase?: string }).phase === "completed",
    ) as { runs: { purpose: string; status: string }[]; admitted: boolean };
    expect(admission.admitted).toBe(true);
    expect(admission.runs.map((run) => [run.purpose, run.status])).toEqual([
      ["counterexample", "rejected"],
      ["reference", "accepted"],
      ["candidate", "rejected"],
    ]);
  }, 600_000);

  it("admits nothing without a sealed reference, whatever the model proposes, and stops honestly", async () => {
    const contract = contractWith(false);
    const goal = await context(contract);
    const outcome = await strengthenAndRepair({
      evidence: goal.evidence,
      workspace: repository,
      baseCommit: base,
      root: contract,
      policy: "required",
      limits: strengtheningLimits({}),
      model: scriptedModel([JSON.stringify(rangeCheck)]),
      clock,
      signal: goal.signal,
      deadline: null,
      reserveMs: 30_000,
      remainingTokens: () => 100_000,
      verifyCandidate: (next, policy) => verifyCandidateUnder(goal, next, policy),
      verifyProbe: probeVerifier(goal),
      repair: async () => {
        throw new Error("no repair without an admitted check");
      },
    });
    expect(outcome.admitted).toEqual([]);
    expect(outcome.stopped).toBe("no proposed check was admitted");
    expect(outcome.contract).toEqual(contract);
    expect(await readFile(join(repository, "clamp.mjs"), "utf8")).toBe(withoutCeiling);
    const findings = strengtheningAgrees(goal.evidence.records(), goal.evidence.payloads());
    expect(findings.every((finding) => finding.agrees)).toBe(true);
  }, 600_000);

  it("refuses a proposal that would overwrite a pinned or changed file, and never spends a round twice", async () => {
    const contract = contractWith(true);
    const goal = await context(contract);
    const overwrite = {
      ...rangeCheck,
      artifacts: [{ path: "clamp.mjs", content: "export const clamp = (n) => n;\n" }],
    };
    const outcome = await strengthenAndRepair({
      evidence: goal.evidence,
      workspace: repository,
      baseCommit: base,
      root: contract,
      policy: "required",
      limits: strengtheningLimits({ rounds: 5 }),
      model: scriptedModel([JSON.stringify(overwrite)]),
      clock,
      signal: goal.signal,
      deadline: null,
      reserveMs: 30_000,
      remainingTokens: () => 100_000,
      verifyCandidate: (next, policy) => verifyCandidateUnder(goal, next, policy),
      verifyProbe: probeVerifier(goal),
      repair: async () => undefined,
    });
    expect(outcome.admitted).toEqual([]);
    // Five was asked for and two is the ceiling; one was spent and it admitted nothing.
    expect(strengtheningLimits({ rounds: 5 }).rounds).toBe(2);
    expect(strengtheningState(goal.evidence, contract).rounds).toBe(1);
    const refused = [...goal.evidence.payloads().values()].find(
      (payload) => (payload as { rule?: string }).rule === "check-proposal-v1",
    ) as { refused: string };
    expect(refused.refused).toContain("clamp.mjs");
  }, 600_000);
});
