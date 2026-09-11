import { z } from "zod";
import type { Clock } from "../core/clock.ts";
import { digestOfJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";

export const firstRunProtocolSchema = z.object({
  version: z.literal(1),
  buildDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  phase: z.enum(["formative", "validation"]),
  sampleSize: z.number().int().positive(),
  passingFraction: z.number().positive().max(1),
  capMs: z.number().int().positive(),
  prerequisites: z.array(z.string()),
  observer: z.string().regex(/^[a-z0-9-]+$/),
  participant: z.string().regex(/^[a-z0-9-]+$/),
  consent: z.literal(true),
  fresh: z.boolean(),
  seenDemo: z.boolean(),
  readRepository: z.boolean(),
});
export const firstRunEventSchema = z.object({
  milestone: z.enum([
    "install-started",
    "install-complete",
    "policy-ready",
    "task-started",
    "patch-produced",
    "verification-complete",
    "explanation-complete",
    "assistance",
    "failed",
  ]),
  action: z.string().max(4000),
  bundleDigest: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
  comprehension: z
    .object({
      understandsIntegrity: z.boolean(),
      identifiesUnjudgedWork: z.boolean(),
      identifiesExecutionMode: z.boolean(),
    })
    .optional(),
});
const required = [
  "install-started",
  "install-complete",
  "policy-ready",
  "task-started",
  "patch-produced",
  "verification-complete",
  "explanation-complete",
];

export async function recordFirstRunObservation(
  input: unknown,
  eventInput: unknown,
  evidence: EvidenceRecorder,
  clock: Clock,
) {
  const protocol = firstRunProtocolSchema.parse(input);
  const event = firstRunEventSchema.parse(eventInput);
  if (
    protocol.phase === "validation" &&
    (!protocol.fresh || protocol.seenDemo || protocol.readRepository)
  )
    throw new Error("validation requires a participant who has not used, read, or seen the tool");
  const protocolDigest = digestOfJson(protocol);
  const previous = evidence
    .records()
    .filter((entry) => entry.type === "first-run-observation")
    .map(
      (entry) =>
        evidence.payloads().get(entry.payloadDigest) as {
          protocolDigest: string;
          event: z.infer<typeof firstRunEventSchema>;
          timestamp: number;
        },
    );
  if (previous.some((entry) => entry.protocolDigest !== protocolDigest))
    throw new Error("the observer protocol changed after timing began");
  if (previous.length === 0 && event.milestone !== "install-started")
    throw new Error("start timing at installation; supplied prerequisites belong in the protocol");
  if (
    !["assistance", "failed"].includes(event.milestone) &&
    previous.some((entry) => entry.event.milestone === event.milestone)
  )
    throw new Error("milestone already observed; do not replace its time");
  const timestamp = clock.now();
  if (timestamp < (previous.at(-1)?.timestamp ?? timestamp))
    throw new Error("observer clock moved backwards");
  await evidence.record({
    type: "first-run-observation",
    actor: "harness",
    provenance: ["user"],
    payload: JSON.parse(JSON.stringify({ protocol, protocolDigest, event, timestamp })),
  });
  const observations = [...previous, { protocolDigest, event, timestamp }];
  const elapsedMs = timestamp - (observations[0]?.timestamp ?? timestamp);
  const explanation = observations.find(
    (entry) => entry.event.milestone === "explanation-complete",
  )?.event;
  const rubric = explanation?.comprehension;
  const complete = required.every((milestone) =>
    observations.some((entry) => entry.event.milestone === milestone),
  );
  const evidencePresent = observations.some(
    (entry) =>
      entry.event.milestone === "verification-complete" && entry.event.bundleDigest !== undefined,
  );
  const assisted = observations.some((entry) => entry.event.milestone === "assistance");
  const failed = observations.some((entry) => entry.event.milestone === "failed");
  return {
    participant: protocol.participant,
    phase: protocol.phase,
    elapsedMs,
    complete,
    assisted,
    failed,
    passed:
      complete &&
      evidencePresent &&
      elapsedMs <= protocol.capMs &&
      !assisted &&
      !failed &&
      rubric !== undefined &&
      Object.values(rubric).every(Boolean),
    observations: observations.length,
    populationClaim: "one participant observation; cohort criterion remains separate",
  };
}
