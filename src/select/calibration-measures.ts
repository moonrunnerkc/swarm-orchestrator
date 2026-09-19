import type { JsonValue } from "../evidence/canonical-json.ts";
import type { RecordType } from "../evidence/ledger-record.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

/**
 * A ledger record paired with the payload it addresses. Calibration scores are computed from
 * these and from nothing else, so every number in the report can be re-derived by a reviewer
 * holding the same bundle.
 */
export interface RecordedPayload {
  readonly type: RecordType;
  readonly payload: JsonValue;
}

/** The records one repeat produced: everything appended after the sequence it started at. */
export function payloadsSince(
  evidence: EvidenceRecorder,
  fromIndex: number,
): readonly RecordedPayload[] {
  const payloads = evidence.payloads();
  return evidence
    .records()
    .slice(fromIndex)
    .map((record) => ({ type: record.type, payload: payloads.get(record.payloadDigest) ?? null }));
}

export interface ToolCallTally {
  readonly attempted: number;
  /** Calls the chokepoint could not act on: an unknown tool, or input the schema rejected. */
  readonly malformed: number;
  readonly writesAttempted: number;
  readonly writesApplied: number;
  /** Null when nothing was attempted: no attempts is not a perfect score. */
  readonly validityRate: number | null;
  readonly applyRate: number | null;
}

const malformedDenials: ReadonlySet<string> = new Set(["unknown-tool", "invalid-input"]);

/**
 * One attempt per call rather than one per record: the chokepoint writes a requested record
 * before anything runs and a settled one after, and counting both would halve every rate.
 */
export function tallyToolCalls(entries: readonly RecordedPayload[]): ToolCallTally {
  let attempted = 0;
  let malformed = 0;
  let writesAttempted = 0;
  let writesApplied = 0;

  for (const entry of entries) {
    if (entry.type !== "tool-call") {
      continue;
    }
    const decision = stringAt(entry.payload, "decision");
    if (decision === null || decision === "requested") {
      continue;
    }
    attempted += 1;
    if (malformedDenials.has(stringAt(entry.payload, "denial") ?? "")) {
      malformed += 1;
    }
    if (stringAt(entry.payload, "kind") === "write") {
      writesAttempted += 1;
      if (decision === "allowed") {
        writesApplied += 1;
      }
    }
  }

  return {
    attempted,
    malformed,
    writesAttempted,
    writesApplied,
    validityRate: attempted === 0 ? null : (attempted - malformed) / attempted,
    applyRate: writesAttempted === 0 ? null : writesApplied / writesAttempted,
  };
}

export interface ModelCallTally {
  readonly calls: number;
  /** Turns the harness recorded as carrying text or a tool call. */
  readonly validTurns: number;
  /** Turns it recorded as carrying neither, by the reason it recorded. */
  readonly emptyTurns: number;
  readonly emptyTurnReasons: Readonly<Record<string, number>>;
  /** Summed over the calls that reported usage. A lower bound where `callsWithUnknownUsage` is not zero. */
  readonly outputTokens: number;
  readonly responseTimeMs: number;
  /** Calls whose provider reported no usage, a failed call included. They add no tokens above. */
  readonly callsWithUnknownUsage: number;
  /** Mean over the calls that observed one, null when none did. */
  readonly firstTokenMs: number | null;
  /**
   * Output tokens over response time, across the calls that reported both, null when none did.
   * A call with unknown usage is left out of both sides: its time with zero tokens against it
   * would read as a slower model, and selection compares this number between models.
   */
  readonly tokensPerSecond: number | null;
}

/**
 * Counted off the `content` verdict the recorder stamped on each turn rather than recomputed
 * here. Two readings of one response are two chances to disagree, and the reading that governs
 * has to be the one that is in the bundle.
 */
export function tallyModelCalls(entries: readonly RecordedPayload[]): ModelCallTally {
  let calls = 0;
  let validTurns = 0;
  let emptyTurns = 0;
  const emptyTurnReasons: Record<string, number> = {};
  let outputTokens = 0;
  let responseTimeMs = 0;
  let callsWithUnknownUsage = 0;
  let ratedTokens = 0;
  let ratedTimeMs = 0;
  const firstTokens: number[] = [];

  for (const entry of entries) {
    if (entry.type !== "model-call") {
      continue;
    }
    calls += 1;
    const content = valueAt(entry.payload, "content");
    if (booleanAt(content, "valid") === true) {
      validTurns += 1;
    } else {
      emptyTurns += 1;
      // A record written before this field existed says nothing about its turn, and saying so
      // is the honest reading: it is not a claim that the turn was fine.
      const reason = stringAt(content, "reason") ?? "unrecorded";
      emptyTurnReasons[reason] = (emptyTurnReasons[reason] ?? 0) + 1;
    }
    const reportedTokens =
      stringAt(entry.payload, "usageStatus") === "unknown"
        ? null
        : numberAt(entry.payload, "outputTokens");
    if (reportedTokens === null) callsWithUnknownUsage += 1;
    outputTokens += reportedTokens ?? 0;

    const performance = valueAt(entry.payload, "performance");
    const callTimeMs = numberAt(performance, "responseTimeMs");
    responseTimeMs += callTimeMs ?? 0;
    if (reportedTokens !== null && callTimeMs !== null) {
      ratedTokens += reportedTokens;
      ratedTimeMs += callTimeMs;
    }
    const firstToken = numberAt(performance, "firstTokenMs");
    if (firstToken !== null) {
      firstTokens.push(firstToken);
    }
  }

  return {
    calls,
    validTurns,
    emptyTurns,
    emptyTurnReasons,
    outputTokens,
    responseTimeMs,
    firstTokenMs:
      firstTokens.length === 0
        ? null
        : firstTokens.reduce((sum, value) => sum + value, 0) / firstTokens.length,
    callsWithUnknownUsage,
    tokensPerSecond: ratedTimeMs === 0 ? null : ratedTokens / (ratedTimeMs / 1000),
  };
}

function valueAt(payload: JsonValue, key: string): JsonValue {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  return (payload as { readonly [field: string]: JsonValue })[key] ?? null;
}

function stringAt(payload: JsonValue, key: string): string | null {
  const value = valueAt(payload, key);
  return typeof value === "string" ? value : null;
}

function numberAt(payload: JsonValue, key: string): number | null {
  const value = valueAt(payload, key);
  return typeof value === "number" ? value : null;
}

function booleanAt(payload: JsonValue, key: string): boolean | null {
  const value = valueAt(payload, key);
  return typeof value === "boolean" ? value : null;
}
