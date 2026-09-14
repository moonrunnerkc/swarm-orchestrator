import { z } from "zod";
import { asJsonValue, canonicalJson, digestOfJson } from "../evidence/canonical-json.ts";
import { goalContractSchema } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { taskContractSchema } from "../evidence/task-contract.ts";
import { controllerScopeSchema } from "./controller-scope.ts";
import { revisionOperationSchema } from "./graph-revision.ts";
import { readTaskGraph } from "./task-graph.ts";

const positive = z.number().int().positive();
export const controllerConfigurationSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2)]),
    controllerScope: controllerScopeSchema.optional(),
    runId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    repositoryRoot: z.string(),
    baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
    scratchRoot: z.string(),
    tasks: z.array(z.string()).min(1),
    graph: z
      .unknown()
      .nullable()
      .transform((graph) => (graph === null ? null : readTaskGraph(graph))),
    graphSource: z.enum(["goal", "file"]),
    contracts: z.array(taskContractSchema).min(1),
    goalContract: goalContractSchema.nullable(),
    modelSpec: z.string(),
    maxSteps: positive,
    attempts: z.number().int().nonnegative(),
    repairAttempts: z.number().int().min(0).max(8),
    redundancy: positive,
    concurrency: z.number().int().nonnegative(),
    adaptation: z.boolean(),
    peerInformation: z.boolean(),
    graphRevisionLimit: z.number().int().min(0).max(16),
    revisions: z.array(z.strictObject({ operation: revisionOperationSchema, reason: z.string() })),
    execution: z.enum(["host", "backend"]),
    executionIdentity: z.string().nullable(),
    gateOptions: z.strictObject({
      commandOverrides: z
        .record(
          z.string(),
          z.union([
            z.string(),
            z.strictObject({
              command: z.string(),
              severity: z.enum(["blocking", "advisory"]).optional(),
              parser: z.enum(["exit-code", "test-output", "no-output"]).optional(),
            }),
          ]),
        )
        .optional(),
    }),
  })
  .refine((spec) => (spec.version === 2) === (spec.controllerScope !== undefined), {
    message: "controller scope authority requires version two and must be preserved",
  });
export type ControllerConfiguration = z.infer<typeof controllerConfigurationSchema>;

export function controllerConfiguration(
  evidence: EvidenceRecorder,
): ControllerConfiguration | null {
  const declarations = evidence
    .records()
    .filter((record) => record.type === "controller-configuration");
  if (declarations.length === 0) return null;
  if (declarations.length !== 1 || declarations[0]?.actor !== "harness")
    throw new Error(
      "controller configuration is duplicated or not harness-authorized; preserve and reconcile",
    );
  const payload = z
    .strictObject({ spec: controllerConfigurationSchema, digest: z.string() })
    .parse(evidence.payloads().get(declarations[0].payloadDigest));
  if (digestOfJson(asJsonValue(payload.spec)) !== payload.digest)
    throw new Error("controller configuration digest disagrees with its recorded bytes");
  return payload.spec;
}

export async function sealControllerConfiguration(
  evidence: EvidenceRecorder,
  input: ControllerConfiguration,
  resume: boolean,
): Promise<void> {
  const spec = controllerConfigurationSchema.parse(input);
  const previous = controllerConfiguration(evidence);
  if (previous !== null) {
    if (!resume) throw new Error("controller already exists; resume the recorded run explicitly");
    if (canonicalJson(asJsonValue(previous)) !== canonicalJson(asJsonValue(spec)))
      throw new Error(
        "resume must preserve the original controller configuration, paths, contracts and checks",
      );
    return;
  }
  if (resume)
    throw new Error(
      "this history predates recoverable controller configuration; preserve its candidates and start an explicitly authorized continuation",
    );
  await evidence.record({
    type: "controller-configuration",
    actor: "harness",
    provenance: ["user"],
    payload: { spec: asJsonValue(spec), digest: digestOfJson(asJsonValue(spec)) },
  });
}
