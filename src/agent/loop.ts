import { runCommandStep } from "./command-step.ts";
import { diffSections, estimateTokens, movedFiles, unresolvedOf } from "./context.ts";
import { createConversation } from "./conversation.ts";
import { commandExchange, noteExchange } from "./exchange.ts";
import { circlingNote } from "./findings.ts";
import { checksNote, failureLine, focusOf, type Measured, measureTree } from "./harness-turn.ts";
import { callModel } from "./loop-model.ts";
import type { LoopOptions, LoopResult, StopReason, Usage } from "./loop-types.ts";
import { createVerifyStep } from "./loop-verify.ts";
import { stepsLeftNotice, systemPrompt, timeLeftNotice } from "./prompt.ts";
import { runRequirementsStep } from "./requirements-step.ts";
import { treeCycles } from "./tree-cycles.ts";
import { noUsage } from "./usage.ts";

export type { LoopOptions, LoopResult, StopReason, Usage, Verification } from "./loop-types.ts";

/**
 * A stop for want of progress or turns says which requirement was left failing and why, from
 * the harness's last measure, or that its check fails at the base where nothing changed it.
 */
function withOpen(
  why: string | null,
  measured: Measured | null,
  record: LoopOptions["record"],
): string | null {
  const failing = measured?.checks.find((one) => one.status === "failing");
  if (failing !== undefined) {
    if (why?.includes(`${failing.requirement} still fails`)) return why;
    const line = failureLine(failing.detail);
    return `${why ?? "the turns ran out"}; ${failing.requirement} still fails: ${line}`;
  }
  if (measured === null && record.held !== undefined)
    return `${why ?? "the turns ran out"}; R1's independent check fails at the base, and the tree was never changed`;
  return why;
}

/** The smallest reply worth asking for: one command and its fence. */
const minimumReplyTokens = 256;
/** Turns in a row with the same command and output before the loop calls it no progress. */
const repeatLimit = 3;
/** Replies in a row that follow no reply form before the model is called unusable here. */
const unusableAfter = 4;
/** Turns in a row, after the first edit, that change neither the tree nor any check's result. */
const quietNudge = 2;
const quietStop = 3;
const testCommand = /\b(vitest|jest|mocha|pytest|node\s+--test|npm\s+(run\s+)?test)\b/;

