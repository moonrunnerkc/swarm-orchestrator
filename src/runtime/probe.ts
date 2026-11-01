import type { ModelClient } from "../agent/model.ts";
import { parseReply, systemPrompt } from "../agent/prompt.ts";

export interface ProbeResult {
  readonly ready: boolean;
  /** What showed it ready, or what it did instead. */
  readonly reason: string;
  readonly latencyMs: number;
  /** Output tokens per second while generating; null where the runtime reports no timing. */
  readonly tokensPerSecond: number | null;
  readonly at: string;
}

const expected = "echo swarm-ready";

/** Repository-shaped text of about `tokens` tokens, so the probe exercises a long prompt. */
function filler(tokens: number): string {
  const block = [
    "export function clamp(value: number, low: number, high: number): number {",
    "  if (Number.isNaN(value)) throw new RangeError('value is not a number');",
    "  return Math.min(high, Math.max(low, value));",
    "}",
    "",
  ].join("\n");
  return block.repeat(Math.max(1, Math.ceil((tokens * 4) / block.length)));
}

/**
 * Whether a model can run the agent here: the endpoint answers, at the configured context it
 * follows the shell protocol (one bash block holding the one command asked for) after a prompt
 * a quarter of that context long, and the output is usable. A listing alone proves none of it.
 */
export async function probeModel(
  client: ModelClient,
  contextTokens: number,
  timeoutMs = 600_000,
): Promise<ProbeResult> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  const prompt = [
    "Here is part of the repository you will work in:",
    "",
    filler(Math.floor(contextTokens / 4)),
    "",
    `Probe: reply with exactly one fenced bash block whose command is: ${expected}`,
  ].join("\n");
  try {
    const reply = await client.complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      { maxTokens: 256, signal: AbortSignal.timeout(timeoutMs) },
    );
    const latencyMs = Date.now() - started;
    const generating = reply.outputMs ?? null;
    const tokensPerSecond =
      reply.outputTokens === null || generating === null || generating === 0
        ? null
        : Math.round((reply.outputTokens / generating) * 10_000) / 10;
    const parsed = parseReply(reply.content);
    const ready = parsed.kind === "command" && parsed.command === expected;
    const reason = ready
      ? `followed the shell protocol after a ${Math.floor(contextTokens / 4)}-token prompt at a ${contextTokens}-token context`
      : `did not follow the shell protocol: replied ${JSON.stringify(reply.content.slice(0, 120))}`;
    return { ready, reason, latencyMs, tokensPerSecond, at };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ready: false,
      reason: `the endpoint failed: ${reason}`,
      latencyMs: Date.now() - started,
      tokensPerSecond: null,
      at,
    };
  }
}
