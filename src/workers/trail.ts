import type { JsonValue } from "../evidence/canonical-json.ts";
import type { LedgerRecord } from "../evidence/ledger-record.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * What a worker leaves behind for its peers, read off the chain it was already writing.
 * Nothing here is a verdict: a signal says what happened on another chain, and the reader
 * decides what to do about it. Gate results and claims stay the harness's alone.
 */
export type TrailSignal =
  | { readonly kind: "file-claimed"; readonly workerId: string; readonly path: string }
  | {
      readonly kind: "gate-failed";
      readonly workerId: string;
      readonly gateId: string;
      readonly exitCode: number;
      readonly detail: string;
      readonly repeats: number;
    }
  | {
      readonly kind: "ratchet-rejected";
      readonly workerId: string;
      readonly attempt: number;
      readonly violations: readonly string[];
    }
  | {
      readonly kind: "spent";
      readonly workerId: string;
      readonly gateId: string;
      readonly attemptsUsed: number;
      readonly cap: number;
      readonly attemptsRejectedByRatchet: number;
    };

/** A peer's chain, read-only. A live recorder satisfies this without adapting. */
export interface TrailPeer {
  readonly workerId: string;
  readonly chain: Pick<EvidenceRecorder, "sessionId" | "records" | "payloads">;
}

export interface Trail {
  readonly signals: readonly TrailSignal[];
  readonly sourceCount: number;
}

/**
 * A gate-run payload carries the whole of stdout and stderr. None of it travels: a peer's
 * raw runner output is the workspace's own text and is bulk in another model's context.
 * What travels is the line the harness's own parser wrote about it.
 */
const detailCap = 300;

export function projectTrail(peers: readonly TrailPeer[]): Trail {
  const signals: TrailSignal[] = [];
  for (const peer of peers) {
    const payloads = peer.chain.payloads();
    for (const record of peer.chain.records()) {
      signals.push(...signalsFrom(peer.workerId, record, payloads.get(record.payloadDigest)));
    }
  }
  return { signals: fold(signals), sourceCount: peers.length };
}

/**
 * A worker reads the others and not itself: its own chain is what it just did, and feeding
 * it back would be the run telling itself what it already knows.
 */
export function peersFor(readerId: string, all: readonly TrailPeer[]): readonly TrailPeer[] {
  return all.filter((candidate) => candidate.workerId !== readerId);
}

/**
 * One line per signal, every line naming the peer it is about. That attribution is the
 * guarantee: the template asserts nothing, and no signal kind reports a success, so the
 * rendering has no positive verdict to give. A gate detail is quoted peer text and can
 * carry any word its own parser wrote, which is why it travels named rather than bare.
 */
export function renderTrail(trail: Trail): string {
  if (trail.signals.length === 0) {
    return "no peer has left a trail yet.";
  }
  return trail.signals.map(renderSignal).join("\n");
}

function renderSignal(signal: TrailSignal): string {
  switch (signal.kind) {
    case "file-claimed":
      return `${signal.workerId} declared ${signal.path}`;
    case "gate-failed": {
      const repeats = signal.repeats > 1 ? `, ${signal.repeats} times` : "";
      return `${signal.workerId} gate ${signal.gateId} exit ${signal.exitCode}${repeats}: ${signal.detail}`;
    }
    case "ratchet-rejected":
      return `${signal.workerId} attempt ${signal.attempt} rejected by the ratchet: ${signal.violations.join(", ")}`;
    case "spent":
      return `${signal.workerId} spent ${signal.attemptsUsed} of ${signal.cap} attempts on gate ${signal.gateId}, ${signal.attemptsRejectedByRatchet} rejected by the ratchet`;
  }
}

function signalsFrom(
  workerId: string,
  record: LedgerRecord,
  payload: JsonValue | undefined,
): readonly TrailSignal[] {
  const fields = objectOrNull(payload);
  if (fields === null) {
    return [];
  }
  switch (record.type) {
    case "file-set-declared":
    case "file-set-amended":
      return stringsAt(fields, "files").map((path) => ({
        kind: "file-claimed" as const,
        workerId,
        path,
      }));
    case "gate-run":
      return stringAt(fields, "status") === "failed"
        ? [
            {
              kind: "gate-failed",
              workerId,
              gateId: stringAt(fields, "gateId") ?? "",
              exitCode: numberAt(fields, "exitCode") ?? 0,
              detail: (stringAt(fields, "detail") ?? "").slice(0, detailCap),
              repeats: 1,
            },
          ]
        : [];
    case "ratchet-decision":
      return fields.accepted === false
        ? [
            {
              kind: "ratchet-rejected",
              workerId,
              attempt: numberAt(fields, "attempt") ?? 0,
              violations: violationKinds(fields.violations),
            },
          ]
        : [];
    case "escalation":
      return [
        {
          kind: "spent",
          workerId,
          gateId: stringAt(fields, "gateId") ?? "",
          attemptsUsed: numberAt(fields, "attemptsUsed") ?? 0,
          cap: numberAt(fields, "cap") ?? 0,
          attemptsRejectedByRatchet: numberAt(fields, "attemptsRejectedByRatchet") ?? 0,
        },
      ];
    default:
      return [];
  }
}

/**
 * Two kinds of repetition, told apart because a peer acts on them differently. An
 * amendment restates every file the set already allowed, so claiming a path twice is one
 * claim written down twice and the second is dropped. A gate that failed the same way on
 * three attempts is one thing worth knowing that happened three times, and the count is
 * the part worth reading, so it is carried rather than dropped.
 */
function fold(signals: readonly TrailSignal[]): readonly TrailSignal[] {
  const folded: TrailSignal[] = [];
  const seenAt = new Map<string, number>();
  for (const signal of signals) {
    const key = keyOf(signal);
    const at = seenAt.get(key);
    if (at === undefined) {
      seenAt.set(key, folded.length);
      folded.push(signal);
      continue;
    }
    const previous = folded[at];
    if (previous?.kind === "gate-failed" && signal.kind === "gate-failed") {
      folded[at] = { ...previous, repeats: previous.repeats + 1 };
    }
  }
  return folded;
}

function keyOf(signal: TrailSignal): string {
  switch (signal.kind) {
    case "file-claimed":
      return ["file-claimed", signal.workerId, signal.path].join(" ");
    case "gate-failed":
      return ["gate-failed", signal.workerId, signal.gateId, signal.exitCode, signal.detail].join(
        " ",
      );
    case "ratchet-rejected":
      return ["ratchet-rejected", signal.workerId, signal.attempt].join(" ");
    case "spent":
      return ["spent", signal.workerId, signal.gateId, signal.attemptsUsed].join(" ");
  }
}

type JsonFields = { readonly [key: string]: JsonValue };

function objectOrNull(payload: JsonValue | undefined): JsonFields | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  return payload as JsonFields;
}

function stringAt(fields: JsonFields, field: string): string | null {
  const value = fields[field];
  return typeof value === "string" ? value : null;
}

function numberAt(fields: JsonFields, field: string): number | null {
  const value = fields[field];
  return typeof value === "number" ? value : null;
}

function stringsAt(fields: JsonFields, field: string): readonly string[] {
  const value = fields[field];
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function violationKinds(value: JsonValue | undefined): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const kinds: string[] = [];
  for (const entry of value) {
    const fields = objectOrNull(entry);
    const kind = fields === null ? null : stringAt(fields, "kind");
    if (kind !== null) {
      kinds.push(kind);
    }
  }
  return kinds;
}