/**
 * One model turn at a time: a command, an edit, a requirement record, or completion. After every
 * turn that changed the tree the harness runs each requirement's independent checks and, once
 * they pass, the declared tests; when everything passes it verifies, whatever the model has
 * said. A completion over failing checks is answered with them. Progress is a change in the tree
 * or in a check's result. Whatever stops the loop, finalization judges the tree it leaves.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const conversation = createConversation({
    system: [systemPrompt, options.environment, options.instructions]
      .filter((part) => part.length > 0)
      .join("\n\n"),
    task: options.task,
    opening: options.handoff ?? "Begin.",
  });
  const verifier = createVerifyStep({ verify: options.verify, evidence: options.evidence });
  let record = options.record;
  let findings: string | null = null;
  let checked: string | null = null;
  let steps = 0;
  let usage: Usage = noUsage;
  // The last reported input count over the estimate of the prompt it counted.
  let calibration = 1;
  let sections = new Map<string, string>();
  let noticed = false;
  let turnStarted: number | null = null;
  let longestTurnMs = 0;
  let previous = { command: "", comparable: "", repeats: 0 };
  const cycles = treeCycles(repeatLimit);
  let malformed = 0;
  let proposedLast = false;
  let measured: Measured | null = null;
  let measuredDiff: string | null = options.settled ?? null;
  let checksText: string | null = null;
  let lastKey: string | null = null;
  let quiet = 0;
  let changedOnce = false;
  let modelTests = 0;
  const turnsBy = new Map<string, number>();
  const required = Math.max(1, record.requirements.filter((one) => one.required).length);
  const result = (stop: StopReason, why: string | null = null): LoopResult => ({
    stop,
    reason:
      stop === "no-progress" || stop === "step-budget" ? withOpen(why, measured, record) : why,
    record,
    verification: verifier.last(),
    steps,
    usage,
    verifications: verifier.verifications(),
    turnsByRequirement: Object.fromEntries(turnsBy),
    harnessChecks: options.checks?.runs() ?? 0,
    modelTestCommands: modelTests,
  });

  while (true) {
    if (steps >= options.maxSteps) return result("step-budget");
    const spent = usage.inputTokens + usage.outputTokens;
    const time = options.turnTime();
    // No turn starts that the time left cannot pay for: the longest turn so far is the measure.
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
    const diff = await options.diff();
    const cycle = cycles(diff, null);
    if (cycle.stop !== null) return result("no-progress", cycle.stop);
    changedOnce ||= diff.trim().length > 0;
    if (options.checks && changedOnce && diff !== measuredDiff) {
      const before = measured;
      measured = await measureTree(options.checks, record, diff);
      measuredDiff = diff;
      checksText = checksNote(measured, before);
      options.log(
        `checks: ${measured.checks.map((one) => `${one.requirement} ${one.status}`).join(", ")}`,
      );
      if (measured.ready) {
        options.log("every check passes: verifying the working tree");
        const outcome = await verifier.run(record, "harness");
        if (outcome.kind === "stop") return result(outcome.stop, outcome.reason);
        ({ findings, checked } = outcome);
        checksText = `${checksText}\n${outcome.answer}`;
      }
    }
    // A turn that changed neither the tree nor any check's or the verifier's result made no progress.
    const key = `${diff}\u0000${measured?.key ?? ""}\u0000${findings ?? ""}`;
    quiet = changedOnce && key === lastKey ? quiet + 1 : 0;
    lastKey = key;
    const focus = focusOf(measured);
    if (quiet >= quietStop) {
      const stuck = measured?.checks.find((one) => one.requirement === focus);
      return result(
        "no-progress",
        `${quietStop} turns changed neither the tree nor any check's result; ${focus ?? "the task"} still fails${stuck === undefined ? "" : `: ${failureLine(stuck.detail)}`}`,
      );
    }
    const stalled =
      quiet === quietNudge
        ? `Your last ${quietNudge} turns changed neither the tree nor any check's result. ${focus ?? "The task"}'s check still fails (above). Change the code it exercises; one more turn without a change ends the run.`
        : null;
    // Said once, for whichever budget runs short first.
    const budget = noticed
      ? null
      : (stepsLeftNotice(options.maxSteps - steps, options.maxSteps) ??
        timeLeftNotice(time.leftMs, time.wallMs));
    if (budget !== null) noticed = true;
    const notice = [cycle.notice, stalled, budget].filter((one) => one !== null).join("\n") || null;
    const now = diffSections(diff);
    conversation.edited(movedFiles(sections, now));
    sections = now;
    const state = { status: await options.status(), diff, findings, checks: checksText, notice };
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
    const turn = await callModel({
      model: options.model,
      messages,
      maxTokens: Math.min(options.turnTokens, room),
      prompt,
      step: steps + 1,
      usage,
      evidence: options.evidence,
      signal: options.signal,
    });
    usage = turn.usage;
    if (turn.kind === "error") return result("model-error", turn.message);
    steps += 1;
    const charged = focus ?? "R1";
    turnsBy.set(charged, (turnsBy.get(charged) ?? 0) + 1);
    if (required > 1 && (turnsBy.get(charged) ?? 0) > Math.floor(options.maxSteps / required)) {
      return result(
        "step-budget",
        `${charged} used its share of the turns with its checks still failing`,
      );
    }
    const { reply, read } = turn;
    if (reply.inputTokens !== null && prompt > 0) calibration = reply.inputTokens / prompt;
    const parsed = read.parsed;
    const afterProposal = proposedLast;
    proposedLast = false;
    malformed = parsed.kind === "malformed" ? malformed + 1 : 0;
    const note = (brief: string, text: string, fact: string) =>
      conversation.add(noteExchange({ step: steps, reply: read.text, brief, result: text, fact }));
    if (parsed.kind === "malformed") {
      if (malformed >= unusableAfter) {
        return result(
          "unusable-replies",
          `${malformed} replies in a row followed no reply form: ${parsed.reason}`,
        );
      }
      const cut = reply.truncated ? ` (it was cut off at ${options.turnTokens} tokens)` : "";
      note(
        "(a reply that followed no reply form)",
        `Your reply was not used: ${parsed.reason}${cut}. Reply with exactly one bash, edit, write or requirements block, or the completion marker alone.`,
        `a reply that was not used: ${parsed.reason}`,
      );
      continue;
    }
    if (parsed.kind === "command" || parsed.kind === "edit") {
      options.log(
        parsed.kind === "edit"
          ? `${parsed.edit.mode} ${parsed.edit.path}`
          : `$ ${parsed.command.split("\n")[0]}`,
      );
      if (parsed.kind === "command" && testCommand.test(parsed.command)) modelTests += 1;
      const ran = await runCommandStep({
        chokepoint: options.chokepoint,
        action: parsed.kind === "edit" ? { edit: parsed.edit } : { command: parsed.command },
        step: steps,
        outputs: options.outputs,
        previous,
      });
      previous = { command: ran.fact.command, comparable: ran.comparable, repeats: ran.repeats };
      if (ran.repeats >= repeatLimit) {
        return result(
          "no-progress",
          `the same command printed the same result ${ran.repeats} turns running`,
        );
      }
      const shown = circlingNote(ran.note, ran.repeats, findings);
      conversation.add(commandExchange({ ...ran, reply: read.text, result: shown }));
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
        // The same record twice running with no marker: the model is not going to send it.
        if (afterProposal && proposed.unchanged) {
          return result(
            "no-progress",
            "the same requirements block arrived twice running without the completion marker, and the record did not change",
          );
        }
        proposedLast = true;
        note(`(${proposal}; the record as it stands is at the top)`, proposed.note, proposal);
        continue;
      }
    }
    const marked = `${proposal.length > 0 ? `${proposal}, then ` : ""}the task marked complete`;
    // Completion is the checks' to grant: a claim over failing checks is answered with them.
    if (measured !== null && !measured.ready && !measured.unchecked && diff === measuredDiff) {
      note(
        `(${marked}; the checks still fail)`,
        `Not verified: the harness's checks of this tree still fail.\n${checksText ?? ""}\nChange the code they exercise; the tree is verified once they pass.`,
        `${marked} over failing checks`,
      );
      continue;
    }
    options.log("verifying the working tree");
    const outcome = await verifier.run(record, "model");
    if (outcome.kind === "stop") return result(outcome.stop, outcome.reason);
    ({ findings, checked } = outcome);
    note(`(${marked})`, outcome.answer, marked);
  }
}
