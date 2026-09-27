import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "../evidence/goal-contract.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import type { GoalVerification } from "./goal-acceptance.ts";
import {
  type AlternativeOutcome,
  type ChallengeRunner,
  type ContractRun,
  challengeGoal,
  readBaseControl,
  readRequirementOutcome,
  requirementStatus,
} from "./goal-challenges.ts";

const contractValue: GoalContract = {
  version: 1,
  goal: "clamp negatives",
  requirements: [
    { id: "negative", description: "negative inputs return zero", checks: ["neg"] },
    { id: "unchecked", description: "nothing binds this", checks: [] },
  ],
  checks: [
    {
      id: "neg",
      command: "node check.mjs",
      author: "user",
      exposure: "withheld",
      artifacts: [],
    },
  ],
  immutablePaths: [],
  selection: "stable",
  challenges: {
    version: 1,
    mutations: "auto",
    fixtures: [
      {
        id: "returns-input",
        requirement: "negative",
        description: "returns the input unchanged",
        patch: "diff --git a/clamp.mjs b/clamp.mjs\n",
      },
    ],
  },
};

function alternative(overrides: Partial<AlternativeOutcome>): AlternativeOutcome {
  return {
    id: "clamp.mjs:1:invert-comparison",
    kind: "mutant",
    parse: "not-checked",
    tree: "a".repeat(40),
    requirements: [{ id: "negative", status: "rejected" }],
    suite: "not-run",
    witness: "not-adjudicated",
    ...overrides,
  };
}

describe("the per-requirement reading", () => {
  const requirement = contractValue.requirements[0] as GoalContract["requirements"][number];

  it("is detected when the checks reject the base and every executed alternative", () => {
    const reading = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "discriminates",
      alternatives: [
        alternative({}),
        alternative({
          id: "b",
          kind: "fixture",
          fixture: { id: "b", requirement: "negative", digest: "sha256:x" },
        }),
      ],
    });
    expect(reading.outcome).toBe("detected");
    expect(reading.caught).toEqual(["clamp.mjs:1:invert-comparison", "b"]);
  });

  it("is a gap when a survivor is witnessed by the repository suite or declared by a fixture", () => {
    const suite = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "discriminates",
      alternatives: [
        alternative({
          requirements: [{ id: "negative", status: "accepted" }],
          suite: "failed",
          witness: "repository-suite",
        }),
      ],
    });
    expect(suite.outcome).toBe("gap");
    const fixture = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "discriminates",
      alternatives: [
        alternative({
          id: "f",
          kind: "fixture",
          fixture: { id: "f", requirement: "negative", digest: "sha256:x" },
          requirements: [{ id: "negative", status: "accepted" }],
          witness: "declared-fixture",
        }),
      ],
    });
    expect(fixture.outcome).toBe("gap");
    expect(fixture.gaps).toEqual(["f"]);
  });

  it("is unjudged, not a gap, when a survivor has no witness that it changed the program", () => {
    const reading = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "discriminates",
      alternatives: [
        alternative({
          requirements: [{ id: "negative", status: "accepted" }],
          suite: "passed",
          witness: "none",
        }),
      ],
    });
    expect(reading.outcome).toBe("unjudged");
    expect(reading.unwitnessed).toHaveLength(1);
    expect(reading.detail).toContain("uncertainty, not a defect");
  });

  it("is a gap when the checks accept the base as well, whatever the alternatives did", () => {
    const reading = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "vacuous",
      alternatives: [alternative({})],
    });
    expect(reading.outcome).toBe("gap");
  });

  it("names a requirement with no check as a missing obligation", () => {
    const reading = readRequirementOutcome({
      requirement: contractValue.requirements[1] as GoalContract["requirements"][number],
      candidate: "unjudged",
      baseControl: "unavailable",
      alternatives: [alternative({})],
    });
    expect(reading.outcome).toBe("gap");
    expect(reading.detail).toContain("no check is bound");
  });

  it("does not credit a mutant that failed to parse, and counts a fixture that did not apply as invalid", () => {
    const reading = readRequirementOutcome({
      requirement,
      candidate: "accepted",
      baseControl: "discriminates",
      alternatives: [
        alternative({ parse: "syntax-error", requirements: [] }),
        alternative({
          id: "f",
          kind: "fixture",
          fixture: { id: "f", requirement: "negative", digest: "sha256:x" },
          parse: "not-applied",
          requirements: [],
        }),
      ],
    });
    expect(reading.outcome).toBe("invalid-evidence");
    expect(reading.caught).toEqual([]);
    expect(reading.invalid).toEqual(["f"]);
  });

  it("reads a refactor base as preserved and any other accepted base as vacuous", () => {
    const base: GoalVerification = {
      policy: "goal-obligations-v1",
      contractDigest: "sha256:c",
      tree: "b".repeat(40),
      obligations: [{ id: "negative", status: "accepted", checks: [] }],
      accepted: true,
    };
    expect(readBaseControl("negative", base, "refactor")).toBe("preserved");
    expect(readBaseControl("negative", base, undefined)).toBe("vacuous");
    expect(readBaseControl("negative", null, undefined)).toBe("not-run");
    expect(readBaseControl("absent", base, undefined)).toBe("unavailable");
  });

  it("derives a requirement's status by the goal verifier's rule", () => {
    expect(requirementStatus(requirement, [{ id: "neg", status: "accepted" }])).toBe("accepted");
    expect(requirementStatus(requirement, [{ id: "neg", status: "rejected" }])).toBe("rejected");
    expect(requirementStatus(requirement, [])).toBe("unjudged");
  });
});

