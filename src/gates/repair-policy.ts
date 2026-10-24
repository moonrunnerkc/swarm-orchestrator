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
export type FailureClass =
  | "setup"
  | "infrastructure"
  | "instrument"
  | "held-expectation"
  | "implementation"
  | "permission"
  | "unknown";

/** Conservative deterministic classification can stop spending, never turn a check green. */
export function classifyRepair(cycle: GateCycle): {
  kind: FailureClass;
  signature: string;
  remedy: string;
} {
  const failures = cycle.blockingFailures;
  const unavailable = cycle.runs.filter(
    (run) =>
      run.severity === "blocking" &&
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
  if (unavailable.length)
    return {
      kind: "setup",
      signature,
      remedy: unavailable.map((run) => run.observation.unavailable).join("; "),
    };
  // A package that cannot be found is a missing install. A relative or absolute path that cannot
  // be found is the change's own: nanoid's moved modules left `require('./random')` broken, and
  // reading that as setup stopped the repair that could fix it.
  if (
    failures.some((run) =>
      /setup unavailable:|ENOENT|ModuleNotFoundError|Cannot find module ['"`](?![./\\])|Executable doesn't exist/.test(
        run.observation.stderr,
      ),
    )
  )
    return {
      kind: "setup",
      signature,
      remedy: "install the declared missing tool or browser, then start verification again",
    };
  // A gate says, as a measure, that every failure it reports is held: a generated check whose
  // expectation a repair was told and answered by leaving the code as it was, which is the
  // planner's claim against the implementation's with nothing independent to settle it. Repair
  // stops instead of spending attempts on it. This is a stopping decision, not a finding about
  // the check or the code, so it is not `instrument`, which names a defect in the checking itself.
  // The gate still fails, and says why.
  if (failures.length > 0 && failures.every((run) => run.measures.unrepairable === 1))
    return {
      kind: "held-expectation",
      signature,
      remedy:
        "every failing check is a generated expectation a repair was told and answered by leaving the code as it was; neither it nor the code is shown wrong, so it stays failing and reported and no further change is asked for",
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
