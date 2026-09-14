import { z } from "zod";
import {
  asJsonValue,
  canonicalJson,
  digestOfJson,
  type JsonValue,
} from "../evidence/canonical-json.ts";
import type { RecordType } from "../evidence/ledger-record.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import type { TaskState } from "./controller-schedule.ts";
import {
  type ControllerGraph,
  checkGraphDigest,
  controllerGraphSchema,
  reviseGraph,
  validateControllerGraph,
} from "./graph-revision.ts";

const count = z.number().int().nonnegative();
const measured = z.number().nonnegative().nullable();
const testMeasures = z.strictObject({ assertions: count, skips: count });
const testFileMeasures = z.strictObject({
  tests: count,
  assertions: count,
  skips: count,
  perTest: z.record(z.string(), testMeasures),
  outsideTests: testMeasures,
  exactSubjects: z.array(z.string()),
  assertionsBySubject: z.record(z.string(), count),
});
export const candidateSchema = z.strictObject({
  workerId: z.string(),
  taskId: z.string(),
  attemptIndex: count,
  task: z.string(),
  branch: z.string(),
  baseCommit: z.string(),
  graphRevision: z.string(),
  green: z.boolean(),
  commit: z.string().nullable(),
  declaredFiles: z.array(z.string()),
  detail: z.string(),
  measures: z.strictObject({
    perTestFile: z.record(z.string(), testFileMeasures),
    perTestFileAtBase: z.record(z.string(), testFileMeasures),
    testsCollected: measured,
    testsSkippedByRunner: measured,
    changedLineCoverage: measured,
    changedLinesCovered: measured,
    changedLinesMeasured: measured,
  }),
  erosions: count,
  changedFiles: count,
  addedLines: count,
  sessionId: z.string(),
  chainHead: z.string(),
});
export type StoredCandidate = z.infer<typeof candidateSchema>;
const dispatchSchema = z.strictObject({
  kind: z.literal("dispatch-intent"),
  taskId: z.string(),
  workerId: z.string(),
  sessionId: z.string(),
  sessionDirectory: z.string().optional(),
  branch: z.string(),
  path: z.string(),
  baseCommit: z.string(),
  graphRevision: z.string(),
  attemptIndex: count,
});
const integrationSchema = z.strictObject({
  kind: z.literal("integration-intent"),
  effectId: z.string(),
  taskId: z.string(),
  workerId: z.string(),
  baseCommit: z.string(),
  graphRevision: z.string(),
  candidateCommit: z.string(),
  branch: z.string(),
});
export const controllerTransitionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("candidate-refused"),
    workerId: z.string(),
    observation: z.string(),
    reason: z.string(),
  }),
  dispatchSchema,
  integrationSchema,
  z.strictObject({ kind: z.literal("task-reopened"), taskId: z.string(), reason: z.string() }),
  z.strictObject({
    kind: z.literal("recovery-commit-intent"),
    workerId: z.string(),
    branch: z.string(),
    baseCommit: z.string(),
  }),
  z.strictObject({
    kind: z.literal("recovery-reset-intent"),
    effectId: z.string(),
    observedCommit: z.string(),
    targetCommit: z.string(),
  }),
  z.strictObject({
    kind: z.literal("recovery-ref-intent"),
    effectId: z.string(),
    commit: z.string(),
  }),
  z.strictObject({
    kind: z.literal("integration-abandoned"),
    effectId: z.string(),
    retainedCommit: z.string().nullable(),
    reason: z.string(),
  }),
  z.strictObject({
    kind: z.literal("integration-resource"),
    phase: z.enum(["create-intent", "created", "cleanup-intent", "removed"]),
    path: z.string(),
    branch: z.string(),
    commit: z.string(),
  }),
  z.strictObject({
    kind: z.literal("coordination-consumed"),
    source: z.string(),
    sourceSession: z.string(),
    sourceSequence: count,
    sourceDigest: z.string(),
    event: z.unknown().transform(asJsonValue),
    disposition: z.enum(["applied", "refused", "observed"]),
    reason: z.string(),
  }),
  z.strictObject({
    kind: z.literal("integration-completed"),
    effectId: z.string(),
    landed: z.boolean(),
    commit: z.string().nullable(),
    observation: z.string(),
  }),
  z.strictObject({ kind: z.literal("task-blocked"), taskId: z.string(), reason: z.string() }),
  z.strictObject({
    kind: z.literal("candidate-stale"),
    workerId: z.string(),
    currentRevision: z.string(),
    reason: z.string(),
  }),
  z.strictObject({
    kind: z.literal("worktree-created"),
    workerId: z.string(),
    path: z.string(),
    branch: z.string(),
    baseCommit: z.string(),
  }),
  z.strictObject({
    kind: z.literal("cleanup-intent"),
    workerId: z.string(),
    path: z.string(),
    branch: z.string(),
  }),
  z.strictObject({
    kind: z.literal("cleanup-completed"),
    workerId: z.string(),
    path: z.string(),
    branch: z.string(),
  }),
  z.strictObject({
    kind: z.literal("dispatch-reconciled"),
    workerId: z.string(),
    disposition: z.enum(["not-started", "candidate-retained"]),
    reason: z.string(),
  }),
]);
export type ControllerTransition = z.infer<typeof controllerTransitionSchema>;
export interface ControllerState {
  graph: ControllerGraph | null;
  readonly graphs: Map<string, ControllerGraph>;
  readonly states: Map<string, TaskState>;
  readonly cleanupIntents: Set<string>;
  readonly dispatches: Map<string, z.infer<typeof dispatchSchema>>;
  readonly candidates: Map<string, StoredCandidate>;
  readonly integrations: Map<string, z.infer<typeof integrationSchema>>;
  readonly completedIntegrations: Set<string>;
  readonly reconciledDispatches: Set<string>;
  readonly cleaned: Set<string>;
  readonly stale: Set<string>;
  readonly accepted: Map<string, { workerId: string; commit: string; graphRevision: string }>;
  resource: Extract<ControllerTransition, { kind: "integration-resource" }> | null;
  head: string | null;
}

