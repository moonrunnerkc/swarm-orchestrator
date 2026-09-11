import { z } from "zod";
import { campaignProtocolSchema, freezeProtocol } from "../eval/protocol.ts";
import { pairedNonInferiority } from "../eval/statistics.ts";
import { digestOfBytes } from "../evidence/canonical-json.ts";
import { type RoutingDecision, type RoutingInput, routeModel } from "./ucb.ts";

export const routingEvaluationSchema = z.object({
  version: z.literal(1),
  toolVersion: z.string(),
  goldenSetVersion: z.string(),
  candidates: z.array(z.string()).min(1),
  protocolDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  exposure: z.literal("held-out"),
  protocol: campaignProtocolSchema,
  policyDigest: z.string(),
  pairs: z.array(
    z.object({
      repository: z.string(),
      baseline: z.boolean(),
      candidate: z.boolean(),
      baselineCostUsd: z.number().nonnegative(),
      candidateCostUsd: z.number().nonnegative(),
      baselineLatencyMs: z.number().nonnegative(),
      candidateLatencyMs: z.number().nonnegative(),
      evidenceDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    }),
  ),
});

export function productionRouting(
  input: RoutingInput,
  context: { toolVersion: string; goldenSetVersion: string },
  artifact?: unknown,
): RoutingDecision {
  const parsed = routingEvaluationSchema.safeParse(artifact);
  const evaluation = parsed.success ? parsed.data : null;
  const matching =
    evaluation !== null &&
    evaluation.toolVersion === context.toolVersion &&
    evaluation.policyDigest === digestOfBytes(productionRouting.toString()) &&
    evaluation.protocolDigest === freezeProtocol(evaluation.protocol).digest &&
    evaluation.protocol.exposure === "held-out" &&
    evaluation.protocol.seeds.length === 1 &&
    JSON.stringify(evaluation.pairs.map((pair) => pair.repository).sort()) ===
      JSON.stringify(evaluation.protocol.cases.map((one) => one.repository).sort()) &&
    evaluation.goldenSetVersion === context.goldenSetVersion &&
    JSON.stringify([...evaluation.candidates].sort()) ===
      JSON.stringify([...input.candidates].sort()) &&
    new Set(evaluation.pairs.map((pair) => pair.repository)).size === evaluation.pairs.length;
  const justified =
    matching &&
    evaluation !== null &&
    pairedNonInferiority(evaluation.pairs, evaluation.protocol.margin).nonInferior &&
    evaluation.pairs.filter((pair) => pair.candidate).length > 0 &&
    evaluation.pairs.filter((pair) => pair.baseline).length > 0 &&
    (evaluation.pairs.reduce((sum, pair) => sum + pair.candidateCostUsd, 0) /
      evaluation.pairs.filter((pair) => pair.candidate).length <
      evaluation.pairs.reduce((sum, pair) => sum + pair.baselineCostUsd, 0) /
        evaluation.pairs.filter((pair) => pair.baseline).length ||
      evaluation.pairs.reduce((sum, pair) => sum + pair.candidateLatencyMs, 0) <
        evaluation.pairs.reduce((sum, pair) => sum + pair.baselineLatencyMs, 0));
  const decision = routeModel({
    ...input,
    ...(justified ? { authority: "held-out-evaluation" as const } : { authority: undefined }),
    settings: { minSamples: justified ? 20 : Number.MAX_SAFE_INTEGER, epsilon: 0, exploration: 0 },
  });
  // Even a justified production policy has no reason to select an unmeasured arm.
  if (justified && decision.arms.find((arm) => arm.model === decision.model)?.samples === 0) {
    return productionRouting(input, context);
  }
  return {
    ...decision,
    reason: `${justified ? "matching held-out evaluation authorized exploitation" : "learned routing is not authorized by matching held-out evidence"}; ${decision.reason}`,
  };
}
