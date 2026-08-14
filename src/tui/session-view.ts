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

interface AttemptCounter {
  readonly current: number;
  readonly cap: number;
}

export interface SessionView {
  readonly plan: string;
  /** Newest last. The screen shows a bounded tail of this. */
  readonly actions: readonly string[];
  readonly status: string;
  readonly finished: boolean;
  /** Latest result per gate, in the order the gates first ran. */
  readonly gates: readonly GateLine[];
  readonly attempt: AttemptCounter | null;
  readonly escalated: boolean;
}

export const emptySessionView: SessionView = {
  plan: "",
  actions: [],
  status: "starting",
  finished: false,
  gates: [],
  attempt: null,
  escalated: false,
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
      return { ...view, status: `thinking (step ${event.step})` };
    case "model-error":
      return {
        ...view,
        status: event.willRetry ? "retrying after a model error" : "model error",
        actions: [...view.actions, `model error: ${event.message}`],
      };
    case "tool-call":
      return {
        ...view,
        status: `running ${event.toolName}`,
        actions: [...view.actions, `${event.toolName} ${summarizeInput(event.input)}`],
      };
    case "tool-outcome":
      return {
        ...view,
        actions: [
          ...view.actions,
          `${event.toolName} ${event.failed ? "failed" : "ok"}: ${firstLine(event.output)}`,
        ],
      };
    case "claim":
      return { ...view, status: "claim recorded, unverified" };
    case "stopped":
      return {
        ...view,
        status: `stopped: ${event.reason} (${event.steps} steps, ${event.tokensUsed} tokens)`,
        finished: true,
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
        actions: [...view.actions, `ratchet: ${event.detail}`],
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
