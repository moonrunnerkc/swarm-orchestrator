import { z } from "zod";
import type { GoalContract } from "../evidence/goal-contract.ts";

const count = z.number().int().nonnegative();
const goalCandidateSchema = z.strictObject({
  workerId: z.string(),
  baseCommit: z.string(),
  attemptIndex: count,
  regressionPassed: z.boolean(),
  obligations: z.array(z.strictObject({ id: z.string(), accepted: z.boolean() })),
  tokenCount: count.nullable(),
  changedFiles: count,
  changedLines: count,
  verification: z.string().nullable(),
});
export type GoalCandidate = z.infer<typeof goalCandidateSchema>;
export const goalSelectionSchema = z.strictObject({
  policy: z.literal("complete-goal-selection-v1"),
  objective: z.enum(["reported-model-tokens", "change-size", "stable"]),
  taskId: z.string(),
  baseCommit: z.string(),
  order: z.array(z.string()),
  winner: z.string().nullable(),
  candidates: z.array(
    goalCandidateSchema.extend({ eligible: z.boolean(), reason: z.string().nullable() }),
  ),
  abstentions: z.array(z.string()),
});
export type GoalSelection = z.infer<typeof goalSelectionSchema>;

/** Completeness is an eligibility condition. Test and assertion volume never rank a solution. */
export function selectGoalCandidate(
  taskId: string,
  contract: GoalContract,
  candidates: readonly GoalCandidate[],
): GoalSelection {
  candidates = z.array(goalCandidateSchema).parse(candidates);
  if (candidates.length === 0) throw new Error("goal selection requires captured candidates");
  const baseCommit = candidates[0]?.baseCommit ?? "";
  if (
    new Set(candidates.map((candidate) => candidate.workerId)).size !== candidates.length ||
    candidates.some((candidate) => candidate.baseCommit !== baseCommit)
  )
    throw new Error("goal candidates must have unique identities and one common base");
  const assessed = candidates.map((candidate) => {
    const missing = contract.requirements.filter(
      (requirement) =>
        requirement.checks.length === 0 ||
        !candidate.obligations.some(
          (observation) => observation.id === requirement.id && observation.accepted,
        ),
    );
    const reason =
      new Set(candidate.obligations.map((obligation) => obligation.id)).size !==
      candidate.obligations.length
        ? "ambiguous requirement observations"
        : candidate.verification === null
          ? "no independent verification"
          : !candidate.regressionPassed
            ? "required integrated checks did not pass"
            : missing.length > 0
              ? `unaccepted requirements: ${missing.map((requirement) => requirement.id).join(", ")}`
              : null;
    return { ...candidate, eligible: reason === null, reason };
  });
  const eligible = assessed.filter((candidate) => candidate.eligible);
  const tokensMeasured = eligible.some((candidate) => candidate.tokenCount !== null);
  const order = [...eligible]
    .sort((left, right) => {
      if (contract.selection === "cost" && tokensMeasured) {
        if (left.tokenCount === null)
          return right.tokenCount === null ? left.attemptIndex - right.attemptIndex : 1;
        if (right.tokenCount === null) return -1;
        if (left.tokenCount !== right.tokenCount) return left.tokenCount - right.tokenCount;
      }
      if (contract.selection !== "stable") {
        const size =
          left.changedLines - right.changedLines || left.changedFiles - right.changedFiles;
        if (size !== 0) return size;
      }
      return left.attemptIndex - right.attemptIndex;
    })
    .map((candidate) => candidate.workerId);
  return goalSelectionSchema.parse({
    policy: "complete-goal-selection-v1",
    objective: contract.selection === "cost" ? "reported-model-tokens" : contract.selection,
    taskId,
    baseCommit,
    order,
    winner: order[0] ?? null,
    candidates: assessed,
    abstentions:
      contract.selection === "cost" && !tokensMeasured
        ? ["provider token usage was not measured; monetary cost is also unavailable"]
        : [],
  });
}
