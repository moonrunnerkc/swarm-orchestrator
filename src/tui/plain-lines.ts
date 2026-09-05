import type { LoopEvent } from "../core/loop-events.ts";

/**
 * The non-TTY rendering: one line per event, no cursor control. Returns null for events
 * that carry no new information on a plain stream.
 */
export function describeLoopEvent(event: LoopEvent): string | null {
  switch (event.type) {
    case "plan":
      return event.text.length === 0 ? null : `plan: ${event.text}`;
    // Said out loud before the first tool call. A reader should never have to infer from the
    // absence of a warning that there was no boundary in front of the commands about to run.
    case "execution-envelope":
      return event.lines.join("\n");
    // Said once per compaction, not per call: a long run should report that its memory was
    // shortened without saying so forty times.
    case "compacted":
      return (
        `context compacted: ${event.droppedMessages} message(s) and about ` +
        `${event.droppedTokens} tokens are no longer resent. The ledger still has all of it.`
      );
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
    // Nothing on this stream, which the committed fixture holds to byte for byte. The plain
    // path already says it, in the sentence the gate report prints above its table.
    case "changes":
      return null;
    // Neither reaches the plain stream, which the committed fixture holds byte for byte. Both
    // exist so a terminal can show that something is happening; a pipe reads the whole
    // response and the tool outcome regardless, which is what it was already reading.
    case "model-text":
    case "tool-started":
      return null;
  }
}
