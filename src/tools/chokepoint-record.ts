import type { ProvenanceTag } from "../core/model-client.ts";
import type { ToolKind } from "./tool-definition.ts";

export type ChokepointDecision = "allowed" | "denied" | "failed";

export interface ChokepointRecord {
  readonly callId: string;
  readonly toolName: string;
  readonly kind: ToolKind | "unknown";
  readonly provenance: ProvenanceTag;
  readonly decision: ChokepointDecision;
  readonly detail: string;
}

/**
 * The seam the append-only ledger takes over in the evidence phase. Until then records
 * go to stderr, so a denial is already observable, just not yet tamper-evident.
 */
export interface ChokepointRecorder {
  record(entry: ChokepointRecord): void;
}

export function formatChokepointRecord(entry: ChokepointRecord): string {
  return [
    `[chokepoint] ${entry.decision}`,
    `tool=${entry.toolName}`,
    `kind=${entry.kind}`,
    `call=${entry.callId}`,
    `provenance=${entry.provenance}`,
    entry.detail,
  ].join(" ");
}

export function createStderrRecorder(write: (line: string) => void): ChokepointRecorder {
  return {
    record(entry: ChokepointRecord): void {
      write(formatChokepointRecord(entry));
    },
  };
}
