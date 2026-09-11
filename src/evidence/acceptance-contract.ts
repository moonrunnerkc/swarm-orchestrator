import { z } from "zod";
import { digestOfJson } from "./canonical-json.ts";
import { freezeJson } from "./frozen-json.ts";

const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const acceptanceContractSchema = z
  .object({
    version: z.literal(1),
    author: z.string().min(1),
    taskId: z.string().min(1),
    exposure: z.enum(["public", "held-back"]),
    immutablePaths: z.array(z.string().min(1)),
    requirements: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
          artifactDigest: digest,
          argv: z.array(z.string()).min(1),
          severity: z.enum(["required", "advisory"]),
          applicable: z.boolean(),
          referenceDigest: digest,
          violatingControlDigest: digest,
        }),
      )
      .min(1),
  })
  .superRefine((contract, context) => {
    if (
      new Set(contract.requirements.map((requirement) => requirement.id)).size !==
      contract.requirements.length
    ) {
      context.addIssue({ code: "custom", message: "requirement IDs must be unique" });
    }
  });
export type AcceptanceContract = z.infer<typeof acceptanceContractSchema>;
export function freezeAcceptanceContract(input: unknown) {
  const contract = freezeJson(acceptanceContractSchema.parse(input));
  return { contract, digest: digestOfJson(contract) };
}