/** The board is a projection of validated history; a snapshot cannot override an event. */
export function replayController(
  evidence: Pick<EvidenceRecorder, "records" | "payloads">,
  following?: { type: RecordType; payload: JsonValue },
): ControllerState {
  const state: ControllerState = {
    graph: null,
    graphs: new Map(),
    cleanupIntents: new Set(),
    states: new Map(),
    dispatches: new Map(),
    candidates: new Map(),
    integrations: new Map(),
    completedIntegrations: new Set(),
    reconciledDispatches: new Set(),
    cleaned: new Set(),
    stale: new Set(),
    accepted: new Map(),
    resource: null,
    head: null,
  };
  const integrationOrder = new Map<string, number>();
  const entries = evidence.records().map((record) => ({
    type: record.type,
    actor: record.actor,
    sequence: record.sequence,
    payloadDigest: record.payloadDigest,
    payload: evidence.payloads().get(record.payloadDigest),
  }));
  if (following !== undefined)
    entries.push({
      ...following,
      actor: "harness",
      sequence: (entries.at(-1)?.sequence ?? -1) + 1,
      payloadDigest: digestOfJson(following.payload),
    });
  for (const record of entries) {
    const payload = record.payload;
    if (
      ["controller-graph", "controller-candidate", "controller-transition"].includes(record.type) &&
      record.actor !== "harness"
    )
      throw new Error("controller authority cannot come from a model record");
    if (record.type === "controller-graph") {
      const graph = controllerGraphSchema.parse(payload);
      validateControllerGraph(graph);
      if (!checkGraphDigest(graph))
        throw new Error("controller graph content does not match its revision digest");
      if (state.graph === null) {
        if (graph.parent !== null || graph.ordinal !== 0 || graph.operation !== null)
          throw new Error("controller history lacks its initial graph");
      } else {
        if (graph.operation === null || graph.parent !== state.graph.revision)
          throw new Error("controller graph revision has the wrong parent");
        const expected = reviseGraph(
          state.graph,
          graph.operation,
          state.states,
          graph.reason,
          graph.author,
        );
        if (canonicalJson(asJsonValue(expected)) !== canonicalJson(asJsonValue(graph)))
          throw new Error(
            "controller revision does not preserve the declared policy and obligations",
          );
      }
      for (const id of graph.affected) {
        state.accepted.delete(id);
        if (!["running", "candidate"].includes(state.states.get(id) ?? "pending"))
          state.states.set(id, "pending");
      }
      for (const node of graph.nodes)
        if (!state.states.has(node.id)) state.states.set(node.id, "pending");
      for (const id of graph.retired) state.states.set(id, "blocked");
      state.graph = graph;
      state.graphs.set(graph.revision, graph);
    }
    if (record.type === "controller-candidate") {
      const candidate = candidateSchema.parse(payload);
      const dispatch = state.dispatches.get(candidate.workerId);
      if (
        dispatch === undefined ||
        state.candidates.has(candidate.workerId) ||
        dispatch.taskId !== candidate.taskId ||
        dispatch.baseCommit !== candidate.baseCommit ||
        dispatch.graphRevision !== candidate.graphRevision ||
        dispatch.branch !== candidate.branch ||
        dispatch.sessionId !== candidate.sessionId
      )
        throw new Error(`candidate ${candidate.workerId} has no matching dispatch intent`);
      state.candidates.set(candidate.workerId, candidate);
      if (candidateIsCurrent(state, candidate))
        state.states.set(
          candidate.taskId,
          candidate.green && candidate.commit !== null ? "candidate" : "failed",
        );
    }
    if (record.type !== "controller-transition") continue;
    const event = controllerTransitionSchema.parse(payload);
    if (state.graph === null) throw new Error("controller effect precedes its graph declaration");
    switch (event.kind) {
      case "coordination-consumed":
        break;
      case "recovery-commit-intent":
        if (state.dispatches.get(event.workerId)?.branch !== event.branch)
          throw new Error("recovery commit names an unowned worker branch");
        break;
      case "recovery-reset-intent":
        if (
          state.integrations.get(event.effectId)?.baseCommit !== event.targetCommit ||
          state.completedIntegrations.has(event.effectId)
        )
          throw new Error("recovery reset lacks its unresolved integration and original base");
        break;
      case "recovery-ref-intent":
        if (
          !state.integrations.has(event.effectId) ||
          state.completedIntegrations.has(event.effectId)
        )
          throw new Error("recovery reference lacks its unresolved integration");
        break;
      case "integration-resource": {
        const prior = state.resource;
        if (prior !== null && (prior.path !== event.path || prior.branch !== event.branch))
          throw new Error("integration resource identity changed");
        if (event.phase === "created" && prior?.phase !== "create-intent")
          throw new Error("integration worktree creation lacks prior intent");
        if (event.phase === "removed" && prior?.phase !== "cleanup-intent")
          throw new Error("integration cleanup lacks prior intent");
        state.resource = event;
        break;
      }
      case "integration-abandoned": {
        const intent = state.integrations.get(event.effectId);
        if (intent === undefined || state.completedIntegrations.has(event.effectId))
          throw new Error("abandoned integration lacks an unresolved intent");
        state.completedIntegrations.add(event.effectId);
        state.states.set(intent.taskId, "candidate");
        state.head = intent.baseCommit;
        break;
      }
      case "dispatch-intent": {
        const node = state.graph.nodes.find((node) => node.id === event.taskId);
        if (
          node === undefined ||
          state.dispatches.has(event.workerId) ||
          event.graphRevision !== state.graph.revision ||
          state.states.get(event.taskId) === "accepted" ||
          !node.dependsOn.every((id) => state.states.get(id) === "accepted")
        )
          throw new Error(
            `dispatch ${event.workerId} is duplicated, stale or lacks accepted prerequisites`,
          );
        state.dispatches.set(event.workerId, event);
        state.states.set(event.taskId, "running");
        break;
      }
      case "integration-intent": {
        const candidate = state.candidates.get(event.workerId);
        if (
          candidate === undefined ||
          !candidate.green ||
          candidate.commit !== event.candidateCommit ||
          state.integrations.has(event.effectId) ||
          event.graphRevision !== state.graph.revision ||
          !candidateIsCurrent(state, candidate) ||
          candidate.taskId !== event.taskId ||
          candidate.branch !== event.branch ||
          [...state.integrations.keys()].some((id) => !state.completedIntegrations.has(id)) ||
          state.accepted.has(event.taskId) ||
          state.stale.has(event.workerId)
        )
          throw new Error(`integration ${event.effectId} has no current eligible candidate`);
        if (state.head !== null && state.head !== event.baseCommit)
          throw new Error("integration intent does not name the accepted head");
        state.integrations.set(event.effectId, event);
        integrationOrder.set(event.effectId, record.sequence);
        state.head = event.baseCommit;
        break;
      }
      case "integration-completed": {
        const intent = state.integrations.get(event.effectId);
        const observation = entries.find(
          (entry) =>
            entry.sequence < record.sequence &&
            entry.sequence > (integrationOrder.get(event.effectId) ?? Infinity) &&
            entry.actor === "harness" &&
            entry.type === "merge-attempt" &&
            entry.payloadDigest === event.observation,
        );
        const captured = observation?.payload;
        const merge = z
          .object({ workerId: z.string(), landed: z.boolean(), commit: z.string().nullable() })
          .parse(captured);
        if (
          intent === undefined ||
          state.completedIntegrations.has(event.effectId) ||
          merge.workerId !== intent.workerId ||
          merge.landed !== event.landed ||
          merge.commit !== event.commit
        )
          throw new Error("integration completion does not match its captured merge observation");
        state.completedIntegrations.add(event.effectId);
        if (event.landed) {
          if (event.commit === null || intent.graphRevision !== state.graph.revision)
            throw new Error("an accepted integration is stale or has no commit");
          state.accepted.set(intent.taskId, {
            workerId: intent.workerId,
            commit: event.commit,
            graphRevision: intent.graphRevision,
          });
          state.states.set(intent.taskId, "accepted");
          state.head = event.commit;
        } else state.states.set(intent.taskId, "failed");
        break;
      }
      case "candidate-refused": {
        const candidate = state.candidates.get(event.workerId);
        const observed = entries.find(
          (entry) =>
            entry.sequence < record.sequence &&
            entry.actor === "harness" &&
            entry.type === "goal-candidate-verification" &&
            entry.payloadDigest === event.observation,
        );
        const reading = z
          .object({
            workerId: z.string(),
            verification: z.object({
              verified: z.boolean(),
              checks: z.array(z.object({ status: z.string() })),
            }),
          })
          .parse(observed?.payload);
        if (
          candidate === undefined ||
          reading.workerId !== candidate.workerId ||
          (reading.verification.verified &&
            !reading.verification.checks.some((check) => check.status === "failed")) ||
          state.accepted.has(candidate.taskId)
        )
          throw new Error("candidate refusal lacks its independent failure observation");
        state.states.set(candidate.taskId, "failed");
        break;
      }
      case "candidate-stale": {
        const candidate = state.candidates.get(event.workerId);
        if (candidate === undefined || event.currentRevision !== state.graph.revision)
          throw new Error("stale observation has no candidate or current graph");
        state.stale.add(event.workerId);
        if (!state.accepted.has(candidate.taskId)) state.states.set(candidate.taskId, "pending");
        break;
      }
      case "task-reopened":
        if (!state.states.has(event.taskId) || state.accepted.has(event.taskId))
          throw new Error("reopening cannot duplicate accepted work");
        state.states.set(event.taskId, "pending");
        break;
      case "task-blocked":
        if (!state.states.has(event.taskId) || state.accepted.has(event.taskId))
          throw new Error("blocking observation cannot remove accepted work");
        state.states.set(event.taskId, "blocked");
        break;
      case "dispatch-reconciled":
        if (!state.dispatches.has(event.workerId) || state.reconciledDispatches.has(event.workerId))
          throw new Error("dispatch reconciliation is missing its unique intent");
        state.reconciledDispatches.add(event.workerId);
        if (event.disposition === "not-started") {
          const intent = state.dispatches.get(event.workerId);
          if (intent !== undefined && !state.accepted.has(intent.taskId))
            state.states.set(intent.taskId, "pending");
        }
        break;
      case "worktree-created":
      case "cleanup-intent":
      case "cleanup-completed": {
        const intent = state.dispatches.get(event.workerId);
        if (intent === undefined || intent.path !== event.path || intent.branch !== event.branch)
          throw new Error("worktree observation does not match its owned dispatch");
        if (event.kind === "worktree-created" && event.baseCommit !== intent.baseCommit)
          throw new Error("worktree creation names a different base");
        if (event.kind === "cleanup-intent") state.cleanupIntents.add(event.workerId);
        if (event.kind === "cleanup-completed") {
          if (!state.cleanupIntents.has(event.workerId) || state.cleaned.has(event.workerId))
            throw new Error("cleanup completion lacks a unique prior intent");
          state.cleaned.add(event.workerId);
        }
        break;
      }
    }
  }
  return state;
}

