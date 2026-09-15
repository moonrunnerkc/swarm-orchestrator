import { z } from "zod";
import { asJsonValue, digestOfJson } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";
import { contractPath } from "./task-contract.ts";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const goalContractSchema = z.strictObject({
  version: z.literal(1),
  goal: z.string().min(1),
  requirements: z
    .array(z.strictObject({ id, description: z.string().min(1), checks: z.array(id) }))
    .min(1)
    .max(128),
  checks: z
    .array(
      z.strictObject({
        id,
        command: z.string().min(1).max(8192),
        author: z.enum(["user", "model"]),
        exposure: z.enum(["shared", "withheld"]),
        artifacts: z
          .array(
            z.strictObject({
              path: z.string().min(1),
              content: z.string().max(1_000_000),
            }),
          )
          .max(64),
      }),
    )
    .max(128),
  immutablePaths: z.array(z.string().min(1)),
  selection: z.enum(["cost", "change-size", "stable"]).default("stable"),
});
export type GoalContract = z.infer<typeof goalContractSchema>;

export function freezeGoalContract(value: unknown): { contract: GoalContract; digest: string } {
  const parsed = goalContractSchema.parse(value);
  const contract: GoalContract = {
    ...parsed,
    immutablePaths: parsed.immutablePaths.map(contractPath),
    checks: parsed.checks.map((check) => ({
      ...check,
      artifacts: check.artifacts.map((artifact) => ({
        ...artifact,
        path: contractPath(artifact.path),
      })),
    })),
  };
  for (const [label, names] of [
    ["requirement", contract.requirements.map((entry) => entry.id)],
    ["check", contract.checks.map((entry) => entry.id)],
    [
      "artifact",
      contract.checks.flatMap((entry) => entry.artifacts.map((artifact) => artifact.path)),
    ],
  ] as const) {
    if (new Set(names).size !== names.length)
      throw new Error(`duplicate ${label} identity in goal contract`);
  }
  for (const requirement of contract.requirements) {
    if (
      new Set(requirement.checks).size !== requirement.checks.length ||
      requirement.checks.some((name) => !contract.checks.some((check) => check.id === name))
    )
      throw new Error(`requirement ${requirement.id} names duplicate or undefined checks`);
  }
  return { contract, digest: digestOfJson(asJsonValue(contract)) };
}

export async function declareGoalContract(
  evidence: EvidenceRecorder,
  value: unknown,
): Promise<GoalContract> {
  const frozen = freezeGoalContract(value);
  if (evidence.records().some((entry) => entry.type === "goal-contract"))
    throw new Error("goal requirements are already pinned; preserve their declaration");
  await evidence.record({
    type: "goal-contract",
    actor: "harness",
    provenance: frozen.contract.checks.some((check) => check.author === "model")
      ? ["user", "model"]
      : ["user"],
    payload: asJsonValue(frozen),
  });
  return frozen.contract;
}

export function goalImmutablePaths(contract: GoalContract): readonly string[] {
  return [
    ...new Set([
      ...contract.immutablePaths,
      ...contract.checks.flatMap((check) => check.artifacts.map((artifact) => artifact.path)),
    ]),
  ];
}
