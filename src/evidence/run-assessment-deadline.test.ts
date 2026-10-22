import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentLoopOutcome } from "../core/loop.ts";
import { createTestClock, type TestClock } from "../core/test-doubles.ts";
import type { GatesEngineRun } from "../gates/engine.ts";
import { bundleSourceFromRecorder, exportBundle } from "./bundle.ts";
import type { JsonValue } from "./canonical-json.ts";
import type { RecordType } from "./ledger-record.ts";
import { recordGoalAssessment, recordRunAssessment, runLifecycle } from "./run-assessment.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { createEphemeralSigningKey } from "./signing.ts";
import type { TaskContract } from "./task-contract.ts";
import type { RunVerdict } from "./verdict.ts";
import { verifyBundle } from "./verifier/verify.mjs";

/**
 * The final assessment of a run whose allowance ends in two places: model work at
 * `modelWorkEnds`, the checks at `deadline`. Each case is a chain recorded on an injected clock,
 * assessed by the product's own functions, exported, and re-derived by the bundled verifier. The
 * times are launch 2's of 2026-10-21 relative to its start: model work ended 73 seconds before a
 * nine-minute deadline, the repair was cut at 445.5 s and the final verification finished at
 * 503.3 s.
 */

const start = 1_792_601_630_000;
const deadline = start + 540_000;
const modelWorkEnds = deadline - 73_040;
const cutAt = start + 445_500;
const verifiedAt = start + 503_300;

let root = "";
let clock: TestClock;
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-deadline-"));
  clock = createTestClock(start);
  evidence = await openEvidenceSession({ root, sessionId: "deadline-session", clock });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const at = (time: number) => {
  clock.advance(time - clock.now());
};

const record = async (type: RecordType, payload: Record<string, JsonValue>) =>
  (await evidence.record({ type, actor: "harness", provenance: ["tool-output"], payload })).record
    .payloadDigest;

const contract = {
  taskId: "value",
  requiredChecks: ["task-acceptance"],
} as unknown as TaskContract;

interface Chain {
  /** Whether the run recorded a verification reserve, as a run with a total allowance does. */
  readonly reserve?: boolean;
  readonly stopReason?: AgentLoopOutcome["stopReason"];
  readonly stoppedAt?: number;
  /** Write and shell calls: when each settled, or null where it never did. */
  readonly effects?: readonly (number | null)[];
  readonly acceptance?: "passed" | "failed";
}

/** A run's chain up to its worker assessment: the reserve, the loop, the final cycle, the diff. */
async function recordRun(chain: Chain = {}) {
  if (chain.reserve !== false)
    await record("session-budget", {
      rule: "verification-reserve-v1",
      basis: "measured",
      reserveMs: deadline - modelWorkEnds,
      deadline,
      modelWorkEnds,
    });
  await record("run-spec-sealed", { spec: { repository: { baseCommit: "base" } } });
  await record("task-contract", { phase: "effective", requiredChecks: ["task-acceptance"] });
  for (const [index, settledAt] of (chain.effects ?? [start + 60_000]).entries()) {
    at(Math.min(settledAt ?? cutAt, cutAt) - 1);
    const call = { callId: `call-${index}`, toolName: "write", kind: "write" };
    await record("tool-call", { ...call, decision: "requested" });
    if (settledAt === null) continue;
    at(settledAt);
    await record("tool-call", { ...call, decision: "allowed" });
  }
  at(Math.max(clock.now(), chain.stoppedAt ?? cutAt));
  await record("session-stopped", {
    stopReason: chain.stopReason ?? "max-wall-time",
    steps: 26,
    tokensUsed: 1000,
  });
  const gate = async (
    gateId: string,
    capability: string,
    status: "passed" | "failed",
    measures: Record<string, number> = {},
  ) => ({
    gateId,
    capability,
    status,
    severity: "blocking" as const,
    detail: `the command ${status}`,
    measures,
    record: await record("gate-run", {
      gateId,
      capability,
      status,
      severity: "blocking",
      attempt: 0,
      measures,
    }),
  });
  const runs = [
    await gate("build", "static", "passed"),
    await gate("tests", "dynamic", "passed", { changedFiles: 2 }),
    await gate("file-set", "policy", "passed"),
    await gate("task-acceptance", "dynamic", chain.acceptance ?? "passed"),
  ];
  const ratchetRecord = await record("ratchet-decision", { scope: "base", accepted: true });
  await record("workspace-diff", { rawPatchDigest: "sha256:delivered", patch: "+value\n" });
  return {
    outcome: {
      settled: "green",
      baseComparison: { decision: { accepted: true }, ratchetRecord },
      finalCycle: {
        runs,
        measures: { changedFiles: 2 },
        blockingFailures: runs.filter((run) => run.status === "failed"),
        advisoryFailures: [],
      },
    },
    bonds: [],
  } as unknown as GatesEngineRun;
}

