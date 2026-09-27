import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemClock } from "../cli-runtime-inputs.ts";
import { asJsonValue } from "../evidence/canonical-json.ts";
import { freezeGoalContract, type GoalContract } from "../evidence/goal-contract.ts";
import { createSessionId, openEvidenceSession } from "../evidence/session.ts";
import { harnessChildEnvironment } from "../exec/child-environment.ts";
import { verifyGoal } from "./goal-acceptance.ts";
import { ChallengeReconciliationError, challengeGoal } from "./goal-challenges.ts";
import { verifyIndependently } from "./independent-verification.ts";
import { createNodeCommandRunner } from "./node-command-runner.ts";

const run = promisify(execFile);

/**
 * Executed controls for attack families the map in docs/verifier-first/attack-controls.md
 * found held only by a rule, or by nothing: a change outside the selected packages, a goal
 * verification handed the wrong tree, a challenge interrupted between intent and completion,
 * and an acceptance replayed after the contract's checks were revised.
 */
let scratch = "";
let workspace = "";
let base = "";

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const ran = await run("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
  });
  return ran.stdout.trim();
}

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "swarm-attack-controls-"));
  workspace = join(scratch, "repo");
  await mkdir(join(workspace, "packages", "web"), { recursive: true });
  await mkdir(join(workspace, "packages", "api"), { recursive: true });
  await writeFile(
    join(workspace, "package.json"),
    '{ "name": "m", "workspaces": ["packages/*"] }\n',
  );
  for (const unit of ["web", "api"]) {
    await writeFile(
      join(workspace, "packages", unit, "package.json"),
      `{ "name": "${unit}", "version": "1.0.0", "type": "module", "scripts": { "test": "node --test" } }\n`,
    );
    await writeFile(join(workspace, "packages", unit, "lib.mjs"), "export const one = () => 1;\n");
    await writeFile(
      join(workspace, "packages", unit, "lib.test.mjs"),
      'import test from "node:test";\nimport assert from "node:assert/strict";\nimport { one } from "./lib.mjs";\ntest("one", () => assert.equal(one(), 1));\n',
    );
  }
  await writeFile(join(workspace, "clamp.mjs"), "export const clamp = (n) => n;\n");
  await git(workspace, ["init", "-q"]);
  await git(workspace, ["add", "-A"]);
  await git(workspace, ["commit", "-qm", "base"]);
  base = await git(workspace, ["rev-parse", "HEAD"]);
});

afterAll(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function session() {
  const root = await mkdtemp(join(scratch, "session-"));
  const clock = createSystemClock();
  const evidence = await openEvidenceSession({
    root,
    sessionId: createSessionId(clock, { next: () => Math.random() }),
    clock,
  });
  return { evidence, clock };
}

const commands = createNodeCommandRunner(createSystemClock(), harnessChildEnvironment());

describe("family 8: a correct package subset cannot certify a change outside it", () => {
  it("refuses a patch touching a file outside the selected packages, by name, before any check runs", async () => {
    const patch = [
      "diff --git a/packages/web/lib.mjs b/packages/web/lib.mjs",
      "--- a/packages/web/lib.mjs",
      "+++ b/packages/web/lib.mjs",
      "@@ -1 +1 @@",
      "-export const one = () => 1;",
      "+export const one = () => 1 + 0;",
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (n) => n;",
      "+export const clamp = (n) => (n < 0 ? 0 : n);",
      "",
    ].join("\n");
    const { evidence, clock } = await session();
    // Refused before any checkout is made or any check runs, with the offending file named.
    await expect(
      verifyIndependently({
        repositoryRoot: workspace,
        baseCommit: base,
        patch,
        commands,
        clock,
        evidence,
        gateOptions: { packages: ["packages/web"] },
      }),
    ).rejects.toThrow(/outside selected packages is unverified: clamp\.mjs/);
    expect(evidence.records().some((entry) => entry.type === "gate-run")).toBe(false);
  }, 120_000);
});

describe("family 6: a goal verification is bound to the exact tree it names", () => {
  it("refuses to run the contract's checks over a checkout whose tree is not the one named", async () => {
    const { evidence } = await session();
    const contract: GoalContract = {
      version: 1,
      goal: "one",
      requirements: [{ id: "r", description: "r", checks: ["c"] }],
      checks: [{ id: "c", command: "true", author: "user", exposure: "withheld", artifacts: [] }],
      immutablePaths: [],
      selection: "stable",
    };
    const { contract: frozen, digest } = freezeGoalContract(contract);
    await evidence.record({
      type: "goal-contract",
      actor: "harness",
      provenance: ["user"],
      payload: asJsonValue({ contract: frozen, digest }),
    });
    const checkout = join(scratch, "wrong-tree");
    await run("git", ["clone", "-q", workspace, checkout]);
    await expect(
      verifyGoal({
        contract: frozen,
        evidence,
        checkout,
        tree: "0".repeat(40),
        commands,
        timeoutMs: 30_000,
      }),
    ).rejects.toThrow(/does not match the exact integrated tree/);
    expect(evidence.records().some((entry) => entry.type === "goal-check")).toBe(false);
  }, 60_000);
});

describe("family 11: an interrupted challenge is reconciled before another runs", () => {
  it("refuses to challenge over an intent that no completion answers, naming the challenge", async () => {
    const { evidence } = await session();
    const contract: GoalContract = {
      version: 1,
      goal: "one",
      requirements: [{ id: "r", description: "r", checks: ["c"] }],
      checks: [{ id: "c", command: "true", author: "user", exposure: "withheld", artifacts: [] }],
      immutablePaths: [],
      selection: "stable",
    };
    const { contract: frozen, digest } = freezeGoalContract(contract);
    const plan = await evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "challenge-plan-v1",
        contractDigest: digest,
        policy: "required",
        mutants: ["lib.mjs:1:negate-condition"],
        fixtures: [],
      }),
    });
    await evidence.record({
      type: "verification-command",
      actor: "harness",
      provenance: ["tool-output"],
      payload: asJsonValue({
        rule: "challenge-run-v1",
        phase: "intent",
        plan: plan.record.payloadDigest,
        id: "lib.mjs:1:negate-condition",
        kind: "mutant",
      }),
    });
    const runner = {
      read: async () => null,
      write: async () => undefined,
      parses: async () => true,
      runContractChecks: async () => ({ tree: "a".repeat(40), checks: [] }),
      runRepositoryChecks: async () => [],
      applyFixture: async () => ({ applied: false, detail: "" }),
      restore: async () => true,
    };
    await expect(
      challengeGoal({
        contract: frozen,
        contractDigest: digest,
        policy: "required",
        evidence,
        runner,
        changed: [],
        candidate: null,
        baseControl: null,
        checksWithPatch: [],
      }),
    ).rejects.toThrow(ChallengeReconciliationError);
    // Nothing was executed and no plan was written over the unfinished one.
    const plans = evidence
      .records()
      .filter(
        (entry) =>
          (evidence.payloads().get(entry.payloadDigest) as { rule?: string })?.rule ===
          "challenge-plan-v1",
      );
    expect(plans).toHaveLength(1);
  });
});

