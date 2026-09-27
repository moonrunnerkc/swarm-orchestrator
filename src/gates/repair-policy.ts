import { z } from "zod";
import { failureSignature } from "./failure-signature.ts";
import type { GateCycle } from "./gate-runner.ts";

export const escalationSettingsSchema = z.strictObject({
  target: z.string().min(1).max(256),
  trigger: z.literal("repeated-failure"),
  maximum: z.literal(1),
  reservedTokens: z.number().int().min(1024),
  reserveMs: z.number().int().min(1000),
});
export type EscalationSettings = z.infer<typeof escalationSettingsSchema>;
export type FailureClass = "setup" | "infrastructure" | "implementation" | "permission" | "unknown";

/** Conservative deterministic classification can stop spending, never turn a check green. */
export function classifyRepair(cycle: GateCycle): {
  kind: FailureClass;
  signature: string;
  remedy: string;
} {
  const failures = cycle.blockingFailures;
  const unavailable = cycle.runs.filter(
    (run) =>
      run.capability === "dynamic" &&
      run.kind === "command" &&
      run.observation.unavailable !== null,
  );
  const signature = failures
    .map((run) => `${run.gateId}:${failureSignature({ ...run.observation, detail: run.detail })}`)
    .sort()
    .join("\n");
  if (failures.some((run) => run.capability === "policy"))
    return {
      kind: "permission",
      signature,
      remedy: "resolve the recorded contract or scope violation before retrying",
    };
  if (
    unavailable.length &&
    !cycle.runs.some((run) => run.capability === "dynamic" && run.status === "passed")
  )
    return {
      kind: "setup",
      signature,
      remedy: unavailable.map((run) => run.observation.unavailable).join("; "),
    };
  if (
    failures.some((run) =>
      /ENOENT|ModuleNotFoundError|Cannot find module|Executable doesn't exist/.test(
        run.observation.stderr,
      ),
    )
  )
    return {
      kind: "setup",
      signature,
      remedy: "install the declared missing tool or browser, then start verification again",
    };
  if (failures.some((run) => /ECONNREFUSED|ENETUNREACH/.test(run.observation.stderr)))
    return {
      kind: "infrastructure",
      signature,
      remedy: "restore the explicitly configured endpoint before retrying",
    };
  return {
    kind: failures.length ? "implementation" : "unknown",
    signature,
    remedy: failures.length
      ? "repair the recorded failing behavior"
      : "supply runnable checks; no implementation failure is established",
  };
}

/** Stable escalation decision; source churn alone never establishes progress. */
export function decideEscalation(input: {
  classification: FailureClass;
  signature: string;
  previousSignature: string | null;
  count: number;
  remainingTokens: number;
  remainingMs: number;
  unknownUsage: boolean;
  settings: EscalationSettings;
}): "escalate" | "continue" | "stop" {
  if (
    input.classification !== "implementation" ||
    input.unknownUsage ||
    input.remainingTokens <= input.settings.reservedTokens ||
    input.remainingMs <= input.settings.reserveMs
  )
    return "stop";
  if (input.previousSignature !== input.signature || !input.signature) return "continue";
  return input.count < input.settings.maximum ? "escalate" : "stop";
}