/** The worker assessment as a run records it, with the lifecycle read by the product's rule. */
async function assess(gates: GatesEngineRun, cancelled = false): Promise<RunVerdict> {
  return recordRunAssessment(
    evidence,
    gates,
    runLifecycle(evidence) ?? "completed",
    "restricted",
    cancelled,
    contract,
  );
}

/** The final independent verification of the delivered patch, and the goal assessment over it. */
async function verifyFinally(verification: Record<string, JsonValue> = {}): Promise<RunVerdict> {
  at(verifiedAt);
  // A verification that refused before running anything carries its refusal and no policy.
  const judged =
    verification.refusal === undefined
      ? { certificationPolicy: "goal-obligations-v1", regression: "pass" }
      : {};
  const digest = await record("independent-verification", {
    ...judged,
    verified: true,
    task: "accepted",
    advice: "",
    sourcePatchDigest: "sha256:delivered",
    sourceBase: "base",
    ...verification,
  });
  return recordGoalAssessment(evidence, digest);
}

/** The bundled verifier's reading of every run assessment on the exported chain. */
async function rederived(): Promise<readonly string[]> {
  const destination = join(root, `bundle-${clock.now()}`);
  await exportBundle({
    source: bundleSourceFromRecorder(evidence),
    destination,
    signingKey: createEphemeralSigningKey(),
    clock,
  });
  const lines: string[] = [];
  verifyBundle(destination, (line: string) => lines.push(line));
  return lines.filter((line) => /run assessment \d+ re-derived/.test(line));
}

/** Every assessment on the chain re-derived, and at least one was there to re-derive. */
async function expectRederived(): Promise<void> {
  const checks = await rederived();
  expect(checks.length).toBeGreaterThan(0);
  for (const line of checks) expect(line).toContain("PASS");
}

const workerInputs = () =>
  (
    evidence
      .payloads()
      .get(
        evidence.records().findLast((entry) => entry.type === "run-assessment")?.payloadDigest ??
          "",
      ) as { inputs: Record<string, unknown> }
  ).inputs;

describe("a run whose model work was cut before its deadline", () => {
  it("is decided by the complete passing checks of the delivered tree, and keeps its lifecycle", async () => {
    const worker = await assess(await recordRun());
    expect(workerInputs()).toMatchObject({
      policy: "run-acceptance-v5",
      lifecycle: "max-wall-time",
      wallStop: { beforeDeadline: true, effectsSettled: true },
    });
    expect(worker.acceptable).toBe(true);
    expect(worker.reasons.lifecycle).toContain("says nothing about whether the model had finished");

    const goal = await verifyFinally();
    expect(goal.acceptable).toBe(true);
    expect(goal.task).toBe("accepted");
    // The lifecycle the run reports is the cut, not a completion, and the goal verdict says so.
    expect(goal.reasons.lifecycle).toBe(worker.reasons.lifecycle);
    expect(await rederived()).toEqual([
      expect.stringMatching(
        /PASS {2}run assessment \d+ re-derived: recorded true, evidence implies true/,
      ),
      expect.stringMatching(/PASS {2}run assessment \d+ re-derived: final pinned goal verdict/),
    ]);
  });

  it("is refused where the final verification fails", async () => {
    expect((await assess(await recordRun())).acceptable).toBe(true);
    const goal = await verifyFinally({ verified: false, task: "rejected" });
    expect(goal.acceptable).toBe(false);
    expect(goal.task).toBe("rejected");
    await expectRederived();
  });

  it("is refused where a required check of the final cycle failed", async () => {
    const worker = await assess(await recordRun({ acceptance: "failed" }));
    expect(worker.acceptable).toBe(false);
    expect(worker.reasons.assessment).toContain("required checks unmet: task-acceptance");
    await expectRederived();
  });

  it("is refused where a write was still unsettled, or settled at or after the cutoff", async () => {
    const unsettled = await assess(await recordRun({ effects: [start + 60_000, null] }));
    expect(unsettled.acceptable).toBe(false);
    expect(unsettled.reasons.assessment).toBe(
      "the run stopped as max-wall-time with a write or shell call unsettled at the model-work cutoff",
    );
    await expectRederived();
  });

  it("is refused where a write settled only once the cutoff had passed", async () => {
    const late = await assess(
      await recordRun({ effects: [modelWorkEnds + 500], stoppedAt: modelWorkEnds + 600 }),
    );
    expect(workerInputs()).toMatchObject({
      wallStop: { beforeDeadline: true, effectsSettled: false },
    });
    expect(late.acceptable).toBe(false);
    await expectRederived();
  });
});

