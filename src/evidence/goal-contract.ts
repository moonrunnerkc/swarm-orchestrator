import { z } from "zod";
import { behaviorCheckSchema } from "./behavior-check.ts";
import { asJsonValue, digestOfJson } from "./canonical-json.ts";
import type { EvidenceRecorder } from "./session.ts";
import { contractPath } from "./task-contract.ts";
import { taskPresetSchema } from "./task-preset.ts";

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const goalContractSchema = z.strictObject({
  version: z.literal(1),
  goal: z.string().min(1),
  preset: taskPresetSchema.optional(),
  requirements: z
    .array(z.strictObject({ id, description: z.string().min(1), checks: z.array(id) }))
    .min(1)
    .max(128),
  checks: z
    .array(
      z.strictObject({
        id,
        behavior: behaviorCheckSchema.optional(),
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
  /**
   * How the requirement checks themselves are to be challenged. Additive: a contract without it
   * digests as before. Mutations are generated from the candidate's changed lines; a fixture is a
   * sealed patch the author declares to violate one named requirement, which the checks for that
   * requirement must reject. Both are bounded, and a fixture that fails to apply or to parse is
   * invalid evidence rather than a caught alternative.
   */
  challenges: z
    .strictObject({
      version: z.literal(1),
      mutations: z.enum(["auto", "none"]).default("auto"),
      fixtures: z
        .array(
          z.strictObject({
            id,
            requirement: id,
            description: z.string().min(1).max(2000),
            patch: z.string().min(1).max(1_000_000),
          }),
        )
        .max(32)
        .default([]),
      /**
       * Sealed implementations the author vouches satisfy one named requirement, each a patch on
       * the base. They are what justifies an additive check's expected result: a check proposed
       * after a challenge found a gap is admitted only if every reference for its requirement
       * passes it and the counterexample that exposed the gap fails it. Absent, nothing is
       * admitted for that requirement, whatever a model says the right answer is.
       */
      references: z
        .array(
          z.strictObject({
            id,
            requirement: id,
            description: z.string().min(1).max(2000),
            patch: z.string().min(1).max(1_000_000),
          }),
        )
        .max(32)
        .optional(),
    })
    .optional(),
});
export type GoalContract = z.infer<typeof goalContractSchema>;
export type GoalCheckDefinition = GoalContract["checks"][number];

/**
 * Why a contract other than the one the run was given is on the chain. A probe is the one-check
 * contract an admission runs a proposed check under; a revision is the run's contract with
 * admitted checks appended. Neither replaces the root declaration, and both name their parent.
 */
export const contractLineageSchema = z.discriminatedUnion("role", [
  z.strictObject({
    role: z.literal("admission-probe"),
    parent: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    requirement: id,
    proposal: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }),
  z.strictObject({
    role: z.literal("revision"),
    parent: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    admissions: z.array(z.string().regex(/^sha256:[0-9a-f]{64}$/)).min(1),
  }),
]);
export type ContractLineage = z.infer<typeof contractLineageSchema>;

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
  const preset = contract.preset;
  if (
    preset?.kind === "bugfix" &&
    !contract.checks.some(
      (check) => check.id === preset.reproducer && check.behavior?.kind === "cli",
    )
  )
    throw new Error("bugfix needs a named CLI reproducer with bounded output assertions");
  for (const requirement of contract.requirements) {
    if (
      new Set(requirement.checks).size !== requirement.checks.length ||
      requirement.checks.some((name) => !contract.checks.some((check) => check.id === name))
    )
      throw new Error(`requirement ${requirement.id} names duplicate or undefined checks`);
  }
  const fixtures = contract.challenges?.fixtures ?? [];
  if (new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length)
    throw new Error("duplicate challenge fixture identity in goal contract");
  for (const fixture of fixtures) {
    if (!contract.requirements.some((requirement) => requirement.id === fixture.requirement))
      throw new Error(
        `challenge fixture ${fixture.id} names undefined requirement ${fixture.requirement}`,
      );
  }
  const references = contract.challenges?.references ?? [];
  if (new Set(references.map((reference) => reference.id)).size !== references.length)
    throw new Error("duplicate challenge reference identity in goal contract");
  for (const reference of references) {
    if (!contract.requirements.some((requirement) => requirement.id === reference.requirement))
      throw new Error(
        `challenge reference ${reference.id} names undefined requirement ${reference.requirement}`,
      );
  }
  return { contract, digest: digestOfJson(asJsonValue(contract)) };
}

/** Whether a goal-contract payload is the run's own declaration rather than a derived one. */
export function isRootDeclaration(payload: unknown): boolean {
  return (
    payload !== null &&
    typeof payload === "object" &&
    (payload as { lineage?: unknown }).lineage === undefined
  );
}

export async function declareGoalContract(
  evidence: EvidenceRecorder,
  value: unknown,
): Promise<GoalContract> {
  const frozen = freezeGoalContract(value);
  if (
    evidence
      .records()
      .some(
        (entry) =>
          entry.type === "goal-contract" &&
          isRootDeclaration(evidence.payloads().get(entry.payloadDigest)),
      )
  )
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

/**
 * Put a probe or a revision on the chain beside the root declaration, naming its parent. The
 * parent must already be declared: a derived contract with no ancestor on the chain is refused.
 */
export async function declareDerivedGoalContract(
  evidence: EvidenceRecorder,
  value: unknown,
  lineage: ContractLineage,
): Promise<{ contract: GoalContract; digest: string; record: string }> {
  const frozen = freezeGoalContract(value);
  const parsed = contractLineageSchema.parse(lineage);
  const declared = evidence
    .records()
    .some(
      (entry) =>
        entry.type === "goal-contract" &&
        (evidence.payloads().get(entry.payloadDigest) as { digest?: string } | undefined)
          ?.digest === parsed.parent,
    );
  if (!declared) throw new Error(`the parent contract ${parsed.parent} is not on the chain`);
  const recorded = await evidence.record({
    type: "goal-contract",
    actor: "harness",
    provenance: ["user", "model"],
    payload: asJsonValue({ ...frozen, lineage: parsed }),
  });
  return { ...frozen, record: recorded.record.payloadDigest };
}

/**
 * Why a revision is not an append-only extension of its parent, or null where it is. Every
 * requirement keeps its identity and description and every check it named, in order; every
 * original check is byte-identical; nothing else changes; and the only additions are the checks
 * admitted, each appended to the one requirement it was admitted for.
 */
export function revisionProblem(
  parent: GoalContract,
  revised: GoalContract,
  admitted: readonly { readonly requirement: string; readonly check: GoalCheckDefinition }[],
): string | null {
  const canonical = (value: unknown) => JSON.stringify(asJsonValue(value));
  const { requirements: parentRequirements, checks: parentChecks, ...parentRest } = parent;
  const { requirements: revisedRequirements, checks: revisedChecks, ...revisedRest } = revised;
  if (canonical(parentRest) !== canonical(revisedRest))
    return "the revision changes the contract beyond its requirement checks";
  if (revisedRequirements.length !== parentRequirements.length)
    return "the revision adds or removes a requirement";
  for (const [index, original] of parentRequirements.entries()) {
    const next = revisedRequirements[index];
    const added = admitted
      .filter((one) => one.requirement === original.id)
      .map((one) => one.check.id);
    if (
      next === undefined ||
      next.id !== original.id ||
      next.description !== original.description ||
      canonical(next.checks) !== canonical([...original.checks, ...added])
    )
      return `requirement ${original.id} is not its original with only the admitted checks appended`;
  }
  const expected = [...parentChecks, ...admitted.map((one) => one.check)];
  if (canonical(revisedChecks) !== canonical(expected))
    return "the revision's checks are not the original checks followed by the admitted ones";
  return null;
}
