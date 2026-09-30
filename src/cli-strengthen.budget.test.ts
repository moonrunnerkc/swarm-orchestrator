import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  proposalAllowance,
  proposalOutputCeiling,
  remainingTokenBudget,
  strengthenAndRepair,
  strengtheningLimits,
  strengtheningRoundRule,
} from "./cli-strengthen.ts";
import type { ModelClient, ModelRequest } from "./core/model-client.ts";
import {
  declareGoalContract,
  freezeGoalContract,
  type GoalContract,
} from "./evidence/goal-contract.ts";
import { createRecordingModelClient } from "./evidence/model-call-recording.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./evidence/session.ts";
import type { ProbeVerifier } from "./gates/check-admission.ts";
import { defaultDiffBudget, sealAssembledCriteria } from "./gates/engine.ts";
import type { ChallengeReport } from "./gates/goal-challenges.ts";
import { jsonResultLine, type MachineResult } from "./machine-output.ts";

/**
 * The token budget is read before every proposal, not once per round. Found by review of the
 * controller: a round with two requirements checked the budget at its start, asked the first
 * proposal for at least 256 output tokens against 128 left, and then asked the second against
 * nothing. The budget the controller reads is the one the command line wires, the task's
 * allowance less every model call the chain records, so these run the real recording wrapper.
 */
let root = "";
let repository = "";
let base = "";
const clock = { now: () => Date.now(), sleep: () => Promise.resolve() };
const referencePatch = "diff --git a/reference b/reference\n";

const contract: GoalContract = freezeGoalContract({
  version: 1,
  goal: "two requirements, each with a witnessed gap",
  requirements: [
    { id: "first", description: "the first requirement", checks: ["first-check"] },
    { id: "second", description: "the second requirement", checks: ["second-check"] },
  ],
  checks: [
    { id: "first-check", command: "true", author: "user", exposure: "shared", artifacts: [] },
    { id: "second-check", command: "true", author: "user", exposure: "shared", artifacts: [] },
  ],
  immutablePaths: [],
  challenges: {
    version: 1,
    mutations: "none",
    fixtures: [],
    references: [
      { id: "ref-first", requirement: "first", description: "x", patch: referencePatch },
      { id: "ref-second", requirement: "second", description: "x", patch: referencePatch },
    ],
  },
}).contract;

/** Both requirements' checks accepted the base, so the base tree is each one's counterexample. */
const report: ChallengeReport = {
  policy: "required",
  contractDigest: freezeGoalContract(contract).digest,
  seed: "swarm-challenge-seed-v1" as ChallengeReport["seed"],
  operators: "swarm-mutation-operators-v1" as ChallengeReport["operators"],
  baseTree: "base",
  alternatives: [],
  requirements: ["first", "second"].map((id) => ({
    id,
    baseControl: "vacuous",
    caught: [],
    gaps: [],
    unwitnessed: [],
    invalid: [],
    outcome: "gap",
    detail: "",
  })),
  satisfied: false,
  record: "challenge",
};

function proposalFor(requirement: string): string {
  return JSON.stringify({
    id: `added-${requirement}`,
    command: `node --test acceptance/strengthened/${requirement}.test.mjs`,
    artifacts: [{ path: `acceptance/strengthened/${requirement}.test.mjs`, content: "// t\n" }],
    rationale: "rejects the base, accepts the reference",
  });
}

/** Answers from a script and reports a fixed usage per call, so a budget is spent predictably. */
function scriptedModel(
  answers: readonly string[],
  usage: { inputTokens: number; outputTokens: number },
): ModelClient & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    modelId: "scripted",
    requests,
    async generate(request) {
      requests.push(request);
      return {
        text: answers[requests.length - 1] ?? "{}",
        toolCalls: [],
        ...usage,
        finishReason: "stop",
        unsupportedFeatures: [],
        performance: { firstTokenMs: 1, outputTokensPerSecond: 1, responseTimeMs: 1 },
      };
    },
  };
}

/** Accepts the reference and rejects everything else, so every valid proposal is admitted. */
const probe: ProbeVerifier = async (patch, probeContract) => ({
  policy: "goal-obligations-v1",
  contractDigest: freezeGoalContract(probeContract).digest,
  tree: "probe",
  obligations: probeContract.requirements.map((requirement) => ({
    id: requirement.id,
    status: patch === referencePatch ? "accepted" : "rejected",
    checks: requirement.checks,
  })),
  accepted: patch === referencePatch,
});