describe("running the challenges", () => {
  let root = "";
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "swarm-challenges-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  /** A runner over a one-file "checkout" held in memory, whose check rejects a flipped comparison. */
  function fakeRunner(options: {
    readonly suiteRefusesMutants: boolean;
    readonly fixtureApplies: boolean;
  }) {
    const files = new Map<string, string>([
      ["clamp.mjs", "export const clamp = (n) => n < 0 ? 0 : n;\n"],
    ]);
    const calls: string[] = [];
    let fixtureApplied = false;
    const runner: ChallengeRunner = {
      read: async (path) => files.get(path) ?? null,
      write: async (path, text) => {
        files.set(path, text);
      },
      parses: async () => true,
      runContractChecks: async (): Promise<ContractRun> => {
        calls.push("contract");
        const source = files.get("clamp.mjs") ?? "";
        // The check "rejects" a mutant whose comparison was inverted; a fixture is accepted here
        // on purpose, which is the gap a declared fixture exposes.
        const rejected = source.includes(">= 0") || source.includes("n >");
        return {
          tree: "c".repeat(40),
          checks: [
            {
              id: "neg",
              status: fixtureApplied ? "accepted" : rejected ? "rejected" : "accepted",
              detail: "",
            },
          ],
        };
      },
      runRepositoryChecks: async () => {
        calls.push("suite");
        return [{ id: "tests", status: options.suiteRefusesMutants ? "failed" : "passed" }];
      },
      applyFixture: async () => {
        calls.push("fixture");
        fixtureApplied = options.fixtureApplies;
        return {
          applied: options.fixtureApplies,
          detail: options.fixtureApplies ? "applied" : "does not apply",
        };
      },
      restore: async () => {
        fixtureApplied = false;
        return true;
      },
    };
    return { runner, files, calls };
  }

  async function session() {
    const evidence = await openEvidenceSession({
      root,
      sessionId: createSessionId({ now: () => 1, sleep: async () => {} }, { next: () => 0.5 }),
      clock: { now: () => 1, sleep: async () => {} },
    });
    const { contract, digest } = freezeGoalContract(contractValue);
    await evidence.record({
      type: "goal-contract",
      actor: "harness",
      provenance: ["user"],
      payload: asJsonValue({ contract, digest }),
    });
    return { evidence, contract, digest };
  }

  const candidate: GoalVerification = {
    policy: "goal-obligations-v1",
    contractDigest: "sha256:c",
    tree: "d".repeat(40),
    obligations: [
      { id: "negative", status: "accepted", checks: [] },
      { id: "unchecked", status: "unjudged", checks: [] },
    ],
    accepted: false,
  };
  const base: GoalVerification = {
    ...candidate,
    tree: "b".repeat(40),
    obligations: [
      { id: "negative", status: "rejected", checks: [] },
      { id: "unchecked", status: "unjudged", checks: [] },
    ],
  };
  const changed = [
    {
      path: "clamp.mjs",
      addedLines: [{ line: 1, text: "export const clamp = (n) => n < 0 ? 0 : n;" }],
    },
  ];

  it("writes the plan before any run, records every alternative, and restores what it wrote", async () => {
    const { evidence, contract, digest } = await session();
    const { runner, files, calls } = fakeRunner({
      suiteRefusesMutants: true,
      fixtureApplies: true,
    });
    const report = await challengeGoal({
      contract,
      contractDigest: digest,
      policy: "required",
      evidence,
      runner,
      changed,
      candidate: { ...candidate, contractDigest: digest },
      baseControl: { ...base, contractDigest: digest },
      checksWithPatch: [{ id: "tests", status: "passed" }],
    });
    const rules = evidence
      .records()
      .filter((entry) => entry.type === "verification-command")
      .map(
        (entry) =>
          (evidence.payloads().get(entry.payloadDigest) as { rule: string; phase?: string }).rule,
      );
    expect(rules[0]).toBe("challenge-plan-v1");
    expect(rules.at(-1)).toBe("challenge-verdict-v1");
    expect(rules.filter((rule) => rule === "challenge-run-v1").length).toBe(
      report.alternatives.length * 2,
    );
    expect(files.get("clamp.mjs")).toBe("export const clamp = (n) => n < 0 ? 0 : n;\n");
    expect(calls.filter((call) => call === "fixture")).toHaveLength(1);
    const negative = report.requirements.find((entry) => entry.id === "negative");
    // The declared fixture was accepted by the check, which is the gap it exists to expose.
    expect(negative?.gaps).toEqual(["returns-input"]);
    expect(negative?.outcome).toBe("gap");
    expect(report.requirements.find((entry) => entry.id === "unchecked")?.outcome).toBe("gap");
    expect(report.satisfied).toBe(false);
  });

  it("spends at most the suite-run allowance on witnessing survivors", async () => {
    const { evidence, contract, digest } = await session();
    const noMutantDetection: GoalContract = {
      ...contractValue,
      challenges: { version: 1, mutations: "auto", fixtures: [] },
    };
    const frozen = freezeGoalContract(noMutantDetection);
    const { runner, calls } = fakeRunner({ suiteRefusesMutants: false, fixtureApplies: false });
    // A check that accepts everything: every mutant survives and each asks the suite once.
    runner.runContractChecks = async () => ({
      tree: "c".repeat(40),
      checks: [{ id: "neg", status: "accepted", detail: "" }],
    });
    const report = await challengeGoal({
      contract: frozen.contract,
      contractDigest: frozen.digest,
      policy: "report",
      evidence,
      runner,
      changed,
      candidate: { ...candidate, contractDigest: frozen.digest },
      baseControl: { ...base, contractDigest: frozen.digest },
      checksWithPatch: [{ id: "tests", status: "passed" }],
      suiteRunLimit: 1,
    });
    expect(calls.filter((call) => call === "suite")).toHaveLength(1);
    const negative = report.requirements.find((entry) => entry.id === "negative");
    expect(negative?.outcome).toBe("unjudged");
    expect(negative?.unwitnessed.length).toBeGreaterThan(0);
    void contract;
    void digest;
  });
});
