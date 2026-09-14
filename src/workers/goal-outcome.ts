import { asJsonValue } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { IndependentVerification } from "../gates/independent-verification.ts";
import type { QueueLanding } from "./merge-queue.ts";
import type { WorkerResult } from "./parallel-run.ts";

export interface ControllerOutcome {
  readonly policy: "controller-outcome-v1";
  readonly status: "accepted" | "integrated" | "blocked" | "cancelled";
  readonly goalAccepted: boolean;
  readonly exitCode: number;
  readonly tree: string;
  readonly tasks: readonly {
    id: string;
    state: "accepted" | "blocked" | "failed" | "cancelled";
    workerId: string | null;
    blocker: string | null;
  }[];
  readonly requirements: readonly { id: string; status: "accepted" | "rejected" | "unjudged" }[];
  readonly regression: "pass" | "fail" | "unmeasured";
  readonly usage: { spent: number; reserved: number; unknownCalls: number; remaining: number };
}

export async function assessController(options: {
  evidence: EvidenceRecorder;
  taskIds: readonly string[];
  workers: readonly WorkerResult[];
  landings: readonly QueueLanding[];
  tree: string;
  goal: GoalContract | null;
  verification: IndependentVerification | null;
  cancelled: boolean;
  usage: ControllerOutcome["usage"];
}): Promise<ControllerOutcome> {
  const tasks = options.taskIds.map((id) => {
    const attempts = options.workers.filter((worker) => worker.taskId === id);
    const accepted = attempts.find((worker) =>
      options.landings.some((landing) => landing.workerId === worker.workerId && landing.landed),
    );
    const latest = attempts.at(-1);
    return {
      id,
      state:
        accepted !== undefined
          ? ("accepted" as const)
          : options.cancelled
            ? ("cancelled" as const)
            : latest === undefined
              ? ("blocked" as const)
              : ("failed" as const),
      workerId: accepted?.workerId ?? latest?.workerId ?? null,
      blocker:
        accepted !== undefined
          ? null
          : ([...options.landings]
              .reverse()
              .find((landing) => landing.workerId === latest?.workerId)?.feedback ??
            latest?.detail ??
            "prerequisites did not land"),
    };
  });
  const requirements = (options.goal?.requirements ?? []).map((requirement) => ({
    id: requirement.id,
    status:
      options.verification?.goalAcceptance?.obligations.find((entry) => entry.id === requirement.id)
        ?.status ?? ("unjudged" as const),
  }));
  const integrated = tasks.length > 0 && tasks.every((task) => task.state === "accepted");
  const goalAccepted =
    integrated &&
    !options.cancelled &&
    options.verification?.verified === true &&
    requirements.length > 0 &&
    requirements.every((requirement) => requirement.status === "accepted");
  const status = options.cancelled
    ? "cancelled"
    : goalAccepted
      ? "accepted"
      : integrated && options.goal === null
        ? "integrated"
        : "blocked";
  const outcome: ControllerOutcome = {
    policy: "controller-outcome-v1",
    status,
    goalAccepted,
    exitCode:
      status === "cancelled" ? 130 : status === "accepted" || status === "integrated" ? 0 : 1,
    tree: options.tree,
    tasks,
    requirements,
    regression: options.verification?.regression ?? "unmeasured",
    usage: options.usage,
  };
  await options.evidence.record({
    type: "controller-assessment",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue(outcome),
  });
  return outcome;
}
