import type { LoopEvent } from "../core/loop-events.ts";

/**
 * The non-TTY rendering: one line per event, no cursor control. Returns null for events
 * that carry no new information on a plain stream.
 */
export function describeLoopEvent(event: LoopEvent): string | null {
  switch (event.type) {
    case "plan":
      return event.text.length === 0 ? null : `plan: ${event.text}`;
    case "model-call":
      return `step ${event.step}: calling ${event.modelId}`;
    case "model-error":
      return `model error${event.willRetry ? " (retrying)" : ""}: ${event.message}`;
    case "tool-call":
      return `tool ${event.toolName} <- ${JSON.stringify(event.input)}`;
    case "tool-outcome":
      return `tool ${event.toolName} ${event.failed ? "failed" : "ok"}: ${event.output}`;
    case "claim":
      return `claim (unverified): ${event.text}`;
    case "stopped":
      return `stopped: ${event.reason} after ${event.steps} steps, ${event.tokensUsed} tokens`;
    case "gate":
      return (
        `gate ${event.gateId} ${event.status}${event.blocking ? "" : " (advisory)"}: ` +
        `${event.detail} [evidence record ${event.record}]`
      );
    case "attempt":
      return `auto-resolve attempt ${event.attempt} of ${event.cap}`;
    case "ratchet":
      return `ratchet ${event.accepted ? "accepted" : "rejected"} attempt ${event.attempt}: ${event.detail} [evidence record ${event.record}]`;
    case "escalated":
      return `escalated after ${event.attempts} attempt(s) at gate ${event.gateId}: ${event.detail}`;
  }
}
