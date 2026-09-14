import { z } from "zod";
import { asJsonValue, digestOfJson } from "../evidence/canonical-json.ts";
import { goalContractSchema } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { controllerConfigurationSchema } from "./controller-configuration.ts";
import { controllerScopeSchema } from "./controller-scope.ts";
import { readTaskGraph } from "./task-graph.ts";

const positive = z.number().int().positive();
/** The pre-planning declaration contains no provider credentials or mutable input-file references. */
export const controllerLaunchSchema = z
  .strictObject({
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    bootstrap: z.literal("node").optional(),
    controllerScope: controllerScopeSchema.optional(),
    runId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    repositoryRoot: z.string(),
    baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/),
    scratchRoot: z.string(),
    goal: z.string().nullable(),
    tasks: z.array(z.string()),
    graph: z
      .unknown()
      .nullable()
      .transform((value) => (value === null ? null : readTaskGraph(value))),
    suppliedGoal: goalContractSchema.nullable(),
    modelSpec: z.string(),
    localBaseUrl: z.url().nullable(),
    localThinking: z.boolean().nullable(),
    maxSteps: positive,
    attempts: z.number().int().nonnegative(),
    maxWallMs: positive,
    maxTokens: positive,
    repairAttempts: z.number().int().min(0).max(8),
    redundancy: positive,
    concurrency: z.number().int().nonnegative(),
    modelConcurrency: positive,
    testConcurrency: positive,
    isolation: z
      .strictObject({
        runtime: z.enum(["docker", "podman", "nerdctl"]),
        image: z.string().regex(/^sha256:[0-9a-f]{64}$/),
        user: z.string(),
        memory: z.string().optional(),
        processLimit: positive.optional(),
        network: z.enum(["none", "bridge"]).optional(),
      })
      .nullable(),
    gateOptions: controllerConfigurationSchema.shape.gateOptions,
    bundleDirectory: z.string().nullable(),
  })
  .refine((spec) => spec.version >= 2 === (spec.controllerScope !== undefined), {
    message: "controller scope authority requires version two and must be preserved",
  })
  .refine(
    (spec) =>
      (spec.version === 3) === (spec.bootstrap !== undefined) &&
      (spec.bootstrap === undefined ||
        (spec.goal !== null && spec.controllerScope?.kind === "workspace")),
    {
      message: "bootstrap requires a version-three goal launch with workspace authority",
    },
  );
export type ControllerLaunch = z.infer<typeof controllerLaunchSchema>;
export function controllerLaunch(evidence: EvidenceRecorder): ControllerLaunch | null {
  const records = evidence.records().filter((record) => record.type === "controller-launch");
  if (records.length === 0) return null;
  if (records.length !== 1 || records[0]?.actor !== "harness")
    throw new Error("controller launch is duplicated or not harness-authorized; preserve history");
  const captured = z
    .strictObject({ spec: controllerLaunchSchema, digest: z.string() })
    .parse(evidence.payloads().get(records[0].payloadDigest));
  if (digestOfJson(asJsonValue(captured.spec)) !== captured.digest)
    throw new Error("controller launch digest mismatch; preserve history");
  return captured.spec;
}
export async function declareControllerLaunch(
  evidence: EvidenceRecorder,
  input: ControllerLaunch,
): Promise<ControllerLaunch> {
  if (controllerLaunch(evidence) !== null) throw new Error("controller launch is already pinned");
  const spec = controllerLaunchSchema.parse(input);
  await evidence.record({
    type: "controller-launch",
    actor: "harness",
    provenance: ["user"],
    payload: { spec: asJsonValue(spec), digest: digestOfJson(asJsonValue(spec)) },
  });
  return spec;
}
