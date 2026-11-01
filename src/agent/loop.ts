import type { EvidenceRecorder } from "../evidence/session.ts";
import type { Chokepoint } from "../tools/chokepoint.ts";
import { runCommandStep } from "./command-step.ts";
import { type CommandFact, compacted } from "./context.ts";
import { type Message, type ModelClient, ModelError, type Reply } from "./model.ts";
import { readReply, systemPrompt, turnHeader } from "./prompt.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import { runRequirementsStep } from "./requirements-step.ts";

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
  /** The model's context window, which compaction keeps the prompt within. */
  readonly contextTokens: number;
  /** Where full command outputs are written, or null to keep only what a turn carries. */
  readonly outputs: { readonly directory: string; readonly root: string } | null;
  /** What a model taking over from another reads first, or null for a fresh start. */
  readonly handoff?: string | null;
  readonly signal?: AbortSignal | undefined;
  readonly log: (line: string) => void;
}

/** The smallest reply worth asking for: one command and its fence. */
const minimumReplyTokens = 256;
/** Turns in a row with the same command and output before the loop calls it no progress. */
const repeatLimit = 3;
/** Replies in a row that follow no reply form before the model is called unusable here. */
const unusableAfter = 4;

export type StopReason =
  | "complete"
  | "incomplete"
  | "blocked"
  | "no-progress"
  | "step-budget"
  | "token-budget"
  | "time-budget"
  | "model-error"
  | "unusable-replies";

/** What the model turns cost, input and output apart, and which counts were estimated. */
export interface Usage {
  readonly turns: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Turns where the runtime reported no count and the loop estimated it from the text. */
  readonly estimatedTurns: number;
  /** Inference time the runtime reported; turns that reported none are not in it. */
  readonly inferenceMs: number;
  /** Turns whose inference time the runtime reported. */
  readonly inferenceTurns: number;
  /** Requests the client sent again after a transient failure. */
  readonly retries: number;
}

export interface LoopResult {
  readonly stop: StopReason;
  /** Why a run stopped where the reason alone does not say. */
  readonly reason: string | null;
  readonly record: RequirementRecord;
  /** The last verification, or null where none ran. Finalization decides whether it is stale. */
  readonly verification: Verification | null;
  readonly steps: number;
  readonly usage: Usage;
  readonly verifications: number;
}

/** A text's size in tokens, estimated at four characters each where the runtime gives no count. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

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
  let note = options.handoff ?? "Begin.";
  let steps = 0;
  let usage: Usage = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedTurns: 0,
    inferenceMs: 0,
    inferenceTurns: 0,
    retries: 0,
  };
  let verifications = 0;
  let verification: Verification | null = null;
  let previous = { command: "", output: "", repeats: 0 };
  let malformed = 0;
  const facts: CommandFact[] = [];
  const result = (stop: StopReason, reason: string | null = null): LoopResult => ({
    stop,
    reason,
    record,
    verification,
    steps,
    usage,
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
    const spent = usage.inputTokens + usage.outputTokens;
    if (!options.timeLeft())
      return result("time-budget", "the time left is reserved for final verification");
    options.signal?.throwIfAborted();
    const header = turnHeader(options.task, await options.status(), findings);
    messages.push({ role: "user", content: `${header}\n${note}` });
    // Old exploration is compacted only when the prompt measurably presses on the context.
    const measured = estimateTokens(messages.map((message) => message.content).join(""));
    const shorter = compacted(messages, facts, measured, options.contextTokens);
    if (shorter !== null) {
      messages.splice(0, messages.length, ...shorter);
      options.log(
        `compacted earlier turns (${measured} of ${options.contextTokens} context tokens)`,
      );
    }
    // No turn starts that the allowance cannot pay for: its prompt, and a useful reply.
    const prompt = estimateTokens(messages.map((message) => message.content).join(""));
    const room = options.maxTokens - spent - prompt;
    if (room < Math.min(options.turnTokens, minimumReplyTokens)) {
      return result(
        "token-budget",
        `the next turn needs about ${prompt} prompt tokens and ${options.maxTokens - spent} remain`,
      );
    }

    let reply: Reply;
    try {
      reply = await options.model.complete(messages, {
        signal: options.signal,
        maxTokens: Math.min(options.turnTokens, room),
      });
    } catch (error) {
      if (!(error instanceof ModelError)) throw error;
      usage = { ...usage, retries: usage.retries + error.retries };
      await options.evidence.record({
        type: "model-error",
        actor: "harness",
        provenance: ["tool-output"],
        payload: { step: steps + 1, error: error.message },
      });
      return result("model-error", error.message);
    }
    steps += 1;
    const input = reply.inputTokens ?? prompt;
    const output = reply.outputTokens ?? estimateTokens(reply.content);
    const estimated = reply.inputTokens === null || reply.outputTokens === null;
    usage = {
      turns: usage.turns + 1,
      inputTokens: usage.inputTokens + input,
      outputTokens: usage.outputTokens + output,
      estimatedTurns: usage.estimatedTurns + (estimated ? 1 : 0),
      inferenceMs: usage.inferenceMs + (reply.inferenceMs ?? 0),
      inferenceTurns: usage.inferenceTurns + (reply.inferenceMs === null ? 0 : 1),
      retries: usage.retries + reply.retries,
    };
    const read = readReply(reply.content, reply.reasoning);
    messages.push({ role: "assistant", content: read.text });
    await options.evidence.record({
      type: "model-call",
      actor: options.model.model,
      provenance: ["model"],
      payload: {
        step: steps,
        reply: reply.content,
        ...(reply.reasoning === undefined ? {} : { reasoning: reply.reasoning }),
        ...(read.fromReasoning ? { replyFromReasoning: true } : {}),
        inputTokens: input,
        outputTokens: output,
        estimated,
        inferenceMs: reply.inferenceMs,
        retries: reply.retries,
      },
    });

    const parsed = read.parsed;
    malformed = parsed.kind === "malformed" ? malformed + 1 : 0;
    if (parsed.kind === "malformed") {
      if (malformed >= unusableAfter) {
        return result(
          "unusable-replies",
          `${malformed} replies in a row followed no reply form: ${parsed.reason}`,
        );
      }
      const cut = reply.truncated ? ` (it was cut off at ${options.turnTokens} tokens)` : "";
      note = `Your reply was not used: ${parsed.reason}${cut}. Reply with exactly one bash block, one requirements block, or the completion marker alone.`;
      continue;
    }
    if (parsed.kind === "command") {
      options.log(`$ ${parsed.command.split("\n")[0]}`);
      const ran = await runCommandStep({
        chokepoint: options.chokepoint,
        command: parsed.command,
        step: steps,
        outputs: options.outputs,
        previous,
      });
      previous = { command: parsed.command, output: ran.output, repeats: ran.repeats };
      facts.push(ran.fact);
      if (ran.repeats >= repeatLimit) {
        return result(
          "no-progress",
          `the same command printed the same output ${ran.repeats} turns running`,
        );
      }
      note = ran.note;
      continue;
    }
    if (parsed.kind === "requirements") {
      const proposed = await runRequirementsStep({
        task: options.task,
        record,
        json: parsed.json,
        evidence: options.evidence,
        actor: options.model.model,
      });
      record = proposed.record;
      note = proposed.note;
      options.log(`requirements ${proposed.ids}`);
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
