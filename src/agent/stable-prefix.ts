import { createHash } from "node:crypto";
import { type Instructions, loadInstructions, renderInstructions } from "./instructions.ts";
import { platformSha256, renderPlatform } from "./platform-facts.ts";
import { probePlatform } from "./platform-probe.ts";
import { systemPrompt } from "./prompt.ts";

export interface StablePrefix {
  /** The platform block the model reads, its digest, and the probe output it was read from. */
  readonly environment: {
    readonly block: string;
    readonly sha256: string;
    readonly probe: string;
  };
  readonly instructions: Instructions;
  /** The instructions as the model reads them. */
  readonly rendered: string;
  readonly digests: { path: string; sha256: string }[];
  /** The digest of everything at the front of the prompt: system prompt, platform, instructions, task. */
  readonly promptSha256: string;
}

/**
 * What every turn's prompt starts with, gathered once at session start. The platform block is
 * covered by the prompt digest, which the attestation's producer carries, and is recorded whole,
 * with its own digest and the probe's output, in the session-started ledger record.
 */
export async function stablePrefix(input: {
  readonly workspace: string;
  readonly env: Record<string, string>;
  readonly task: string;
  readonly checks: "isolated" | "host";
  readonly signal?: AbortSignal | undefined;
}): Promise<StablePrefix> {
  const probe = await probePlatform(input);
  const block = renderPlatform({ probe, root: input.workspace, checks: input.checks });
  const instructions = await loadInstructions(input.workspace);
  const rendered = renderInstructions(instructions);
  return {
    environment: { block, sha256: platformSha256(block), probe: probe.output },
    instructions,
    rendered,
    digests: instructions.loaded.map(({ path, sha256 }) => ({ path, sha256 })),
    promptSha256: createHash("sha256")
      .update(`${systemPrompt}\n${block}\n${rendered}\n${input.task}`)
      .digest("hex"),
  };
}
