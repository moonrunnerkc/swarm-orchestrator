import { z } from "zod";
import { asJsonValue } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

const nonnegative = z.number().int().nonnegative();
export const controllerEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("attempt-not-dispatched"),
    taskId: z.string(),
    workerId: z.string(),
    reason: z.string(),
  }),
  z.strictObject({
    kind: z.literal("work-declared"),
    tasks: z.array(z.strictObject({ id: z.string(), objective: z.string() })).min(1),
  }),
  z.strictObject({ kind: z.literal("integration-observed"), commit: z.string(), tree: z.string() }),
  z.strictObject({
    kind: z.literal("run-started"),
    version: z.literal(1),
    runId: z.string().min(1),
    startedAt: nonnegative,
    deadlineAt: nonnegative,
    maxTokens: z.number().int().positive(),
    modelConcurrency: z.number().int().positive(),
    testConcurrency: z.number().int().positive(),
  }),
  z.strictObject({
    kind: z.literal("usage-reserved"),
    id: z.string().min(1),
    activity: z.string().min(1),
    inputAllowance: nonnegative,
    outputAllowance: nonnegative,
    estimator: z.literal("utf8-bytes-plus-framing"),
  }),
  z.strictObject({
    kind: z.literal("usage-settled"),
    id: z.string().min(1),
    inputTokens: nonnegative.nullable(),
    outputTokens: nonnegative.nullable(),
    status: z.enum(["reported", "unknown", "not-started"]),
    detail: z.string(),
  }),
  z.strictObject({ kind: z.literal("stop-requested"), reason: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("repair-requested"),
    taskId: z.string(),
    workerId: z.string(),
    previousWorkerId: z.string(),
    previousCommit: z.string().nullable(),
    baseCommit: z.string(),
    attempt: nonnegative,
    reason: z.string(),
    failureKey: z.string().optional(),
    failureDigest: z.string().optional(),
  }),
  z.strictObject({
    kind: z.literal("repair-exhausted"),
    taskId: z.string(),
    previousWorkerId: z.string(),
    baseCommit: z.string(),
    reason: z.string(),
  }),
]);
export type ControllerEvent = z.infer<typeof controllerEventSchema>;

export async function recordControllerEvent(
  evidence: EvidenceRecorder,
  event: ControllerEvent,
): Promise<void> {
  await evidence.record({
    type: "controller-event",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(controllerEventSchema.parse(event)),
  });
}

export function controllerEvents(evidence: EvidenceRecorder): readonly ControllerEvent[] {
  return evidence
    .records()
    .filter((record) => record.type === "controller-event")
    .map((record) => controllerEventSchema.parse(evidence.payloads().get(record.payloadDigest)));
}