describe("the end of the run's own allowance and cancellation still refuse", () => {
  it("refuses a loop whose wall stop came at the run's deadline", async () => {
    const worker = await assess(await recordRun({ stoppedAt: deadline }));
    expect(worker.acceptable).toBe(false);
    expect(worker.reasons.assessment).toBe(
      "the run stopped as max-wall-time at the run's deadline",
    );
    await expectRederived();
  });

  it("refuses a run whose allowance ended before its checks finished, and the verification that could not finish", async () => {
    // The total allowance aborts the checks' signal, which the assessment records as cancelled.
    const worker = await assess(await recordRun(), true);
    expect(worker.acceptable).toBe(false);
    expect(worker.reasons.assessment).toBe("the run was cancelled");
    const goal = await verifyFinally({
      refusal: "the run's total allowance ended before final verification finished",
      verified: false,
      task: "unjudged",
    });
    expect(goal.acceptable).toBe(false);
    expect(goal.reasons.task).toBe(
      "final verification refused: the run's total allowance ended before final verification finished",
    );
    await expectRederived();
  });

  it("refuses a cancelled run, whose loop stopped as interrupted", async () => {
    const worker = await assess(await recordRun({ stopReason: "interrupted" }), true);
    expect(worker.acceptable).toBe(false);
    expect(worker.reasons.assessment).toBe("the run stopped as interrupted; the run was cancelled");
    await expectRederived();
  });

  it("refuses a wall stop in a run that recorded no reserve, as every earlier policy did", async () => {
    const worker = await assess(await recordRun({ reserve: false }));
    expect(workerInputs()).toMatchObject({ policy: "run-acceptance-v5", wallStop: null });
    expect(worker.acceptable).toBe(false);
    expect(worker.reasons.assessment).toBe("the run stopped as max-wall-time");
    await expectRederived();
  });
});

describe("the checked tree and the delivered tree", () => {
  it("refuses to assess a final verification of a patch other than the one delivered", async () => {
    expect((await assess(await recordRun())).acceptable).toBe(true);
    await expect(verifyFinally({ sourcePatchDigest: "sha256:another" })).rejects.toThrow(
      "final independent verification does not describe the worker's assessed source",
    );
  });

  it("does not re-derive an acceptance recorded over a verification of another patch", async () => {
    const gates = await recordRun();
    const worker = await assess(gates);
    at(verifiedAt);
    const verification = await record("independent-verification", {
      certificationPolicy: "goal-obligations-v1",
      verified: true,
      task: "accepted",
      regression: "pass",
      advice: "",
      sourcePatchDigest: "sha256:another",
      sourceBase: "base",
    });
    const previous = evidence.records().findLast((entry) => entry.type === "run-assessment");
    const diff = evidence.records().findLast((entry) => entry.type === "workspace-diff");
    // What the harness refuses to write, written by hand: the verifier must not accept it.
    await record("run-assessment", {
      inputs: {
        policy: "run-acceptance-v3",
        previousAssessment: previous?.payloadDigest ?? "",
        independentRecord: verification,
        sourceRecord: diff?.payloadDigest ?? "",
      },
      verdict: { ...worker, task: "accepted" } as unknown as JsonValue,
    });
    const checks = await rederived();
    expect(checks[0]).toContain("PASS");
    expect(checks[1]).toContain("FAIL");
  });
});

