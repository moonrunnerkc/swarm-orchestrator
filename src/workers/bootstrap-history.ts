import type { EvidenceRecorder } from "../evidence/session.ts";
import type { ProcessRunResult } from "../exec/run-process.ts";
import { bootstrapRecordSchema } from "./bootstrap-schema.ts";

export function bootstrapCheckPassed(
  check: "toolchain" | "positive" | "negative",
  observation: ProcessRunResult,
): boolean {
  if (
    observation.cancelled ||
    observation.timedOut ||
    observation.truncated ||
    observation.startFailure !== null
  )
    return false;
  if (check === "toolchain")
    return (
      observation.exitCode === 0 &&
      /^\d+\.\d+\.\d+$/.test(observation.stdout) &&
      Number(observation.stdout.split(".")[0]) >= 24
    );
  return (
    observation.exitCode === (check === "negative" ? 1 : 0) &&
    new RegExp(`^${check === "negative" ? "not ok" : "ok"} 1 - bootstrap-${check}$`, "m").test(
      observation.stdout,
    ) &&
    /^# tests 1$/m.test(observation.stdout) &&
    new RegExp(`^# fail ${check === "negative" ? 1 : 0}$`, "m").test(observation.stdout)
  );
}

export function bootstrapHistory(evidence: EvidenceRecorder) {
  const entries = evidence
    .records()
    .filter((entry) => entry.type === "bootstrap-stage")
    .map((entry) => {
      if (entry.actor !== "harness")
        throw new Error("bootstrap authority was not captured by the harness");
      return {
        payload: bootstrapRecordSchema.parse(evidence.payloads().get(entry.payloadDigest)),
        digest: entry.payloadDigest,
      };
    });
  const launched = new Map<string, "toolchain" | "positive" | "negative">();
  const observed = new Set<string>();
  const passing = new Map<string, string>();
  let declared = false;
  let ready = false;
  for (const entry of entries) {
    const payload = entry.payload;
    if (payload.phase === "intent") {
      if (declared) throw new Error("bootstrap intent was duplicated");
      declared = true;
    } else if (!declared) throw new Error("bootstrap effect has no preceding intent");
    if (payload.phase === "check-intent") {
      if (ready || launched.has(payload.id))
        throw new Error("bootstrap check launch was duplicated or followed completion");
      launched.set(payload.id, payload.check);
    }
    if (payload.phase === "check-observed") {
      const check = launched.get(payload.id);
      if (check === undefined || observed.has(payload.id))
        throw new Error("bootstrap observation lacks its unique launch");
      observed.add(payload.id);
      if (bootstrapCheckPassed(check, payload.observation)) passing.set(entry.digest, check);
    }
    if (payload.phase === "ready") {
      if (
        ready ||
        payload.checks.map((digest) => passing.get(digest)).join(",") !==
          "toolchain,positive,negative"
      )
        throw new Error("bootstrap readiness lacks the required toolchain and controls");
      ready = true;
    }
  }
  return entries;
}
