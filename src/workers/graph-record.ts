import { z } from "zod";
import type { ClaimEvaluation } from "../evidence/claim.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { overlapsIn, type TaskGraph } from "./task-graph.ts";

export class TaskGraphAlreadyDeclaredError extends Error {
  constructor() {
    super(
      "a task graph was already declared for this run. A graph is declared once, before any " +
        "node starts; widening it after the fact would describe what happened rather than " +
        "what was intended. Start another run.",
    );
    this.name = "TaskGraphAlreadyDeclaredError";
  }
}

const taskGraphSchema = z.object({
  goal: z.string().min(1),
  /** Where the decomposition came from: a model asked to make one, or a person's file. */
  source: z.enum(["goal", "file"]),
  nodeCount: z.number().int().positive(),
  nodes: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      instruction: z.string().min(1),
      files: z.array(z.string().min(1)),
      dependsOn: z.array(z.string().min(1)),
      acceptance: z.array(z.string().min(1)),
    }),
  ),
  /** True where no two nodes the graph leaves unordered intend the same file. */
  parallelSafe: z.boolean(),
  overlaps: z.array(
    z.object({ nodes: z.tuple([z.string(), z.string()]), files: z.array(z.string()) }),
  ),
});

const taskGraphOutcomeSchema = z.object({
  goal: z.string().min(1),
  /** How many declared nodes this record accounts for. Not how many the graph declared. */
  nodes: z.number().int().nonnegative(),
  landed: z.number().int().nonnegative(),
  blocked: z.array(z.string()),
  perNode: z.array(
    z.object({
      id: z.string().min(1),
      workerId: z.string().nullable(),
      landed: z.boolean(),
      commit: z.string().nullable(),
      blocked: z.boolean(),
    }),
  ),
});

export interface NodeOutcome {
  readonly id: string;
  readonly workerId: string | null;
  readonly landed: boolean;
  readonly commit: string | null;
  readonly blocked: boolean;
}

export interface RecordedGraph {
  readonly digest: string;
}

/**
 * The decomposition, on the chain before any node starts. That ordering is what makes it a
 * declaration rather than a description, and it holds by construction here rather than by a
 * second walk of the ledger: the coordinator writes this before it fans anything out, and
 * invariant 12's existing walker is the one implementation of that idea.
 *
 * What is recorded includes the overlaps the scheduler will serialize. An overlap is not an
 * error, but a graph that claimed to be parallel and was quietly run in series would be
 * describing itself wrongly.
 */
export async function declareTaskGraph(
  evidence: EvidenceRecorder,
  graph: TaskGraph,
  source: "goal" | "file",
): Promise<RecordedGraph> {
  if (evidence.records().some((record) => record.type === "task-graph")) {
    throw new TaskGraphAlreadyDeclaredError();
  }

  const overlaps = overlapsIn(graph);
  const payload = taskGraphSchema.parse({
    goal: graph.goal,
    source,
    nodeCount: graph.nodes.length,
    nodes: graph.nodes.map((node) => ({ ...node })),
    parallelSafe: overlaps.length === 0,
    overlaps: overlaps.map((overlap) => ({ nodes: [...overlap.nodes], files: [...overlap.files] })),
  });

  const recorded = await evidence.record({
    type: "task-graph",
    actor: "harness",
    // The nodes are the model's, or the person's. Nothing here is measured yet.
    provenance: source === "goal" ? ["model"] : ["user"],
    payload,
  });

  return { digest: recorded.record.payloadDigest };
}

export interface ClaimedOutcome extends RecordedGraph {
  readonly evaluation: ClaimEvaluation;
}

/**
 * What became of the graph, and the one claim about it that can be false.
 *
 * Both literals come from the declaration, never from the outcome: a predicate counting the
 * outcome's own rows would restate them and always hold. So a run that landed three of four
 * nodes, or wrote no outcome row for a node at all, renders UNVERIFIED with the declared
 * count beside what actually happened.
 *
 * It asserts that every declared node ran and landed. It does not assert that the nodes
 * satisfy the goal, and nothing in this tree can: that needs to know what the goal means.
 */
export async function claimGraphOutcome(
  evidence: EvidenceRecorder,
  graph: TaskGraph,
  outcomes: readonly NodeOutcome[],
): Promise<ClaimedOutcome> {
  const payload = taskGraphOutcomeSchema.parse({
    goal: graph.goal,
    nodes: outcomes.length,
    landed: outcomes.filter((outcome) => outcome.landed).length,
    blocked: outcomes.filter((outcome) => outcome.blocked).map((outcome) => outcome.id),
    perNode: outcomes.map((outcome) => ({ ...outcome })),
  });

  const recorded = await evidence.record({
    type: "task-graph-outcome",
    actor: "harness",
    provenance: ["tool-output"],
    payload,
  });

  const declared = graph.nodes.length;
  const evaluation = await evidence.submitClaim(
    {
      predicate: `nodes == ${declared} && landed == ${declared}`,
      record: recorded.record.payloadDigest,
      recordKind: "task-graph-outcome",
      narrative:
        `The goal was decomposed into ${declared} node(s). Whether they add up to the goal ` +
        "is not checked here and is not checkable by this harness.",
    },
    "harness",
  );

  return { digest: recorded.record.payloadDigest, evaluation };
}
