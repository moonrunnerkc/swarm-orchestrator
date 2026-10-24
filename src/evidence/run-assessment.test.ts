import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClock } from "../core/test-doubles.ts";
import type { JsonValue } from "./canonical-json.ts";
import { runLifecycle } from "./run-assessment.ts";
import { type EvidenceRecorder, openEvidenceSession } from "./session.ts";
import { runVerdict } from "./verdict.ts";
import { rederiveTaskViolations } from "./verifier/verify.mjs";

let root = "";
let evidence: EvidenceRecorder;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "swarm-run-assessment-"));
  evidence = await openEvidenceSession({
    root,
    sessionId: "lifecycle-session",
    clock: createTestClock(1_700_000_000_000),
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const stopped = (payload: Record<string, JsonValue>) =>
  evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

const owed = (rule: string, payload: Record<string, JsonValue>) =>
  evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { rule, ...payload },
  });

/**
 * The lifecycle the assessment names and the bundled verifier re-derives: the last stop of a
 * loop that worked the task. These cases pin the rule, the fields that carry it, and the
 * reading of records written before those fields existed.
 */
describe("the run's lifecycle, read off the chain", () => {
  it("is the first loop's stop where no repair followed", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    expect(runLifecycle(evidence)).toBe("max-steps");
  });

  it("stays the interrupted loop's when a narrow repair finished, and becomes the repair's when the repair stopped at a limit", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true, attempt: 1, runLifecycle: false });
    expect(runLifecycle(evidence)).toBe("max-steps");
    await stopped({ stopReason: "max-tokens", repair: true, attempt: 2 });
    expect(runLifecycle(evidence)).toBe("max-tokens");
  });

  it("reads a repair's finish as the lifecycle where the record predates the field, as it always did", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("is an owed attempt's stop only where its candidate was kept, matched by attempt", async () => {
    await stopped({ stopReason: "max-steps", steps: 40 });
    await stopped({ stopReason: "completed", repair: true, attempt: 1, runLifecycle: false });
    await stopped({
      stopReason: "completed",
      repair: true,
      attempt: 2,
      followUp: true,
      continuation: true,
    });
    await owed("task-continuation-v1", { state: "given", attempt: 2, accepted: false });
    expect(runLifecycle(evidence)).toBe("max-steps");
    await stopped({ stopReason: "completed", repair: true, attempt: 3, followUp: true });
    await owed("outcome-follow-up-v1", { state: "given", attempt: 3, accepted: true });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("reads a follow-up stop without an attempt by the last follow-up record, as it always did", async () => {
    await stopped({ stopReason: "completed", steps: 3 });
    await stopped({ stopReason: "max-wall-time", repair: true, followUp: true });
    await owed("outcome-follow-up-v1", { state: "given", attempt: 1, accepted: false });
    expect(runLifecycle(evidence)).toBe("completed");
  });

  it("skips a withheld attempt, whose stop reason is not a lifecycle, and reads nothing before any loop stopped", async () => {
    expect(runLifecycle(evidence)).toBeNull();
    await stopped({ stopReason: "completed", steps: 3 });
    await stopped({ stopReason: "repair-withheld", repair: true, attempt: 1 });
    expect(runLifecycle(evidence)).toBe("completed");
  });
});

/**
 * known-violation-completion-v1, as the bundled verifier re-derives it from what ran: the delivered
 * reading, each held case read again from its two candidate runs, and a relation's expectation
 * checked against the reference's run on the base.
 */
describe("the delivered candidate's open task violations, re-derived from the runs", () => {
  const relation = {
    id: "code-relation-1",
    basis: "relation",
    origin: "task",
    program: "export default (input) => input;",
    reference: "export default (input) => input;",
    cases: [{ input: "/a?x=1" }, { input: "file:///C:/x?x=1" }],
  };
  const run = async (checkId: string, results: readonly string[]) =>
    (
      await evidence.record({
        type: "goal-check",
        actor: "harness",
        provenance: ["tool-output"],
        payload: {
          checkId,
          phase: "completed",
          observation: {
            exitCode: 0,
            outputTruncated: false,
            unavailable: null,
            stdout: results.map((result) => `${JSON.stringify({ result })}\n`).join(""),
          },
        },
      })
    ).record.payloadDigest;
  const caseOf = (index: number, reading: string, candidate: string) => ({
    probe: "code-relation-1",
    index,
    reading,
    authority: "code-relation-1",
    role: "requested",
    input: relation.cases[index - 1]?.input ?? null,
    base: index === 1 ? '"/a?x=1"' : '"file://C:/x?x=1"',
    candidate,
    expected: index === 1 ? '"/a?x=1"' : '"file://C:/x?x=1"',
    detail: "",
  });
  /** A declaration, an examination of a candidate that keeps `file:///` as given, and its runs. */
  async function examined(): Promise<{ policy: string; examination: string }> {
    const policy = (
      await owed("known-violation-completion-v1", { phase: "declared" } as Record<
        string,
        JsonValue
      >)
    ).record.payloadDigest;
    const baseRuns = [
      await run("code-relation-1-ref-run-1", ["/a?x=1", "file://C:/x?x=1"]),
      await run("code-relation-1-ref-run-2", ["/a?x=1", "file://C:/x?x=1"]),
    ];
    const candidateRuns = [
      await run("code-relation-1-run-1", ["/a?x=1", "file:///C:/x?x=1"]),
      await run("code-relation-1-run-2", ["/a?x=1", "file:///C:/x?x=1"]),
    ];
    const examination = (
      await owed("candidate-review-v4", {
        phase: "examined",
        probes: [relation],
        classified: [
          caseOf(1, "related", '"/a?x=1"'),
          caseOf(2, "relation-violated", '"file:///C:/x?x=1"'),
        ],
        baseRuns,
        candidateRuns,
      } as unknown as Record<string, JsonValue>)
    ).record.payloadDigest;
    return { policy, examination };
  }
  const open = ['code-relation-1#2 "file:///C:/x?x=1"'];

  it("agrees with an honest account of the violation, and refuses one that leaves it out", async () => {
    const { policy, examination } = await examined();
    const claimed = { policyRecord: policy, readingRecord: examination, open };
    expect(rederiveTaskViolations(claimed, evidence.records(), evidence.payloads())).toEqual({
      consistent: true,
      open,
    });
    expect(
      rederiveTaskViolations({ ...claimed, open: [] }, evidence.records(), evidence.payloads())
        .consistent,
    ).toBe(false);
  });

  it("takes a repaired candidate's reading only where the ratchet kept it", async () => {
    const { policy, examination } = await examined();
    const repairedRuns = [
      await run("code-relation-1-run-1", ["/a?x=1", "file://C:/x?x=1"]),
      await run("code-relation-1-run-2", ["/a?x=1", "file://C:/x?x=1"]),
    ];
    const remeasured = (
      await owed("candidate-review-v4", {
        phase: "remeasured",
        classified: [caseOf(1, "related", '"/a?x=1"'), caseOf(2, "related", '"file://C:/x?x=1"')],
        baseRuns: [],
        candidateRuns: repairedRuns,
      } as unknown as Record<string, JsonValue>)
    ).record.payloadDigest;
    await evidence.record({
      type: "ratchet-decision",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { scope: "retry", attempt: 1, accepted: false },
    });
    // Rolled back: the delivered candidate is still the examined one, with its violation.
    expect(
      rederiveTaskViolations(
        { policyRecord: policy, readingRecord: examination, open },
        evidence.records(),
        evidence.payloads(),
      ).consistent,
    ).toBe(true);
    expect(
      rederiveTaskViolations(
        { policyRecord: policy, readingRecord: remeasured, open: [] },
        evidence.records(),
        evidence.payloads(),
      ).consistent,
    ).toBe(false);
  });

  it("refuses a reading whose recorded classification the runs do not bear out", async () => {
    const policy = (
      await owed("known-violation-completion-v1", { phase: "declared" } as Record<
        string,
        JsonValue
      >)
    ).record.payloadDigest;
    const baseRuns = [await run("code-relation-1-ref-run-1", ["/a?x=1", "file://C:/x?x=1"])];
    const candidateRuns = [
      await run("code-relation-1-run-1", ["/a?x=1", "file:///C:/x?x=1"]),
      await run("code-relation-1-run-2", ["/a?x=1", "file:///C:/x?x=1"]),
    ];
    // The record calls the second case related although the candidate's runs answer otherwise.
    const examination = (
      await owed("candidate-review-v4", {
        phase: "examined",
        probes: [relation],
        classified: [caseOf(1, "related", '"/a?x=1"'), caseOf(2, "related", '"file://C:/x?x=1"')],
        baseRuns,
        candidateRuns,
      } as unknown as Record<string, JsonValue>)
    ).record.payloadDigest;
    expect(
      rederiveTaskViolations(
        { policyRecord: policy, readingRecord: examination, open: [] },
        evidence.records(),
        evidence.payloads(),
      ).consistent,
    ).toBe(false);
  });

  it("refuses the run in the verdict, naming the open case", () => {
    const verdict = runVerdict({
      cycle: {
        runs: [],
        blockingFailures: [],
        advisoryFailures: [],
        statuses: {},
        measures: { changedFiles: 1 },
      } as never,
      integrity: "unverified",
      signer: "untrusted",
      executionTrust: "restricted",
      assessment: {
        lifecycle: "completed",
        cancelled: false,
        settled: "green",
        baseRatchetAccepted: true,
        vacuousBlockingBonds: [],
        changedFiles: 0,
        taskViolations: { open },
      },
    });
    expect(verdict.acceptable).toBe(false);
    expect(verdict.reasons.assessment).toContain(
      'unresolved task violation(s) on the delivered candidate: code-relation-1#2 "file:///C:/x?x=1"',
    );
  });
});
