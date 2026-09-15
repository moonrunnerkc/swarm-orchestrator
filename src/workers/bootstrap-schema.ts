import { z } from "zod";

const oid = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);
export const bootstrapIntentSchema = z.strictObject({
  phase: z.literal("intent"),
  version: z.literal(1),
  language: z.literal("node"),
  baseCommit: oid,
  commit: oid,
  tree: oid,
  ref: z.string(),
  workspace: z.string(),
  timestamp: z.literal(0),
  files: z.record(z.string(), z.string()),
});
export type BootstrapIntent = z.infer<typeof bootstrapIntentSchema>;
export const bootstrapObservationSchema = z.strictObject({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  truncated: z.boolean(),
  startFailure: z.string().nullable(),
});
export const bootstrapRecordSchema = z.discriminatedUnion("phase", [
  bootstrapIntentSchema,
  z.strictObject({
    phase: z.literal("check-intent"),
    id: z.string(),
    check: z.enum(["toolchain", "positive", "negative"]),
    argv: z.array(z.string()),
    backend: z.string(),
    files: z.record(z.string(), z.string()),
  }),
  z.strictObject({
    phase: z.literal("check-observed"),
    id: z.string(),
    observation: bootstrapObservationSchema,
  }),
  z.strictObject({
    phase: z.literal("ready"),
    commit: oid,
    tree: oid,
    checks: z.array(z.string()).length(3),
  }),
  z.strictObject({ phase: z.literal("cleanup-intent") }),
  z.strictObject({ phase: z.literal("cleanup-completed") }),
]);
