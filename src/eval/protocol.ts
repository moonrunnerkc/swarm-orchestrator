import { z } from "zod";
import { digestOfJson } from "../evidence/canonical-json.ts";
import { freezeJson } from "../evidence/frozen-json.ts";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const identifier = z.string().min(1);
export const campaignProtocolSchema = z
  .object({
    version: z.literal(1),
    population: identifier,
    samplingUnit: z.literal("independent-repository"),
    exposure: z.enum(["development", "held-out"]),
    stratum: z.enum(["ordinary", "adversarial"]),
    cases: z
      .array(
        z.object({
          id: identifier,
          repository: identifier,
          baseCommit: identifier,
          oracleDigest: digest,
          heldBackDigest: digest,
          sourceDigest: digest,
        }),
      )
      .min(1),
    arms: z
      .array(
        z.object({
          id: identifier,
          implementationDigest: digest,
          model: identifier,
          backendDigest: digest,
        }),
      )
      .min(2),
    verifierDigest: digest,
    budgets: z.object({ tokens: z.number().int().positive(), wallMs: z.number().int().positive() }),
    seeds: z.array(z.number().int().nonnegative()).min(1),
    order: z.literal("counterbalanced"),
    stopping: z.literal("fixed-schedule"),
    failureDisposition: z.literal("retain-all-launched"),
    baseline: identifier,
    baselineSelectionDigest: digest,
    margin: z.number().positive().max(1),
    targetUpperBound: z.number().positive().max(1),
    interval: z.literal("paired-hoeffding-95"),
  })
  .superRefine((protocol, context) => {
    for (const [name, values] of [
      ["case", protocol.cases.map((entry) => entry.id)],
      ["repository", protocol.cases.map((entry) => entry.repository)],
      ["arm", protocol.arms.map((entry) => entry.id)],
      ["seed", protocol.seeds.map(String)],
    ] as const) {
      if (new Set(values).size !== values.length)
        context.addIssue({ code: "custom", message: `duplicate ${name} identity` });
    }
    if (!protocol.arms.some((arm) => arm.id === protocol.baseline))
      context.addIssue({ code: "custom", message: "baseline is not a declared arm" });
  });
export type CampaignProtocol = z.infer<typeof campaignProtocolSchema>;

export function freezeProtocol(input: unknown): { protocol: CampaignProtocol; digest: string } {
  const protocol = freezeJson(campaignProtocolSchema.parse(input));
  return { protocol, digest: digestOfJson(protocol) };
}

export function protocolSchedule(protocol: CampaignProtocol) {
  const sealed = freezeProtocol(protocol);
  return sealed.protocol.cases.flatMap((one, index) =>
    protocol.seeds.flatMap((seed) => {
      const arms = index % 2 === 0 ? protocol.arms : [...protocol.arms].reverse();
      return arms.map((arm) => ({
        caseId: one.id,
        repository: one.repository,
        armId: arm.id,
        seed,
        executionId: digestOfJson({ protocol: sealed.digest, caseId: one.id, armId: arm.id, seed }),
      }));
    }),
  );
}