describe("equivalent artifact evidence under different stops of the model", () => {
  const verdictFor = async (stopReason: AgentLoopOutcome["stopReason"]) => {
    const worker = await assess(await recordRun({ stopReason }));
    const goal = await verifyFinally();
    await expectRederived();
    const { reasons, ...rest } = goal;
    const { lifecycle: _lifecycle, ...otherReasons } = reasons;
    return { worker: worker.acceptable, goal: { ...rest, reasons: otherReasons } };
  };

  it("reads a finished loop, one stopped at its step limit and one cut at its model work alike", async () => {
    const completed = await verdictFor("completed");
    await rm(root, { recursive: true, force: true });
    evidence = await openEvidenceSession({ root, sessionId: "steps", clock });
    const steps = await verdictFor("max-steps");
    evidence = await openEvidenceSession({ root, sessionId: "wall", clock });
    const wall = await verdictFor("max-wall-time");
    expect(completed.goal.acceptable).toBe(true);
    expect(steps).toEqual(completed);
    expect(wall).toEqual(completed);
  });

  it("still refuses the same evidence where the loop was interrupted or spent its tokens", async () => {
    for (const stopReason of ["interrupted", "max-tokens"] as const) {
      evidence = await openEvidenceSession({ root, sessionId: stopReason, clock });
      const worker = await assess(await recordRun({ stopReason }));
      expect(worker.acceptable).toBe(false);
      expect(worker.reasons.assessment).toBe(`the run stopped as ${stopReason}`);
    }
  });
});

describe("records written under earlier policies", () => {
  it("keep their meaning: a v4 wall stop re-derives as refused, and a v4 record claiming acceptance does not", async () => {
    const gates = await recordRun();
    const runs = gates.outcome.finalCycle.runs.map((run) => run.record);
    const lifecycleRecord =
      evidence.records().findLast((entry) => entry.type === "session-stopped")?.payloadDigest ?? "";
    const v4 = (acceptable: boolean) => ({
      inputs: {
        policy: "run-acceptance-v4",
        requiredChecks: ["task-acceptance"],
        contractRecord:
          evidence.records().find((entry) => entry.type === "task-contract")?.payloadDigest ?? "",
        lifecycle: "max-wall-time",
        cancelled: false,
        settled: "green",
        baseRatchetAccepted: true,
        vacuousBlockingBonds: [],
        changedFiles: 2,
        gateRecords: runs,
        baseRatchetRecord: gates.outcome.baseComparison.ratchetRecord,
        lifecycleRecord,
        justifications: [],
      },
      verdict: { version: 1, acceptable },
    });
    await record("run-assessment", v4(false) as unknown as Record<string, JsonValue>);
    expect((await rederived())[0]).toContain("PASS");

    await rm(root, { recursive: true, force: true });
    evidence = await openEvidenceSession({ root, sessionId: "v4-claimed", clock });
    const again = await recordRun();
    const claimed = v4(true);
    claimed.inputs.gateRecords = again.outcome.finalCycle.runs.map((run) => run.record);
    claimed.inputs.baseRatchetRecord = again.outcome.baseComparison.ratchetRecord;
    claimed.inputs.contractRecord =
      evidence.records().find((entry) => entry.type === "task-contract")?.payloadDigest ?? "";
    claimed.inputs.lifecycleRecord =
      evidence.records().findLast((entry) => entry.type === "session-stopped")?.payloadDigest ?? "";
    await record("run-assessment", claimed as unknown as Record<string, JsonValue>);
    expect((await rederived())[0]).toContain("FAIL");
  });

  it("does not re-derive a v5 record whose wall stop says more than the chain does", async () => {
    await assess(await recordRun({ effects: [start + 60_000, null] }));
    const recorded = evidence
      .payloads()
      .get(
        evidence.records().findLast((entry) => entry.type === "run-assessment")?.payloadDigest ??
          "",
      ) as { inputs: Record<string, unknown>; verdict: Record<string, unknown> };
    await rm(root, { recursive: true, force: true });
    evidence = await openEvidenceSession({ root, sessionId: "forged", clock });
    const gates = await recordRun({ effects: [start + 60_000, null] });
    await record("run-assessment", {
      inputs: {
        ...recorded.inputs,
        gateRecords: gates.outcome.finalCycle.runs.map((run) => run.record),
        baseRatchetRecord: gates.outcome.baseComparison.ratchetRecord,
        wallStop: {
          ...(recorded.inputs.wallStop as Record<string, unknown>),
          effectsSettled: true,
        },
      },
      verdict: { ...recorded.verdict, acceptable: true },
    } as unknown as Record<string, JsonValue>);
    expect((await rederived())[0]).toContain("FAIL");
  });
});
