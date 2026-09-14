import { assembleToolset } from "../agent-run.ts";
import type { Clock } from "../core/clock.ts";
import { runAgentLoop } from "../core/loop.ts";
import type { LoopEvent } from "../core/loop-events.ts";
import type { ModelClient } from "../core/model-client.ts";
import type { RandomSource } from "../core/random-source.ts";
import type { StopReason } from "../core/termination.ts";
import {
  freezeGoalContract,
  type GoalContract,
  goalContractSchema,
} from "../evidence/goal-contract.ts";
import type { EvidenceRecorder } from "../evidence/session.ts";
import { defineTool } from "../tools/tool-definition.ts";
import { createWorkspaceTools } from "../tools/workspace-tools.ts";
import { createDeclareTaskGraphTool, type DeclaredGraph } from "./graph-tool.ts";
import type { TaskGraph } from "./task-graph.ts";

export interface PlannerOptions {
  readonly requireGoalChecks?: boolean;
  readonly maxTokens?: number;
  readonly maxWallTimeMs?: number;
  readonly goal: string;
  readonly workspace: string;
  readonly homeDir: string;
  readonly model: ModelClient;
  readonly evidence: EvidenceRecorder;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly emit: (event: LoopEvent) => void;
  readonly maxSteps: number;
  readonly abortSignal: AbortSignal;
}

const plannerPrompt = [
  "Plan a bounded engineering goal for the existing worker loop.",
  "Read the relevant source, tests and manifest before declaring the graph. You cannot edit.",
  "Preserve the user's exact behavioral requirements and existing interfaces. Do not invent",
  "current symbols or replace required return shapes with a different interface.",
  "Prefer ONE worker for a tiny goal or a tightly coupled change across a few small files.",
  "Keep implementation and its maintained tests in the same task and authorized file set.",
  "Use multiple tasks only for substantial work that can progress independently; agent count",
  "is a resource decision, not a target. An API and its trivial wrapper rarely justify separate jobs.",
  "Each task needs an actionable brief, intended source AND test files, and required check identities.",
  "Declare real prerequisites with dependsOn. Unordered file overlap is serialized conservatively.",
  "Call declare_task_graph once with the complete graph, then finish without narrating scheduler work.",
  "The controller checks graph structure and can propose bounded revisions after observed failures.",
  "Only independent final checks of the combined tree establish executable goal requirements.",
  "Neither a valid graph nor model-authored checks guarantee that all user intent was captured.",
].join(" ");

export interface PlannerOutcome {
  readonly goalContract?: GoalContract | null;
  /** Null where the model never declared one. That is not the same as an empty graph. */
  readonly graph: TaskGraph | null;
  /**
   * How the loop ended. A person told only that no graph arrived cannot tell a goal too broad
   * to answer in one from a model that cannot drive the tool at all, and those want different
   * things done about them.
   */
  readonly stopReason: StopReason;
  readonly steps: number;
}

/**
 * Decomposition as an ordinary agent loop with a smaller tool set, not a path of its own.
 *
 * It reads the workspace and cannot change it: only the read-kind tools are offered, so
 * there is no write, no edit, and no shell, and the guard and chokepoint are the same
 * assembly every run uses rather than a second one built here. Its chain is its own, so what
 * it read before deciding is on the record beside what it decided.
 *
 * Null where the model never declared a graph. That is a run that produced nothing, not a
 * run that produced an empty graph, and the caller has to tell those apart.
 */
export async function runPlanner(options: PlannerOptions): Promise<PlannerOutcome> {
  const declared: DeclaredGraph = { graph: null };
  let goalContract: GoalContract | null = null;

  const { definitions, toolInvoker } = assembleToolset({
    workspace: options.workspace,
    homeDir: options.homeDir,
    // A planner is unattended and touches nothing, so a call that wants a human is refused.
    confirm: () => Promise.resolve(false),
    evidence: options.evidence,
    tools: (guard) => [
      ...createWorkspaceTools(guard).filter((tool) => tool.kind === "read"),
      createDeclareTaskGraphTool(declared),
      ...(options.requireGoalChecks !== true
        ? []
        : [
            defineTool({
              name: "declare_goal_contract",
              description:
                "Pin observable requirements and executable acceptance checks before implementation. Checks are candidate instruments authored by this model, never independent ground truth. A requirement without executable coverage remains unjudged. Artifact paths must be new files used only by the verifier.",
              inputSchema: goalContractSchema,
              kind: "evidence",
              pathsFrom: () => [],
              execute(input) {
                if (goalContract !== null)
                  throw new Error(
                    "goal checks already declared; their requirements cannot be overwritten",
                  );
                if (input.goal !== options.goal)
                  throw new Error("the goal contract must retain the supplied goal verbatim");
                goalContract = freezeGoalContract({
                  ...input,
                  checks: input.checks.map((check) => ({
                    ...check,
                    author: "model",
                    exposure: "shared",
                  })),
                }).contract;
                return Promise.resolve({
                  text: "candidate goal checks pinned; the independent verifier will run these on the integrated tree",
                  facts: { requirements: goalContract.requirements.length },
                });
              },
            }),
          ]),
    ],
  });

  await options.evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      task: options.goal,
      workspace: options.workspace,
      modelSpec: options.model.modelId,
      maxSteps: options.maxSteps,
      role: "planner",
    },
  });

  const loop = await runAgentLoop(options.goal, {
    model: options.model,
    toolInvoker,
    toolSchemas: definitions,
    clock: options.clock,
    random: options.random,
    emit: options.emit,
    budget: {
      maxSteps: options.maxSteps,
      maxTokens: options.maxTokens ?? 200_000,
      maxWallTimeMs: options.maxWallTimeMs ?? 10 * 60 * 1000,
    },
    abortSignal: options.abortSignal,
    systemPrompt:
      options.requireGoalChecks === true
        ? `${plannerPrompt} Before finishing, also call declare_goal_contract with the supplied goal verbatim, every observable requirement and executable checks that cover their combined behavior. Author new check artifacts that can run from a fresh checkout. Do not require a reference implementation. Prefer one worker for a tiny or tightly coupled goal. Requirements without executable checks will remain unjudged.`
        : plannerPrompt,
    maxOutputTokens: 8192,
    retryPolicy: { attempts: 3, baseDelayMs: 500, maxJitterRatio: 0.5 },
  });

  await options.evidence.record({
    type: "session-stopped",
    actor: "harness",
    provenance: ["model"],
    payload: {
      stopReason: loop.stopReason,
      steps: loop.steps,
      declaredNodes: declared.graph?.nodes.length ?? 0,
      completionNarrative: loop.completionClaim,
    },
  });

  return {
    graph: declared.graph,
    stopReason: loop.stopReason,
    steps: loop.steps,
    ...(options.requireGoalChecks === true ? { goalContract } : {}),
  };
}
