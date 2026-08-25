import { describe, expect, it } from "vitest";
import { digestOfJson, type JsonValue } from "../evidence/canonical-json.ts";
import type { LedgerRecord, RecordType } from "../evidence/ledger-record.ts";
import { peersFor, projectTrail, renderTrail, type TrailPeer } from "./trail.ts";

interface Entry {
  readonly type: RecordType;
  readonly payload: JsonValue;
}

/**
 * A peer chain as the trail reads one: records paired with payloads. Digests are real so
 * the pairing is the same one a live recorder hands over.
 */
function peer(workerId: string, entries: readonly Entry[], taskId = workerId): TrailPeer {
  const payloads = new Map<string, JsonValue>();
  const records: LedgerRecord[] = entries.map((entry, index) => {
    const payloadDigest = digestOfJson(entry.payload);
    payloads.set(payloadDigest, entry.payload);
    return {
      schemaVersion: 1,
      sequence: index,
      previousHash: index === 0 ? "genesis" : `sha256:${"0".repeat(64)}`,
      timestamp: index,
      type: entry.type,
      actor: "harness",
      payloadDigest,
      provenance: ["model"],
    };
  });
  return {
    workerId,
    taskId,
    chain: {
      sessionId: `run-${workerId}`,
      records: () => records,
      payloads: () => payloads,
    },
  };
}

describe("the trail projection", () => {
  it("names the files a peer declared", () => {
    const trail = projectTrail([
      peer("worker-2", [
        { type: "file-set-declared", payload: { files: ["src/alpha.ts"], fileCount: 1 } },
      ]),
    ]);

    expect(trail.signals).toEqual([
      { kind: "file-claimed", workerId: "worker-2", path: "src/alpha.ts" },
    ]);
  });

  it("names a peer's failed gate with the detail the harness parser wrote", () => {
    const trail = projectTrail([
      peer("worker-2", [
        {
          type: "gate-run",
          payload: {
            gateId: "tests",
            status: "failed",
            exitCode: 1,
            detail: "1 of 4 tests failing",
            stdout: "a wall of runner output",
            stderr: "",
          },
        },
      ]),
    ]);

    expect(trail.signals).toEqual([
      {
        kind: "gate-failed",
        workerId: "worker-2",
        gateId: "tests",
        exitCode: 1,
        detail: "1 of 4 tests failing",
        repeats: 1,
      },
    ]);
  });

  it("never carries a peer's raw gate output", () => {
    const trail = projectTrail([
      peer("worker-2", [
        {
          type: "gate-run",
          payload: {
            gateId: "tests",
            status: "failed",
            exitCode: 1,
            detail: "1 of 4 tests failing",
            stdout: "a wall of runner output",
            stderr: "a wall of runner errors",
          },
        },
      ]),
    ]);

    expect(JSON.stringify(trail)).not.toContain("wall of runner");
  });

  it("counts a gate that failed the same way twice as one signal that repeated", () => {
    const failure = {
      gateId: "tests",
      status: "failed",
      exitCode: 1,
      detail: "1 of 4 tests failing",
    };
    const trail = projectTrail([
      peer("worker-2", [
        { type: "gate-run", payload: { ...failure, attempt: 0 } },
        { type: "gate-run", payload: { ...failure, attempt: 1 } },
      ]),
    ]);

    expect(trail.signals).toHaveLength(1);
    expect(trail.signals[0]).toMatchObject({ kind: "gate-failed", repeats: 2 });
  });

  it("ignores a gate that passed", () => {
    const trail = projectTrail([
      peer("worker-2", [
        {
          type: "gate-run",
          payload: { gateId: "lint", status: "passed", exitCode: 0, detail: "" },
        },
      ]),
    ]);

    expect(trail.signals).toEqual([]);
  });

  it("names the ratchet violations a peer's attempt was rejected for", () => {
    const trail = projectTrail([
      peer("worker-3", [
        {
          type: "ratchet-decision",
          payload: {
            scope: "retry",
            attempt: 1,
            accepted: false,
            violations: [{ kind: "assertions-decreased", before: 9, after: 4, detail: "" }],
          },
        },
      ]),
    ]);

    expect(trail.signals).toEqual([
      {
        kind: "ratchet-rejected",
        workerId: "worker-3",
        attempt: 1,
        violations: ["assertions-decreased"],
      },
    ]);
  });

  it("ignores a ratchet decision that was accepted", () => {
    const trail = projectTrail([
      peer("worker-3", [
        {
          type: "ratchet-decision",
          payload: { scope: "retry", attempt: 1, accepted: true, violations: [] },
        },
      ]),
    ]);

    expect(trail.signals).toEqual([]);
  });

  it("says which approach a peer spent its attempts on", () => {
    const trail = projectTrail([
      peer("worker-4", [
        {
          type: "escalation",
          payload: { gateId: "tests", attemptsUsed: 3, cap: 3, attemptsRejectedByRatchet: 2 },
        },
      ]),
    ]);

    expect(trail.signals).toEqual([
      {
        kind: "spent",
        workerId: "worker-4",
        gateId: "tests",
        attemptsUsed: 3,
        cap: 3,
        attemptsRejectedByRatchet: 2,
      },
    ]);
  });

  it("reads an empty trail off no peers rather than failing", () => {
    expect(projectTrail([])).toEqual({ signals: [], sourceCount: 0 });
  });

  it("names the files an amendment added to a peer's set", () => {
    const trail = projectTrail([
      peer("worker-2", [
        { type: "file-set-declared", payload: { files: ["src/alpha.ts"], fileCount: 1 } },
        {
          type: "file-set-amended",
          payload: {
            files: ["src/alpha.ts", "src/beta.ts"],
            added: ["src/beta.ts"],
            reason: "the shout needed a helper",
            amendment: true,
          },
        },
      ]),
    ]);

    expect(trail.signals.map((signal) => signal.kind === "file-claimed" && signal.path)).toEqual([
      "src/alpha.ts",
      "src/beta.ts",
    ]);
  });
});

