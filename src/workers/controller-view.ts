import { freezeGoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { controllerEvents } from "./controller-events.ts";
import { controllerLaunch } from "./controller-launch.ts";
import { replayController } from "./controller-state.ts";
import { type ControllerOutcome, controllerOutcomeSchema } from "./goal-outcome.ts";

export interface ControllerView {
  readonly runId: string;
  readonly repositoryRoot: string | null;
  readonly goal: string;
  readonly activity: string;
  readonly jobs: readonly { id: string; state: string }[];
  readonly requirements: readonly { id: string; status: string }[];
  readonly blockers: readonly string[];
  readonly usage: ControllerOutcome["usage"] | null;
  readonly deadlineAt: number | null;
  readonly branch: string | null;
  readonly commit: string | null;
  readonly outcome: ReturnType<typeof controllerOutcomeSchema.parse> | null;
  readonly record: string | null;
}

/** Progress describes recorded activity; only the controller's assessment supplies a verdict. */
export function projectControllerView(evidence: EvidenceRecorder): ControllerView {
  const launch = controllerLaunch(evidence);
  const board = replayController(evidence);
  const events = controllerEvents(evidence);
  const started = events.find((event) => event.kind === "run-started");
  const recorded = evidence
    .records()
    .filter((entry) => entry.type === "controller-assessment")
    .at(-1);
  if (recorded !== undefined && recorded.actor !== "harness")
    throw new Error("a model cannot author the controller's displayed outcome");
  const newerWork =
    recorded !== undefined &&
    evidence
      .records()
      .some(
        (entry) =>
          entry.sequence > recorded.sequence &&
          [
            "controller-graph",
            "controller-candidate",
            "controller-transition",
            "goal-check",
            "independent-verification",
          ].includes(entry.type),
      );
  const outcome =
    recorded === undefined || newerWork
      ? null
      : controllerOutcomeSchema.parse(evidence.payloads().get(recorded.payloadDigest));
  const declaration = evidence.records().find((entry) => entry.type === "goal-contract");
  if (declaration !== undefined && declaration.actor !== "harness")
    throw new Error("displayed requirements lack harness authorization");
  const declared =
    declaration === undefined ? null : evidence.payloads().get(declaration.payloadDigest);
  const contract =
    declared !== null && typeof declared === "object" && "contract" in declared
      ? freezeGoalContract(declared.contract).contract
      : launch?.suppliedGoal;
  const reservedIds = new Set<string>();
  const settledIds = new Set<string>();
  const pending = new Map<string, { allowance: number; unknown: boolean }>();
  let spent = 0;
  for (const event of events) {
    if (event.kind === "usage-reserved") {
      if (reservedIds.has(event.id)) throw new Error(`duplicate displayed reservation ${event.id}`);
      reservedIds.add(event.id);
      pending.set(event.id, {
        allowance: event.inputAllowance + event.outputAllowance,
        unknown: false,
      });
    }
    if (event.kind === "usage-settled") {
      if (settledIds.has(event.id)) throw new Error(`duplicate displayed settlement ${event.id}`);
      settledIds.add(event.id);
      const held = pending.get(event.id);
      if (held === undefined) throw new Error("displayed usage lacks its reservation");
      if (event.status === "unknown") held.unknown = true;
      else {
        if (event.inputTokens === null || event.outputTokens === null)
          throw new Error("reported display usage is unavailable");
        spent += event.inputTokens + event.outputTokens;
        pending.delete(event.id);
      }
    }
  }
  const reserved = [...pending.values()].reduce((sum, held) => sum + held.allowance, 0);
  const usage =
    outcome?.usage ??
    (started === undefined
      ? null
      : {
          spent,
          reserved,
          unknownCalls: [...pending.values()].filter((held) => held.unknown).length,
          remaining: Math.max(0, started.maxTokens - spent - reserved),
        });
  const jobs =
    board.graph?.nodes.map((node) => ({
      id: node.id,
      state: board.states.get(node.id) ?? "pending",
    })) ?? [];
  const running = jobs.filter((job) => job.state === "running").map((job) => job.id);
  const integrating = [...board.integrations.values()].find(
    (intent) => !board.completedIntegrations.has(intent.effectId),
  );
  const stop = events.filter((event) => event.kind === "stop-requested").at(-1);
  const repair = events
    .filter((event) => event.kind === "goal-repair-exhausted" || event.kind === "repair-exhausted")
    .at(-1);
  return {
    runId: launch?.runId ?? evidence.sessionId,
    repositoryRoot: launch?.repositoryRoot ?? null,
    goal: launch?.goal ?? launch?.tasks.join("; ") ?? "controller run",
    activity:
      outcome?.status ??
      (stop === undefined
        ? integrating !== undefined
          ? `integrating ${integrating.taskId}`
          : running.length > 0
            ? `working: ${running.join(", ")}`
            : board.graph === null
              ? launch?.bootstrap === undefined
                ? "planning"
                : "setup and planning"
              : jobs.every((job) => job.state === "accepted")
                ? "ready for final checks"
                : "waiting for ready work"
        : `stopping: ${stop.reason}`),
    jobs,
    requirements:
      outcome?.requirements ??
      contract?.requirements.map((requirement) => ({
        id: requirement.id,
        status: requirement.checks.length === 0 ? "unjudged" : "pending",
      })) ??
      [],
    blockers:
      outcome === null
        ? repair === undefined
          ? []
          : [repair.reason]
        : [
            ...outcome.tasks.flatMap((task) =>
              task.blocker === null ? [] : [`${task.id}: ${task.blocker}`],
            ),
            ...outcome.requirements
              .filter((requirement) => requirement.status !== "accepted")
              .map((requirement) => `${requirement.id}: ${requirement.status}`),
          ],
    usage,
    deadlineAt: started?.deadlineAt ?? null,
    branch: board.resource?.branch ?? null,
    commit: board.head,
    outcome,
    record: outcome === null ? null : (recorded?.payloadDigest ?? null),
  };
}
