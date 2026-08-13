import type { LoopEvent } from "../core/loop-events.ts";

export interface SessionView {
  readonly plan: string;
  /** Newest last. The screen shows a bounded tail of this. */
  readonly actions: readonly string[];
  readonly status: string;
  readonly finished: boolean;
}

export const emptySessionView: SessionView = {
  plan: "",
  actions: [],
  status: "starting",
  finished: false,
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
  }
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
