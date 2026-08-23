import type { GateStatus, LoopEvent } from "../core/loop-events.ts";

/**
 * One line of the gate strip. Every field here came off a gate-run ledger record, and the
 * record digest travels with it so what the screen says can be looked up rather than
 * trusted.
 */
export interface GateLine {
  readonly gateId: string;
  readonly status: GateStatus;
  readonly blocking: boolean;
  readonly detail: string;
  readonly record: string;
}

/**
 * One row of the action stream. `summary` is the row; `detail` is the whole of what the
 * harness reported, which is what an expanded row shows. Both come off a loop event, so
 * expanding a row shows more evidence rather than more prose.
 */
export interface ActionRow {
  readonly kind: "tool-call" | "tool-outcome" | "model-error" | "ratchet";
  readonly summary: string;
  readonly detail: string;
  /** The ledger record this row was written from, where the event carried one. */
  readonly record: string | null;
  readonly failed: boolean;
}

interface AttemptCounter {
  readonly current: number;
  readonly cap: number;
}

export interface SessionView {
  readonly plan: string;
  /** Newest last. The screen shows a bounded window of this. */
  readonly actions: readonly ActionRow[];
  readonly status: string;
  readonly finished: boolean;
  /** Latest result per gate, in the order the gates first ran. */
  readonly gates: readonly GateLine[];
  readonly attempt: AttemptCounter | null;
  readonly escalated: boolean;
  /** The model the last call went to, as the harness named it. */
  readonly modelId: string | null;
  readonly steps: number;
  /** Only the stop event carries a token count, so this is zero until the run ends. */
  readonly tokensUsed: number;
  readonly ratchetAccepted: number;
  readonly ratchetRejected: number;
}

export const emptySessionView: SessionView = {
  plan: "",
  actions: [],
  status: "starting",
  finished: false,
  gates: [],
  attempt: null,
  escalated: false,
  modelId: null,
  steps: 0,
  tokensUsed: 0,
  ratchetAccepted: 0,
  ratchetRejected: 0,
};

/**
 * The only projection the screen renders from. Every field here is derived from a loop
 * event the harness emitted, never from model text presented as a result (invariant 1).
 */
export function applyLoopEvent(view: SessionView, event: LoopEvent): SessionView {
  switch (event.type) {
    case "plan":
      return { ...view, plan: event.text, status: "planning" };
    case "model-call":
      return {
        ...view,
        status: `thinking (step ${event.step})`,
        modelId: event.modelId,
        steps: Math.max(view.steps, event.step),
      };
    case "model-error":
      return {
        ...view,
        status: event.willRetry ? "retrying after a model error" : "model error",
        actions: [
          ...view.actions,
          {
            kind: "model-error",
            summary: `model error: ${firstLine(event.message)}`,
            detail: event.message,
            record: null,
            failed: true,
          },
        ],
      };
    case "tool-call":
      return {
        ...view,
        status: `running ${event.toolName}`,
        actions: [
          ...view.actions,
          {
            kind: "tool-call",
            summary: `${event.toolName} ${summarizeInput(event.input)}`,
            detail: describeInput(event.input),
            record: null,
            failed: false,
          },
        ],
      };
    case "tool-outcome":
      return {
        ...view,
        actions: [
          ...view.actions,
          {
            kind: "tool-outcome",
            summary: `${event.toolName} ${event.failed ? "failed" : "ok"}: ${firstLine(event.output)}`,
            detail: event.output,
            record: null,
            failed: event.failed,
          },
        ],
      };
    case "claim":
      return { ...view, status: "claim recorded, unverified" };
    case "stopped":
      return {
        ...view,
        status: `stopped: ${event.reason} (${event.steps} steps, ${event.tokensUsed} tokens)`,
        finished: true,
        steps: event.steps,
        tokensUsed: event.tokensUsed,
      };
    case "gate":
      return {
        ...view,
        status: `gate ${event.gateId}: ${event.status}`,
        gates: replaceGate(view.gates, {
          gateId: event.gateId,
          status: event.status,
          blocking: event.blocking,
          detail: event.detail,
          record: event.record,
        }),
      };
    case "attempt":
      return {
        ...view,
        status: `auto-resolve attempt ${event.attempt} of ${event.cap}`,
        attempt: { current: event.attempt, cap: event.cap },
      };
    case "ratchet":
      return {
        ...view,
        status: `ratchet ${event.accepted ? "accepted" : "rejected"} attempt ${event.attempt}`,
        ratchetAccepted: view.ratchetAccepted + (event.accepted ? 1 : 0),
        ratchetRejected: view.ratchetRejected + (event.accepted ? 0 : 1),
        actions: [
          ...view.actions,
          {
            kind: "ratchet",
            summary: `ratchet ${event.accepted ? "accepted" : "rejected"}: ${firstLine(event.detail)}`,
            detail: event.detail,
            record: event.record,
            failed: !event.accepted,
          },
        ],
      };
    case "escalated":
      return {
        ...view,
        status: `escalated at the ${event.gateId} gate after ${event.attempts} attempt(s)`,
        escalated: true,
        finished: true,
      };
  }
}

function replaceGate(gates: readonly GateLine[], line: GateLine): readonly GateLine[] {
  const index = gates.findIndex((existing) => existing.gateId === line.gateId);
  if (index === -1) {
    return [...gates, line];
  }
  return gates.map((existing, position) => (position === index ? line : existing));
}

function firstLine(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}...` : line;
}

function summarizeInput(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return String(input);
  }
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => `${key}=${firstLine(String(value))}`)
    .join(" ");
  return entries.length > 120 ? `${entries.slice(0, 117)}...` : entries;
}

/** The whole argument object, which is what an expanded row is for. */
function describeInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    return String(input);
  }
}
