import { z } from "zod";
import { asJsonValue, canonicalJson } from "../evidence/canonical-json.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { CampaignOutcome } from "./campaign-record.ts";
import type { protocolSchedule } from "./protocol.ts";

/** Reopen only checked events; an unanswered launch remains an effect needing reconciliation. */
export function replayCampaignHistory(
  evidence: EvidenceRecorder,
  digest: string,
  schedule: ReturnType<typeof protocolSchedule>,
  parseOutcome: (input: unknown) => CampaignOutcome,
) {
  const launched = new Set<string>();
  const outcomes = new Map<string, CampaignOutcome>();
  const deferred = new Map<string, string>();
  const envelope = z.object({
    phase: z.string(),
    protocolDigest: z.string(),
    executionId: z.string(),
  });
  for (const record of evidence.records()) {
    if (record.type !== "campaign-observation") continue;
    const payload = evidence.payloads().get(record.payloadDigest);
    const phase = z.object({ phase: z.string() }).parse(payload).phase;
    if (!["launched", "settled", "not-launched"].includes(phase)) continue;
    if (record.actor !== "harness")
      throw new Error("campaign scheduling event lacks harness authority");
    const event = envelope.parse(payload);
    const planned = schedule.find((entry) => entry.executionId === event.executionId);
    if (event.protocolDigest !== digest || planned === undefined)
      throw new Error("campaign event is outside the frozen schedule");
    if (phase === "launched") {
      if (launched.has(event.executionId)) throw new Error("duplicate campaign launch in history");
      const expected = { phase, protocolDigest: digest, ...planned };
      if (canonicalJson(asJsonValue(expected)) !== canonicalJson(payload ?? null))
        throw new Error("campaign launch changed its frozen identity");
      launched.add(event.executionId);
      deferred.delete(event.executionId);
    } else if (phase === "settled") {
      if (!launched.has(event.executionId) || outcomes.has(event.executionId))
        throw new Error("campaign settlement has no unique launch");
      outcomes.set(event.executionId, parseOutcome(payload));
    } else {
      if (launched.has(event.executionId))
        throw new Error("launched work cannot be relabeled not launched");
      deferred.set(
        event.executionId,
        z.object({ reason: z.string().min(1) }).parse(payload).reason,
      );
    }
  }
  return { launched, outcomes, deferred };
}
