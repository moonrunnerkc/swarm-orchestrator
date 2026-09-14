import { z } from "zod";
import { asJsonValue } from "../evidence/canonical-json.ts";
import type { GoalContract } from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { IndependentVerification } from "../gates/independent-verification.ts";
import { type ControllerState, candidateRefusal } from "./controller-state.ts";
import type { QueueLanding } from "./merge-queue.ts";
import type { WorkerResult } from "./parallel-run.ts";

export interface ControllerOutcome {
  readonly policy: "controller-outcome-v1" | "controller-outcome-v2";
  readonly graphRevision?: string;
  readonly status: "accepted" | "integrated" | "blocked" | "cancelled";
  readonly goalAccepted: boolean;
  readonly exitCode: number;
  readonly tree: string;
  readonly tasks: readonly {
    id: string;
    members?: readonly string[];
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
  board?: ControllerState;
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
    const members = options.board?.graph?.nodes
      .filter((node) => node.obligations.includes(id))
      .map((node) => node.id);
    const attempts = options.workers.filter(
      (worker) => members?.includes(worker.taskId) ?? worker.taskId === id,
    );
    const accepted =
      members === undefined
        ? attempts.find((worker) =>
            options.landings.some(
              (landing) => landing.workerId === worker.workerId && landing.landed,
            ),
          )
        : members.length > 0 && members.every((member) => options.board?.accepted.has(member))
          ? attempts.find(
              (worker) => options.board?.accepted.get(worker.taskId)?.workerId === worker.workerId,
            )
          : undefined;
    const latest = attempts.at(-1);
    return {
      id,
      ...(members === undefined ? {} : { members }),
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
            candidateRefusal(options.evidence, latest?.workerId) ??
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
    policy: options.board === undefined ? "controller-outcome-v1" : "controller-outcome-v2",
    ...(options.board?.graph === null || options.board?.graph === undefined
      ? {}
      : { graphRevision: options.board.graph.revision }),
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
    payload: asJsonValue(controllerOutcomeSchema.parse(outcome)),
  });
  return outcome;
}

export const controllerOutcomeSchema = z
  .strictObject({
    policy: z.enum(["controller-outcome-v1", "controller-outcome-v2"]),
    graphRevision: z.string().optional(),
    status: z.enum(["accepted", "integrated", "blocked", "cancelled"]),
    goalAccepted: z.boolean(),
    exitCode: z.number().int(),
    tree: z.string(),
    tasks: z.array(
      z.strictObject({
        id: z.string(),
        members: z.array(z.string()).optional(),
        state: z.enum(["accepted", "blocked", "failed", "cancelled"]),
        workerId: z.string().nullable(),
        blocker: z.string().nullable(),
      }),
    ),
    requirements: z.array(
      z.strictObject({ id: z.string(), status: z.enum(["accepted", "rejected", "unjudged"]) }),
    ),
    regression: z.enum(["pass", "fail", "unmeasured"]),
    usage: z.strictObject({
      spent: z.number().nonnegative(),
      reserved: z.number().nonnegative(),
      unknownCalls: z.number().int().nonnegative(),
      remaining: z.number().nonnegative(),
    }),
  })
  .refine(
    (outcome) => outcome.policy !== "controller-outcome-v2" || outcome.graphRevision !== undefined,
    "controller outcome v2 requires a graph revision",
  );
