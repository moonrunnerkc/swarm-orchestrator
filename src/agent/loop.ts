import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Message, type ModelClient, ModelError, type Reply } from "./model.ts";
import { parseReply, systemPrompt, truncate, turnHeader } from "./prompt.ts";

export interface Verification {
  readonly verdict: "pass" | "fail" | "unmeasured";
  /** What the verifier printed about a refusal, handed back to the model verbatim. */
  readonly feedback: string;
  /** `path:line` of a changed line whose mutant the checks did not kill, or null. */
  readonly survivedMutant: string | null;
  /** A failure, or a check that fails at base and still fails: something the model can fix. */
  readonly actionable: boolean;
  /** The verdict's reasons, which stay the same while nothing the checks report changes. */
  readonly reasons: string;
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
  /** The completion cap of one turn; a turn never asks for more than the run has left. */
  readonly turnTokens: number;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export type StopReason = "verified" | "unmeasured" | "step-budget" | "token-budget" | "model-error";

export interface LoopResult {
  readonly stop: StopReason;
  /** Why a run stopped that the budgets or the verifier did not stop. */
  readonly reason: string | null;
  /** The last verdict on the working tree, or null where the verifier never ran. */
  readonly verification: Verification | null;
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
  let verification: Verification | null = null;
  let lastReasons: string | null = null;
  let previous = { command: "", output: "" };
  const result = (stop: StopReason, reason: string | null = null): LoopResult => ({
    stop,
    reason,
    verification,
    steps,
    tokens,
    estimatedTurns,
    verifications,
  });

  const judge = async (): Promise<Verification> => {
    verifications += 1;
    options.log("verifying the working tree");
    verification = await options.verify();
    await options.evidence.record({
      type: "verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: { verdict: verification.verdict, feedback: verification.feedback },
    });
    return verification;
  };

  while (true) {
    if (steps >= options.maxSteps) return result("step-budget");
    if (tokens >= options.maxTokens) return result("token-budget");
    options.signal?.throwIfAborted();
    const header = turnHeader(options.task, await options.status(), failure);
    messages.push({ role: "user", content: `${header}\n${note}` });

    let reply: Reply;
    try {
      reply = await options.model.complete(messages, {
        signal: options.signal,
        maxTokens: Math.min(options.turnTokens, options.maxTokens - tokens),
      });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      await options.evidence.record({
        type: "model-error",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { step: steps + 1, error: error.message },
      });
      // The run ends here, but whatever tree it left is still judged and reported.
      await judge();
      return result("model-error", error.message);
    }
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
        tokensUsed: used,
        estimated: reply.tokens === null,
      },
    });

    const parsed = parseReply(reply.content);
    if (parsed.kind === "malformed") {
      const cut = reply.truncated ? ` (it was cut off at ${options.turnTokens} tokens)` : "";
      note = `Your reply was not used: ${parsed.reason}${cut}. Reply with exactly one bash block, or the completion marker alone.`;
      continue;
    }
    if (parsed.kind === "command") {
      options.log(`$ ${parsed.command.split("\n")[0]}`);
      const outcome = await options.chokepoint.run(parsed.command);
      // At temperature 0 a repeated command and its unchanged output can repeat forever.
      const repeated = parsed.command === previous.command && outcome.output === previous.output;
      previous = { command: parsed.command, output: outcome.output };
      const again = repeated
        ? "This is the command you ran last turn, and its output is unchanged.\n"
        : "";
      note = `${again}${outcome.decision === "allowed" ? `exit code: ${outcome.exitCode}` : outcome.decision}\n${truncate(outcome.output)}`;
      continue;
    }

    const judged = await judge();
    if (judged.verdict === "pass") return result("verified");
    if (!judged.actionable) return result("unmeasured");
    // Completing again over the same unmeasured reasons says the inherited failure is not its own.
    if (judged.verdict === "unmeasured" && judged.reasons === lastReasons)
      return result("unmeasured");
    lastReasons = judged.verdict === "unmeasured" ? judged.reasons : null;
    failure = judged.feedback;
    note =
      judged.verdict === "fail"
        ? "The verifier refused the change. Fix what it reports, then mark the task complete again."
        : "The verifier could not measure the change: a check fails at the base commit and still fails. Fix it if the task needs that; otherwise mark the task complete again.";
  }
}