export async function recordTransition(
  evidence: EvidenceRecorder,
  event: ControllerTransition,
): Promise<void> {
  await appendControllerRecord(
    evidence,
    "controller-transition",
    asJsonValue(controllerTransitionSchema.parse(event)),
  );
}

export function candidateIsCurrent(
  state: ControllerState,
  candidate: Pick<StoredCandidate, "graphRevision" | "taskId">,
): boolean {
  const original = state.graphs.get(candidate.graphRevision);
  return (
    original !== undefined &&
    state.graph?.nodes.some((node) => node.id === candidate.taskId) === true &&
    [...state.graphs.values()].every(
      (graph) => graph.ordinal <= original.ordinal || !graph.affected.includes(candidate.taskId),
    )
  );
}

const writers = new WeakMap<EvidenceRecorder, Promise<unknown>>();
/** Serialize validation with append so no concurrent effect can validate against an obsolete board. */
export async function appendControllerRecord(
  evidence: EvidenceRecorder,
  type: RecordType,
  payload: JsonValue,
): Promise<void> {
  const write = (writers.get(evidence) ?? Promise.resolve()).then(async () => {
    replayController(evidence, { type, payload });
    await evidence.record({
      type,
      actor: "harness",
      provenance: ["tool-output"],
      payload,
    });
  });
  writers.set(evidence, write);
  await write;
}

export function candidateRefusal(
  evidence: EvidenceRecorder,
  workerId: string | undefined,
): string | null {
  if (workerId === undefined) return null;
  for (const record of [...evidence.records()].reverse()) {
    if (record.type !== "controller-transition") continue;
    const event = controllerTransitionSchema.parse(evidence.payloads().get(record.payloadDigest));
    if (event.kind === "candidate-refused" && event.workerId === workerId) return event.reason;
  }
  return null;
}