async function sealedSession(): Promise<EvidenceRecorder> {
  const evidence = await openEvidenceSession({
    root: join(root, "sessions"),
    sessionId: `budget-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    clock,
  });
  await declareGoalContract(evidence, contract);
  const sealed = await sealAssembledCriteria({
    workspaceRoot: repository,
    criteriaRef: base,
    evidence,
    budgets: defaultDiffBudget,
    attemptCap: 1,
  });
  expect(sealed).toBe(true);
  return evidence;
}

/** The controller as the command line wires it: the model recorded, the budget read from the chain. */
async function strengthenUnder(options: {
  readonly budget: number;
  readonly answers: readonly string[];
  readonly usage: { inputTokens: number; outputTokens: number };
}) {
  const evidence = await sealedSession();
  const scripted = scriptedModel(options.answers, options.usage);
  const repairs: string[] = [];
  const outcome = await strengthenAndRepair({
    evidence,
    workspace: repository,
    baseCommit: base,
    root: contract,
    policy: "required",
    limits: strengtheningLimits({ rounds: 1 }),
    model: createRecordingModelClient(scripted, evidence),
    clock,
    signal: new AbortController().signal,
    deadline: null,
    reserveMs: 0,
    remainingTokens: () => remainingTokenBudget(evidence, options.budget),
    verifyCandidate: async () => ({ challenges: report, verified: false }),
    verifyProbe: probe,
    repair: async (brief) => {
      repairs.push(brief);
    },
  });
  return { evidence, scripted, repairs, outcome };
}

function roundOutcomes(evidence: EvidenceRecorder): string[] {
  return [...evidence.payloads().values()]
    .map((payload) => payload as { rule?: string; phase?: string; outcome?: string })
    .filter((payload) => payload.rule === strengtheningRoundRule && payload.phase === "completed")
    .map((payload) => payload.outcome ?? "");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-strengthen-budget-"));
  repository = join(root, "repo");
  execFileSync("mkdir", ["-p", repository]);
  const git = (...words: string[]) =>
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...words], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
  git("init", "-q");
  await writeFile(join(repository, "a.mjs"), "export const a = 1;\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  base = git("rev-parse", "HEAD");
  await writeFile(join(repository, "a.mjs"), "export const a = 2;\n");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("the proposal allowance", () => {
  it("is the ceiling when the budget is uncapped, what is left when that is smaller, and nothing when nothing is left", () => {
    expect(proposalAllowance(null)).toBe(proposalOutputCeiling);
    expect(proposalAllowance(10_000)).toBe(proposalOutputCeiling);
    expect(proposalAllowance(128)).toBe(128);
    expect(proposalAllowance(1)).toBe(1);
    expect(proposalAllowance(0)).toBeNull();
    expect(proposalAllowance(-5)).toBeNull();
  });
});

describe("the remaining token budget", () => {
  it("is the allowance less every recorded call, and nothing once any call's usage is unknown", async () => {
    const evidence = await sealedSession();
    expect(remainingTokenBudget(evidence, 1000)).toBe(1000);
    const spending = createRecordingModelClient(
      scriptedModel(["{}"], { inputTokens: 300, outputTokens: 100 }),
      evidence,
    );
    const request = {
      system: "s",
      messages: [{ role: "user" as const, text: "t" }],
      tools: [],
      maxOutputTokens: 10,
      abortSignal: new AbortController().signal,
    };
    await spending.generate(request);
    expect(remainingTokenBudget(evidence, 1000)).toBe(600);
    const failing = createRecordingModelClient(
      {
        modelId: "failing",
        generate: () => Promise.reject(new Error("the endpoint closed the connection")),
      },
      evidence,
    );
    await expect(failing.generate(request)).rejects.toThrow(/closed/);
    expect(remainingTokenBudget(evidence, 1000)).toBe(0);
  });
});

describe("strengthening under a token budget", () => {
  it("asks the model nothing when the budget is spent before the first proposal", async () => {
    const { scripted, repairs, outcome } = await strengthenUnder({
      budget: 0,
      answers: [proposalFor("first"), proposalFor("second")],
      usage: { inputTokens: 100, outputTokens: 28 },
    });
    expect(scripted.requests).toHaveLength(0);
    expect(repairs).toEqual([]);
    expect(outcome.stopped).toBe("the task's token budget is spent");
    expect(outcome.rounds).toBe(0);
    expect(outcome.admitted).toEqual([]);
  });

  it("asks for no more output than the budget holds, and never raises a small budget to a floor", async () => {
    const { evidence, scripted } = await strengthenUnder({
      budget: 128,
      answers: [proposalFor("first"), proposalFor("second")],
      usage: { inputTokens: 100, outputTokens: 28 },
    });
    expect(scripted.requests.map((request) => request.maxOutputTokens)).toEqual([128]);
    // The same number is what the chain says the model was asked for.
    const recorded = [...evidence.payloads().values()]
      .map((payload) => payload as { prompt?: { maxOutputTokens?: number } })
      .filter((payload) => payload.prompt?.maxOutputTokens !== undefined)
      .map((payload) => payload.prompt?.maxOutputTokens);
    expect(recorded).toEqual([128]);
  });

  it("stops between requirements once the first proposal spends the budget, and does not repair on nothing", async () => {
    const { evidence, scripted, repairs, outcome } = await strengthenUnder({
      budget: 128,
      answers: [proposalFor("first"), proposalFor("second")],
      usage: { inputTokens: 100, outputTokens: 28 },
    });
    // One proposal was asked and admitted; the second requirement's gap was left, and so was the
    // repair, because a model call against nothing is not a repair.
    expect(scripted.requests).toHaveLength(1);
    expect(outcome.admitted).toEqual(["added-first"]);
    expect(repairs).toEqual([]);
    expect(outcome.stopped).toBe("the task's token budget is spent");
    expect(outcome.rounds).toBe(1);
    // The admitted check revised the contract, so the final verification judges it too.
    expect(outcome.digest).not.toBe(freezeGoalContract(contract).digest);
    expect(outcome.contract.checks.map((check) => check.id)).toContain("added-first");
    expect(roundOutcomes(evidence)).toEqual(["budget-spent"]);

    // The machine result the command line prints carries the stop, never a completion.
    const result: MachineResult = {
      runId: evidence.sessionId,
      verdict: null,
      bundleDirectory: null,
      exitCode: 1,
      strengthening: {
        rounds: outcome.rounds,
        admitted: outcome.admitted,
        stopped: outcome.stopped,
        contractDigest: outcome.digest,
      },
    };
    const printed = JSON.parse(jsonResultLine(result)) as {
      strengthening: { stopped: string; rounds: number };
    };
    expect(printed.strengthening.stopped).toBe("the task's token budget is spent");
    expect(printed.strengthening.rounds).toBe(1);
  });

  it("names the spent budget when the only proposal it could afford was refused", async () => {
    const { evidence, scripted, repairs, outcome } = await strengthenUnder({
      budget: 128,
      answers: ["not a proposal", proposalFor("second")],
      usage: { inputTokens: 100, outputTokens: 28 },
    });
    expect(scripted.requests).toHaveLength(1);
    expect(repairs).toEqual([]);
    expect(outcome.admitted).toEqual([]);
    expect(outcome.stopped).toBe("the task's token budget is spent");
    expect(outcome.digest).toBe(freezeGoalContract(contract).digest);
    expect(roundOutcomes(evidence)).toEqual(["budget-spent"]);
  });

  it("strengthens every requirement and repairs when the budget holds", async () => {
    const { evidence, scripted, repairs, outcome } = await strengthenUnder({
      budget: 100_000,
      answers: [proposalFor("first"), proposalFor("second")],
      usage: { inputTokens: 100, outputTokens: 28 },
    });
    expect(scripted.requests.map((request) => request.maxOutputTokens)).toEqual([
      proposalOutputCeiling,
      proposalOutputCeiling,
    ]);
    expect(outcome.admitted).toEqual(["added-first", "added-second"]);
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toContain("added-first");
    expect(repairs[0]).toContain("added-second");
    expect(outcome.stopped).toBe("the round limit was reached");
    expect(roundOutcomes(evidence)).toEqual(["repaired"]);
  });
});
