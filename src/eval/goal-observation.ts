import { z } from "zod";

const count = z.number().int().nonnegative();
export const goalCampaignMetricsSchema = z
  .strictObject({
    inputTokens: count.nullable(),
    outputTokens: count.nullable(),
    reservedTokens: count.nullable(),
    unknownCalls: count.nullable(),
    retries: count.nullable(),
    integrationFailures: count.nullable(),
    integrationRepairs: count.nullable(),
    humanInterventions: count.nullable(),
    humanRepairMinutes: z.number().nonnegative().nullable(),
    required: count.positive(),
    accepted: count,
    missedChecks: z.array(z.string()),
    partialBranch: z.string().nullable(),
    termination: z.enum([
      "completed",
      "budget",
      "cancelled",
      "crashed",
      "admission-rejected",
      "not-launched",
    ]),
    detail: z.string(),
  })
  .refine((metrics) => metrics.accepted <= metrics.required, {
    message: "accepted requirements exceed the declared set",
  });
export type GoalCampaignMetrics = z.infer<typeof goalCampaignMetricsSchema>;

export function unobservedGoalMetrics(
  required: number,
  termination: GoalCampaignMetrics["termination"],
  detail: string,
): GoalCampaignMetrics {
  return {
    inputTokens: null,
    outputTokens: null,
    reservedTokens: null,
    unknownCalls: null,
    retries: null,
    integrationFailures: null,
    integrationRepairs: null,
    humanInterventions: null,
    humanRepairMinutes: null,
    required,
    accepted: 0,
    missedChecks: ["execution not observed"],
    partialBranch: null,
    termination,
    detail,
  };
}
