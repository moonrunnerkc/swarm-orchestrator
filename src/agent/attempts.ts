import { readFile } from "node:fs/promises";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { type LoopOptions, type LoopResult, runLoop, type StopReason } from "./loop.ts";
import type { ModelClient } from "./model.ts";
import type { RequirementRecord } from "./requirement-record.ts";
import { type ReviewOutcome, runReview } from "./review.ts";
import type { Verifier } from "./verification.ts";

/** Stops that say the model, not the environment, was the problem: worth one stronger model. */
const modelRelated: ReadonlySet<StopReason> = new Set(["no-progress", "unusable-replies"]);

/** What the attempts so far have left: kept in place, so an interrupted run still reports them. */
export interface Progress {
  /** The model working now: the first, or the stronger one after an escalation. */
  model: ModelClient;
  readonly loops: LoopResult[];
  record: RequirementRecord;
  review: ReviewOutcome | null;
  escalated: boolean;
}

type Shared = Omit<LoopOptions, "model" | "record" | "maxSteps" | "maxTokens" | "handoff">;

/**
 * The loop, then at most one escalation to a stronger model on a model-related stop, and, when
 * asked for, at most one fresh-context review of a completed change. A review's confirmed
 * finding sends the same model back into the loop with it; nothing a review says is a status.
 */
export async function runAttempts(input: {
  readonly shared: Shared;
  readonly escalation: ModelClient | null;
  readonly review: boolean;
  readonly maxSteps: number;
  readonly maxTokens: number;
  readonly verifier: Verifier;
  readonly evidence: EvidenceRecorder;
  readonly base: string;
  /** Where a review keeps the tree snapshots taken around its command. */
  readonly reviewDirectory: string;
  readonly progress: Progress;
}): Promise<{ readonly stop: StopReason; readonly reason: string | null }> {
  const { shared, progress } = input;
  let handoff: string | null = null;
  while (true) {
    const spent = progress.loops.reduce(
      (sum, one) => sum + one.usage.inputTokens + one.usage.outputTokens,
      0,
    );
    const reviewTokens = (progress.review?.inputTokens ?? 0) + (progress.review?.outputTokens ?? 0);
    const loop = await runLoop({
      ...shared,
      model: progress.model,
      record: progress.record,
      maxSteps: input.maxSteps - progress.loops.reduce((sum, one) => sum + one.steps, 0),
      maxTokens: input.maxTokens - spent - reviewTokens,
      handoff,
    });
    progress.loops.push(loop);
    progress.record = loop.record;
    if (input.review && progress.review === null && loop.stop === "complete") {
      const held = input.verifier.held();
      const diff = held?.result.evidence.patch
        ? await readFile(held.result.evidence.patch, "utf8")
        : "";
      shared.log("reviewing the change with a fresh context");
      progress.review = await runReview({
        model: progress.model,
        chokepoint: shared.chokepoint,
        evidence: input.evidence,
        task: shared.task,
        environment: shared.environment,
        record: progress.record,
        diff,
        workspace: shared.outputs.root,
        base: input.base,
        directory: input.reviewDirectory,
        turnTokens: shared.turnTokens,
        signal: shared.signal,
      });
      shared.log(`review: ${progress.review.outcome}`);
      if (progress.review.handoff === null) return loop;
      handoff = progress.review.handoff;
      continue;
    }
    const stronger = input.escalation;
    if (progress.escalated || stronger === null || !modelRelated.has(loop.stop)) return loop;
    progress.escalated = true;
    shared.log(`escalating from ${progress.model.model} to ${stronger.model}: ${loop.stop}`);
    await input.evidence.record({
      type: "model-error",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        escalation: {
          from: progress.model.model,
          to: stronger.model,
          because: loop.stop,
          reason: loop.reason,
        },
      },
    });
    progress.model = stronger;
    handoff = `Another model worked on this task before you and stopped (${loop.stop}: ${loop.reason ?? "no reason given"}). The working tree holds its changes; check them before building on them.${loop.verification === null ? "" : `\n\nThe verifier's latest findings:\n${loop.verification.feedback}`}`;
  }
}
