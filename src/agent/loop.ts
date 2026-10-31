import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { type Message, type ModelClient, ModelError, type Reply } from "./model.ts";
import { parseReply, systemPrompt, truncate, turnHeader } from "./prompt.ts";
import { applyProposal, type RequirementRecord, recordSha256 } from "./requirement-record.ts";

/** One verification of the working tree, as the loop reads it. */
export interface Verification {
  readonly state: "complete" | "incomplete" | "blocked";
  /** The digest of the exact patch the verifier measured. */
  readonly patchSha256: string;
  /** The digest of the requirement record it judged. */
  readonly recordSha256: string;
  /** What the verifier found, for the model to act on: requirement statuses, reasons, output. */
  readonly feedback: string;
}

export interface LoopOptions {
  readonly task: string;
  readonly model: ModelClient;
  readonly chokepoint: Chokepoint;
  readonly evidence: EvidenceRecorder;
  /** Repository instructions as the model reads them, or "" where there are none. */
  readonly instructions: string;
  readonly record: RequirementRecord;
  /** `git status --short` of the working tree, read fresh every turn. */
  readonly status: () => Promise<string>;
  readonly verify: (record: RequirementRecord) => Promise<Verification>;
  readonly maxSteps: number;
  readonly maxTokens: number;
  /** The completion cap of one turn; a turn never asks for more than the run has left. */
  readonly turnTokens: number;
  /** Whether time remains for another model turn with final verification still reserved. */
  readonly timeLeft: () => boolean;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

export type StopReason =
  | "complete"
  | "incomplete"
  | "blocked"
  | "no-progress"
  | "step-budget"
  | "token-budget"
  | "time-budget"
  | "model-error";

export interface LoopResult {
  readonly stop: StopReason;
  /** Why a run stopped where the reason alone does not say. */
  readonly reason: string | null;
  readonly record: RequirementRecord;
  /** The last verification, or null where none ran. Finalization decides whether it is stale. */
  readonly verification: Verification | null;
  readonly steps: number;
  readonly tokens: number;
  /** Turns whose token count was estimated because the endpoint reported none. */
  readonly estimatedTurns: number;
  readonly verifications: number;
}

/**
 * One model turn at a time: a command, a requirement record, or completion. Completion asks the
 * verifier, whose findings go back to the model until the record is complete, the run is
 * blocked, a completion repeats on an unchanged tree and record, or a budget ends it. Whatever
 * stops the loop, finalization judges the tree it leaves.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const preamble = [systemPrompt, options.instructions].filter((part) => part.length > 0);
  const messages: Message[] = [{ role: "system", content: preamble.join("\n\n") }];
  let record = options.record;
  let findings: string | null = null;
  let note = "Begin.";
  let steps = 0;
  let tokens = 0;
  let estimatedTurns = 0;
  let verifications = 0;
  let verification: Verification | null = null;
  let previous = { command: "", output: "" };
  const result = (stop: StopReason, reason: string | null = null): LoopResult => ({
    stop,
    reason,
    record,
    verification,
    steps,
    tokens,
    estimatedTurns,
    verifications,
  });
  /** The verification, and whether it measured the same tree and record as the one before. */
  const judge = async (): Promise<{
    readonly judged: Verification;
    readonly repeated: boolean;
  }> => {
    verifications += 1;
    options.log("verifying the working tree");
    const judged = await options.verify(record);
    const repeated =
      verification !== null &&
      verification.patchSha256 === judged.patchSha256 &&
      verification.recordSha256 === judged.recordSha256;
    verification = judged;
    await options.evidence.record({
      type: "verification",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        state: judged.state,
        patchSha256: judged.patchSha256,
        recordSha256: judged.recordSha256,
      },
    });
    return { judged, repeated };
  };

  while (true) {
    if (steps >= options.maxSteps) return result("step-budget");
    if (tokens >= options.maxTokens) return result("token-budget");
    if (!options.timeLeft())
      return result("time-budget", "the time left is reserved for final verification");
    options.signal?.throwIfAborted();
    const header = turnHeader(options.task, await options.status(), findings);
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
      return result("model-error", error.message);
    }
    steps += 1;
    const used =
      reply.tokens ??
      Math.ceil(
        (messages.reduce((sum, message) => sum + message.content.length, 0) +
          reply.content.length) /
          4,
      );
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
      note = `Your reply was not used: ${parsed.reason}${cut}. Reply with exactly one bash block, one requirements block, or the completion marker alone.`;
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
    if (parsed.kind === "requirements") {
      record = applyProposal(options.task, record, parsed.json);
      await options.evidence.record({
        type: "requirements",
        actor: options.model.model,
        provenance: ["model"],
        // Through JSON, so the ledger stores the record as plain data.
        payload: JSON.parse(
          JSON.stringify({
            recordSha256: recordSha256(record),
            requirements: record.requirements,
            notes: record.notes,
          }),
        ),
      });
      const ids = record.requirements.map((one) => one.id).join(", ");
      options.log(`requirements ${ids}`);
      note = [`Recorded ${ids}.`, ...record.notes].join("\n");
      if (!parsed.complete) continue;
    }

    const { judged, repeated } = await judge();
    if (judged.state === "complete") return result("complete");
    if (judged.state === "blocked")
      return result("blocked", judged.feedback.split("\n")[0] ?? null);
    // Completing again on the same tree and record would only repeat the same findings.
    if (repeated) {
      return result(
        "no-progress",
        "the task was marked complete again with no change since the last verification",
      );
    }
    findings = judged.feedback;
    note =
      "The verifier did not find the task complete. Act on its findings, then mark the task complete again.";
  }
}
