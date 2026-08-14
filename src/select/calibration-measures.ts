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
  readonly outputTokens: number;
  readonly responseTimeMs: number;
  /** Mean over the calls that observed one, null when none did. */
  readonly firstTokenMs: number | null;
  /** Output tokens over the whole repeat's response time, null when no time was measured. */
  readonly tokensPerSecond: number | null;
}

export function tallyModelCalls(entries: readonly RecordedPayload[]): ModelCallTally {
  let calls = 0;
  let outputTokens = 0;
  let responseTimeMs = 0;
  const firstTokens: number[] = [];

  for (const entry of entries) {
    if (entry.type !== "model-call") {
      continue;
    }
    calls += 1;
    outputTokens += numberAt(entry.payload, "outputTokens") ?? 0;

    const performance = valueAt(entry.payload, "performance");
    responseTimeMs += numberAt(performance, "responseTimeMs") ?? 0;
    const firstToken = numberAt(performance, "firstTokenMs");
    if (firstToken !== null) {
      firstTokens.push(firstToken);
    }
  }

  return {
    calls,
    outputTokens,
    responseTimeMs,
    firstTokenMs:
      firstTokens.length === 0
        ? null
        : firstTokens.reduce((sum, value) => sum + value, 0) / firstTokens.length,
    tokensPerSecond: responseTimeMs === 0 ? null : outputTokens / (responseTimeMs / 1000),
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
