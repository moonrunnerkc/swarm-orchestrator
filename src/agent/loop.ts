import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import type { Message, ModelClient } from "./model.ts";
import { parseReply, systemPrompt, truncate, turnHeader } from "./prompt.ts";

export interface Verification {
  readonly verdict: "pass" | "fail" | "unmeasured";
  /** What the verifier printed about a refusal, handed back to the model verbatim. */
  readonly feedback: string;
}

export interface LoopOptions {
  readonly task: string;
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  /** `git status --short` of the working tree, read fresh every turn. */
  readonly status: () => Promise<string>;
  readonly verify: () => Promise<Verification>;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export type StopReason = "verified" | "unmeasured" | "step-budget" | "token-budget";

export interface LoopResult {
  readonly stop: StopReason;
  readonly steps: number;
  readonly tokens: number;
  /** Turns whose token count was estimated because the endpoint reported none. */
  readonly estimatedTurns: number;
  readonly verifications: number;
}

/**
 * One model turn, one command, until the model says it is done and the verifier agrees, or a
 * budget runs out. Nothing watches the work in between: the verifier measures the final tree,
 * and a refusal goes back to the model with the budgets as they stood.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const messages: Message[] = [{ role: "system", content: systemPrompt }];
  let failure: string | null = null;
  let note = "Begin.";
  let steps = 0;
  let tokens = 0;
  let estimatedTurns = 0;
  let verifications = 0;
  const result = (stop: StopReason): LoopResult => ({
    stop,
    steps,
    tokens,
    estimatedTurns,
    verifications,
  });

  while (true) {
    if (steps >= options.maxSteps) return result("step-budget");
    if (tokens >= options.maxTokens) return result("token-budget");
    options.signal?.throwIfAborted();
    const header = turnHeader(options.task, await options.status(), failure);
    messages.push({ role: "user", content: `${header}\n${note}` });

    const reply = await options.model.complete(messages, options.signal);
    steps += 1;
    const used =
      reply.tokens ??
      Math.ceil(messages.reduce((sum, message) => sum + message.content.length, 0) / 4);
    if (reply.tokens === null) estimatedTurns += 1;
    tokens += used;
    messages.push({ role: "assistant", content: reply.content });
    await options.evidence.record({
      type: "model-call",
      actor: options.model.model,
      provenance: ["model"],
      payload: {
        step: steps,
        reply: reply.content,
        tokens: used,
        estimated: reply.tokens === null,
      },
    });

    const parsed = parseReply(reply.content);
    if (parsed.kind === "malformed") {
      note = `Your reply was not used: ${parsed.reason}. Reply with exactly one bash block, or the completion marker alone.`;
      continue;
    }
    if (parsed.kind === "command") {
      options.log(`$ ${parsed.command.split("\n")[0]}`);
      const outcome = await options.chokepoint.run(parsed.command);
      note = `${outcome.decision === "allowed" ? `exit code: ${outcome.exitCode}` : outcome.decision}\n${truncate(outcome.output)}`;
      continue;
    }

    verifications += 1;
    options.log("verifying the working tree");
    const verification = await options.verify();
    await options.evidence.record({
      type: "verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { verdict: verification.verdict, feedback: verification.feedback },
    });
    if (verification.verdict === "pass") return result("verified");
    if (verification.verdict === "unmeasured") return result("unmeasured");
    failure = verification.feedback;
    note =
      "The verifier refused the change. Fix what it reports, then mark the task complete again.";
  }
}
