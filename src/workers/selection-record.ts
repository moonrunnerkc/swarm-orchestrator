import { z } from "zod";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { AttemptSelection } from "./attempt-selector.ts";

const rankedAttemptSchema = z.object({
  workerId: z.string().min(1),
  attemptIndex: z.number().int().nonnegative(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
  testsCollected: z.number().int().nullable(),
  assertions: z.number().int().nonnegative(),
  tests: z.number().int().nonnegative(),
  skipMarkers: z.number().int().nonnegative(),
  changedLinesCovered: z.number().int().nullable(),
  uncoveredChangedLines: z.number().int().nullable(),
  erosions: z.number().int().nonnegative(),
  changedFiles: z.number().int().nonnegative(),
  addedLines: z.number().int().nonnegative(),
});

/**
 * The whole working, not the verdict alone: every attempt's numbers, the order they produced,
 * the dimension that separated the top two, and every dimension nothing measured. A reviewer
 * re-reads the ranking from this rather than taking it.
 *
 * No claim is submitted against this record, deliberately. A selection is a computation over
 * numbers this payload already carries, so any predicate over it would restate its own
 * arithmetic and could never be false. What is worth claiming is what happened next, which
 * the queue asserts: that the attempt named here is the one that landed.
 */
const attemptSelectionSchema = z.object({
  taskId: z.string().min(1),
  baseCommit: z.string(),
  /** What the numbers are a statement about: each attempt alone, before any merge. */
  basis: z.string().min(1),
  ranked: z.number().int().nonnegative(),
  eligible: z.number().int().nonnegative(),
  winner: z.string().nullable(),
  decidedBy: z.string().nullable(),
  order: z.array(z.string()),
  attempts: z.array(rankedAttemptSchema),
  abstentions: z.array(z.object({ dimension: z.string(), reason: z.string() })),
});

export interface RecordedSelection {
  readonly digest: string;
}

export async function recordSelection(
  evidence: EvidenceRecorder,
  selection: AttemptSelection,
): Promise<RecordedSelection> {
  const payload = attemptSelectionSchema.parse({
    taskId: selection.taskId,
    baseCommit: selection.baseCommit,
    basis: `pre-merge measures at ${selection.baseCommit}`,
    ranked: selection.attempts.length,
    eligible: selection.attempts.filter((attempt) => attempt.eligible).length,
    winner: selection.winner,
    decidedBy: selection.decidedBy,
    order: [...selection.order],
    attempts: selection.attempts.map((attempt) => ({ ...attempt })),
    abstentions: selection.abstentions.map((abstention) => ({ ...abstention })),
  });

  const recorded = await evidence.record({
    type: "attempt-selection",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

  return { digest: recorded.record.payloadDigest };
}
