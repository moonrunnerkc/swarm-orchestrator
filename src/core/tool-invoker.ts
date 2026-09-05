import type { ModelToolCall, ProvenanceTag, ToolCallOutcome } from "./model-client.ts";

export interface ToolInvocation extends ModelToolCall {
  readonly provenance: ProvenanceTag;
}

/**
 * The chokepoint port. The loop knows one way to run a tool, so guard enforcement
 * and (from the evidence phase on) ledger recording cannot be bypassed (invariant 3).
 */
export interface ToolInvoker {
  invoke(invocation: ToolInvocation): Promise<ToolCallOutcome>;
}
