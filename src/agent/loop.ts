import { runCommandStep } from "./command-step.ts";
import { diffSections, estimateTokens, movedFiles, unresolvedOf } from "./context.ts";
import { createConversation } from "./conversation.ts";
import { commandExchange, noteExchange } from "./exchange.ts";
import type { LoopOptions, LoopResult, StopReason, Usage, Verification } from "./loop-types.ts";
import { ModelError, type Reply } from "./model.ts";
import { readReply, stepsLeftNotice, systemPrompt, timeLeftNotice } from "./prompt.ts";
import { runRequirementsStep } from "./requirements-step.ts";
import { noUsage, withTurn } from "./usage.ts";
import { runVerificationStep } from "./verification-step.ts";

export type { LoopOptions, LoopResult, StopReason, Usage, Verification } from "./loop-types.ts";

/** The smallest reply worth asking for: one command and its fence. */
const minimumReplyTokens = 256;
/** Turns in a row with the same command and output before the loop calls it no progress. */
const repeatLimit = 3;
/** Replies in a row that follow no reply form before the model is called unusable here. */
const unusableAfter = 4;

const openFindings = (findings: string | null) =>
  (findings ?? "").split("\n").filter((line) => /^R\d+ /.test(line));

/**
 * One model turn at a time: a command, a requirement record, or completion. Completion asks the
 * verifier, whose findings go back to the model until the record is complete, the run is
 * blocked, a completion repeats on an unchanged tree and record, or a budget ends it. Whatever
 * stops the loop, finalization judges the tree it leaves.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const conversation = createConversation({
    system: [systemPrompt, options.instructions].filter((part) => part.length > 0).join("\n\n"),
    task: options.task,
    opening: options.handoff ?? "Begin.",
  });
  let record = options.record;
  let findings: string | null = null;
  // The ledger record of the verification the findings come from.
  let checked: string | null = null;
  let steps = 0;
  let usage: Usage = noUsage;
  // The last reported input count over the estimate of the prompt it counted.
  let calibration = 1;
  let sections = new Map<string, string>();
  let verifications = 0;
  let nudged = false;
  let noticed = false;
  let turnStarted: number | null = null;
  let longestTurnMs = 0;
  let verification: Verification | null = null;
  let previous = { command: "", output: "", repeats: 0 };
  let malformed = 0;
  const result = (stop: StopReason, reason: string | null = null): LoopResult => ({
    stop,
    reason,
    record,
    verification,
    steps,
    usage,
    verifications,
  });

  while (true) {
    if (steps >= options.maxSteps) return result("step-budget");
    const spent = usage.inputTokens + usage.outputTokens;
    const time = options.turnTime();
    // No turn starts that the time left cannot pay for either: the longest turn so far is the
    // measure, so a slow model's last turn does not eat the time final verification needs.
    if (turnStarted !== null) longestTurnMs = Math.max(longestTurnMs, Date.now() - turnStarted);
    turnStarted = Date.now();
    if (time.leftMs <= 0)
      return result("time-budget", "the time left is reserved for final verification");
    if (time.leftMs < longestTurnMs) {
      return result(
        "time-budget",
        `the next turn may take ${Math.ceil(longestTurnMs / 1000)} s, as the longest has, and ${Math.floor(time.leftMs / 1000)} s remain before the time reserved for final verification`,
      );
    }
    options.signal?.throwIfAborted();
    // Said once, for whichever budget runs short first.
    const notice = noticed
      ? null
      : (stepsLeftNotice(options.maxSteps - steps, options.maxSteps) ??
        timeLeftNotice(time.leftMs, time.wallMs));
    if (notice !== null) noticed = true;
    const diff = await options.diff();
    const now = diffSections(diff);
    conversation.edited(movedFiles(sections, now));
    sections = now;
    const state = { status: await options.status(), diff, findings, notice };
    // Old exploration is compacted only when the prompt measurably presses on the context.
    const relieved = conversation.relieve({
      record,
      state,
      calibration,
      contextTokens: options.contextTokens,
      unresolved: unresolvedOf(record, findings),
      verification: checked,
    });
    if (relieved !== null) {
      options.log(
        `compacted earlier turns (${relieved.before} of ${options.contextTokens} context tokens, ${relieved.after} after)`,
      );
    }
    const messages = conversation.messages(record, state);
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
    usage = withTurn(usage, reply, prompt);
    if (reply.inputTokens !== null && prompt > 0) calibration = reply.inputTokens / prompt;
    const read = readReply(reply.content, reply.reasoning);
    await options.evidence.record({
      type: "model-call",
      actor: options.model.model,
      provenance: ["model"],
      payload: {
        step: steps,
        reply: reply.content,
        ...(reply.reasoning === undefined ? {} : { reasoning: reply.reasoning }),
        ...(read.fromReasoning ? { replyFromReasoning: true } : {}),
        inputTokens: reply.inputTokens ?? prompt,
        outputTokens: reply.outputTokens ?? estimateTokens(reply.content),
        estimated: reply.inputTokens === null || reply.outputTokens === null,
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
      conversation.add(
        noteExchange({
          step: steps,
          reply: read.text,
          brief: "(a reply that followed no reply form)",
          result: `Your reply was not used: ${parsed.reason}${cut}. Reply with exactly one bash block, one requirements block, or the completion marker alone.`,
          fact: `a reply that was not used: ${parsed.reason}`,
        }),
      );
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
      if (ran.repeats >= repeatLimit) {
        return result(
          "no-progress",
          `the same command printed the same output ${ran.repeats} turns running`,
        );
      }
      // A command repeated while findings are open is the run circling: point back at them.
      const open = openFindings(findings);
      const note =
        ran.repeats >= 2 && open.length > 0
          ? [
              ran.note,
              "The verifier's findings are still open:",
              ...open,
              "Act on them: change the tree, or send the corrected requirements block, then mark the task complete.",
            ].join("\n")
          : ran.note;
      conversation.add(
        commandExchange({ reply: read.text, result: note, fact: ran.fact, output: ran.output }),
      );
      continue;
    }
    let proposal = "";
    if (parsed.kind === "requirements") {
      const proposed = await runRequirementsStep({
        task: options.task,
        record,
        json: parsed.json,
        evidence: options.evidence,
        actor: options.model.model,
      });
      record = proposed.record;
      options.log(`requirements ${proposed.ids}`);
      proposal = `a requirements block, recorded as ${proposed.ids} [evidence ${proposed.evidence}]`;
      if (!parsed.complete) {
        conversation.add(
          noteExchange({
            step: steps,
            reply: read.text,
            brief: `(${proposal}; the record as it stands is at the top)`,
            result: proposed.note,
            fact: proposal,
          }),
        );
        continue;
      }
    }

    options.log("verifying the working tree");
    const { judged, repeated, evidence } = await runVerificationStep({
      verify: options.verify,
      record,
      last: verification,
      evidence: options.evidence,
    });
    verification = judged;
    if (judged.reused !== true) verifications += 1;
    if (judged.state === "complete") return result("complete");
    if (judged.state === "blocked") return result("blocked", judged.reasons?.[0] ?? null);
    // Completing again on the same tree and record only repeats the same findings: say so once,
    // with the findings, then stop.
    if (repeated && nudged) {
      return result(
        "no-progress",
        "the task was marked complete again with no change since the last verification",
      );
    }
    const marked = `${proposal.length > 0 ? `${proposal}, then ` : ""}the task marked complete; the verifier found it ${judged.state} [evidence ${evidence}]`;
    const answer = (note: string) =>
      conversation.add(
        noteExchange({
          step: steps,
          reply: read.text,
          brief: `(${marked})`,
          result: note,
          fact: marked,
        }),
      );
    if (repeated) {
      nudged = true;
      answer(
        [
          "Marking the task complete again changes nothing: the tree and the requirements are the ones just verified, so the findings are the same:",
          ...openFindings(judged.feedback),
          "Change the tree, or send a requirements block that maps the evidence the findings name, before marking it complete.",
        ].join("\n"),
      );
      continue;
    }
    findings = judged.feedback;
    checked = evidence;
    answer(
      "The verifier did not find the task complete. Act on its findings, then mark the task complete again.",
    );
  }
}