describe("the trail rendering", () => {
  const everySignalShape = projectTrail([
    peer("worker-2", [
      { type: "file-set-declared", payload: { files: ["src/alpha.ts"], fileCount: 1 } },
      {
        type: "gate-run",
        payload: {
          gateId: "tests",
          status: "failed",
          exitCode: 1,
          detail: "1 of 4 tests failing",
        },
      },
      {
        type: "ratchet-decision",
        payload: {
          scope: "retry",
          attempt: 1,
          accepted: false,
          violations: [{ kind: "assertions-decreased", before: 9, after: 4, detail: "" }],
        },
      },
      {
        type: "escalation",
        payload: { gateId: "tests", attemptsUsed: 3, cap: 3, attemptsRejectedByRatchet: 2 },
      },
    ]),
  ]);

  it("renders no positive verdict, because no signal reports one", () => {
    expect(renderTrail(everySignalShape)).not.toMatch(/verified|green|\bpassed\b/i);
  });

  it("names the peer in every line, so no line reads as a statement about the reader", () => {
    const lines = renderTrail(everySignalShape).split("\n").filter(Boolean);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain("worker-2");
    }
  });

  it("says a peer has left nothing rather than rendering an empty string", () => {
    expect(renderTrail(projectTrail([]))).toContain("no peer");
  });

  it("carries the repeat count only where a failure repeated", () => {
    const once = renderTrail(everySignalShape);
    const twice = renderTrail(
      projectTrail([
        peer("worker-2", [
          {
            type: "gate-run",
            payload: { gateId: "tests", status: "failed", exitCode: 1, detail: "x" },
          },
          {
            type: "gate-run",
            payload: { gateId: "tests", status: "failed", exitCode: 1, detail: "x" },
          },
        ]),
      ]),
    );

    expect(once).not.toContain("times");
    expect(twice).toContain("2 times");
  });

  it("reads every record against its own chain's payloads, never a shared index", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    const chainCarrying = (payload: JsonValue) => ({
      sessionId: "run",
      records: () => [
        {
          schemaVersion: 1 as const,
          sequence: 0,
          previousHash: "genesis",
          timestamp: 0,
          type: "file-set-declared" as const,
          actor: "harness",
          payloadDigest: digest,
          provenance: ["model" as const],
        },
      ],
      payloads: () => new Map([[digest, payload]]),
    });

    const trail = projectTrail([
      { workerId: "worker-2", taskId: "task-1", chain: chainCarrying({ files: ["src/alpha.ts"] }) },
      { workerId: "worker-3", taskId: "task-2", chain: chainCarrying({ files: ["src/beta.ts"] }) },
    ]);

    expect(trail.signals).toEqual([
      { kind: "file-claimed", workerId: "worker-2", path: "src/alpha.ts" },
      { kind: "file-claimed", workerId: "worker-3", path: "src/beta.ts" },
    ]);
  });
});

describe("choosing which peers a worker reads", () => {
  const alpha = peer("worker-1", [], "task-1");
  const beta = peer("worker-2", [], "task-2");
  const gamma = peer("worker-3", [], "task-3");

  it("hands a worker every peer but itself", () => {
    expect(peersFor("worker-2", "task-2", [alpha, beta, gamma])).toEqual([alpha, gamma]);
  });

  it("hands the only worker in a run nothing", () => {
    expect(peersFor("worker-1", "task-1", [alpha])).toEqual([]);
  });

  it("hides the other attempts at a worker's own task, so they stay separate samples", () => {
    const first = peer("worker-1", [], "task-1");
    const second = peer("worker-2", [], "task-1");
    const elsewhere = peer("worker-3", [], "task-2");

    expect(peersFor("worker-1", "task-1", [first, second, elsewhere])).toEqual([elsewhere]);
  });
});