describe("family 12: an acceptance under one contract is not evidence under a revised one", () => {
  it("derives a fresh verdict for a revised contract and never cites the earlier one", async () => {
    const fix = [
      "diff --git a/clamp.mjs b/clamp.mjs",
      "--- a/clamp.mjs",
      "+++ b/clamp.mjs",
      "@@ -1 +1 @@",
      "-export const clamp = (n) => n;",
      "+export const clamp = (n) => (n < 0 ? 0 : n);",
      "",
    ].join("\n");
    const check = (source: string) => ({
      id: "negative",
      command: "pinned CLI output check",
      author: "user" as const,
      exposure: "withheld" as const,
      artifacts: [],
      behavior: {
        kind: "cli" as const,
        cwd: ".",
        timeoutMs: 5000,
        maxOutputBytes: 4000,
        toolchain: "node",
        network: "inherit" as const,
        environment: {},
        argv: ["node", "--input-type=module", "-e", source],
        stdin: "",
        exitCode: 0,
        stdout: [{ kind: "equals" as const, value: "ok\n" }],
        stderr: [],
      },
    });
    const contractOf = (source: string): GoalContract => ({
      version: 1,
      goal: "clamp",
      requirements: [
        { id: "negative-input", description: "negative inputs return zero", checks: ["negative"] },
      ],
      checks: [check(source)],
      immutablePaths: [],
      selection: "stable",
    });
    const weak = contractOf(
      "import {clamp} from './clamp.mjs'; console.log(clamp(5) === 5 ? 'ok' : 'wrong')",
    );
    const strong = contractOf(
      "import {clamp} from './clamp.mjs'; console.log(clamp(-1) === 0 ? 'ok' : 'wrong')",
    );
    const first = await session();
    const accepted = await verifyIndependently({
      repositoryRoot: workspace,
      baseCommit: base,
      patch: fix,
      commands,
      clock: first.clock,
      evidence: first.evidence,
      goal: { contract: weak, evidence: first.evidence, tree: "", challengePolicy: "report" },
    });
    expect(accepted.task).toBe("accepted");
    const weakDigest = freezeGoalContract(weak).digest;
    const strongDigest = freezeGoalContract(strong).digest;
    expect(weakDigest).not.toBe(strongDigest);

    // The revised contract runs on its own chain: every record it cites carries its own digest,
    // and the earlier acceptance is cited by nothing.
    const second = await session();
    const revised = await verifyIndependently({
      repositoryRoot: workspace,
      baseCommit: base,
      patch: fix,
      commands,
      clock: second.clock,
      evidence: second.evidence,
      goal: { contract: strong, evidence: second.evidence, tree: "", challengePolicy: "required" },
    });
    const digestsCited = second.evidence
      .records()
      .map(
        (entry) =>
          second.evidence.payloads().get(entry.payloadDigest) as { contractDigest?: string },
      )
      .filter((payload) => typeof payload?.contractDigest === "string")
      .map((payload) => payload.contractDigest);
    expect(digestsCited.length).toBeGreaterThan(0);
    expect(new Set(digestsCited)).toEqual(new Set([strongDigest]));
    expect(revised.goalAcceptance?.contractDigest).toBe(strongDigest);
    expect(revised.challenges?.requirements[0]?.outcome).toBe("detected");
    // And the weak contract's own challenge reading stands as it was: a gap, not detection.
    expect(accepted.challenges?.requirements[0]?.outcome).toBe("gap");
  }, 240_000);
});
