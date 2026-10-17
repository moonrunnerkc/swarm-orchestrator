import { z } from "zod";
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
  /**
   * The planned-check mode of `--plan-checks`: every check the planner authors is a command-line
   * behavior check that says what it should do on the unchanged base, so it can be admitted by
   * that control before anything is implemented. Where a supplied contract is named, the planner
   * adds to it and cannot change what it already holds.
   */
  readonly plannedChecks?: { readonly base?: GoalContract };
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
  /** The model's last words where it finished without declaring: a question, or an account. Unverified. */
  readonly completionClaim: string;
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
    confirm: () => Promise.resolve("no"),
    evidence: options.evidence,
    tools: (guard) => [
      ...createWorkspaceTools(guard).filter((tool) => tool.kind === "read"),
      // A planned-check planner writes checks and nothing else; offered a task graph as well, it
      // read the task as work to do and spent its steps trying to implement it read-only.
      ...(options.plannedChecks === undefined ? [createDeclareTaskGraphTool(declared)] : []),
      ...(options.requireGoalChecks !== true
        ? []
        : [
            options.plannedChecks === undefined
              ? defineTool({
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
                })
              : defineTool({
                  name: "declare_planned_checks",
                  description:
                    "Pin the requirements and command-line behavior checks this task is implemented and repaired against. The goal is the task as given; declare only requirements, checks and any extra immutable paths. Each check is run once on the unchanged base before anything is implemented and admitted only if it does there what its atBase says.",
                  inputSchema: plannedChecksInput,
                  kind: "evidence",
                  pathsFrom: () => [],
                  execute(input) {
                    if (goalContract !== null)
                      throw new Error(
                        "planned checks already declared; their requirements cannot be overwritten",
                      );
                    goalContract = plannedContract(
                      options.goal,
                      input,
                      options.plannedChecks?.base,
                    );
                    return Promise.resolve({
                      text: "planned checks pinned; each now runs once on the unchanged base before implementation",
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

  const brief =
    options.plannedChecks === undefined
      ? options.goal
      : `Write the acceptance checks for this task before anyone implements it. Do not implement it: you can read the repository and cannot change it.\n\nThe task:\n${options.goal}`;
  const loop = await runAgentLoop(brief, {
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
      options.plannedChecks !== undefined
        ? plannedChecksPrompt(options.plannedChecks.base)
        : options.requireGoalChecks === true
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
    completionClaim: loop.completionClaim,
    ...(options.requireGoalChecks === true ? { goalContract } : {}),
  };
}

/**
 * How planned checks are written. Every rule here is about the shape of a check and where its
 * expected values come from, never about any particular task: the expectations come from the
 * task's own words and the project's documented or tested behaviour, each check says what it
 * should do on the unchanged base, and a check is a script the harness runs and compares.
 */
function plannedChecksPrompt(base: GoalContract | undefined): string {
  return [
    "You write the acceptance checks a coding task is implemented and repaired against, before",
    "any implementation exists. You do not implement the task. Read the relevant source, tests",
    "and manifest with the read-only tools, then call declare_planned_checks once with",
    "requirements and executable checks for the task's observable requirements; the goal is the",
    "task as given and is not repeated. Then finish with a one-line summary and no tool calls. These checks are written before any",
    "implementation exists and are what the implementation is repaired against, so derive every",
    "expected value from the task text and the project's existing documented or tested behaviour,",
    "never from a guess about how the change will be written.",
    "Cover each stated rule where it is easy to get wrong: its boundaries, the combinations of the",
    "special cases the task names (position, repetition, mixing with other inputs), and the",
    "ordinary inputs the task says must keep working.",
    "Each check is a command-line behavior check with no artifacts: behavior.argv is node,",
    '--input-type=module, -e and the script itself, run from the repository root (cwd "."),',
    "and command repeats that argv as text. The script imports the project's public entry point",
    "with a path relative to the repository root, computes the results for a fixed list of inputs,",
    "prints them as one JSON line and exits 0; behavior.stdout holds one equals assertion with",
    "the exact expected line and a trailing newline, and behavior.exitCode is 0. If the project's",
    "tests need a build first, run that build at the start of the script with execSync from",
    "node:child_process and stdio ignored. Write inputs with JSON escapes so every character is",
    "exact, and keep each script short.",
    "Set atBase on every check: fails for a check of the requested change,",
    "which the unchanged base must get wrong, and passes for a check of behaviour that must stay,",
    "which the base already gets right. Keep the two kinds in separate checks.",
    "A check whose base result does not match its atBase is dropped before implementation, so do",
    "not put a preserved case in a fails check.",
    ...(base === undefined
      ? []
      : [
          `The contract already holds requirements ${base.requirements.map((one) => one.id).join(", ")}`,
          `and checks ${base.checks.map((one) => one.id).join(", ") || "(none)"}; they stay as they`,
          "are. Declare only what you add, with new ids.",
        ]),
  ].join(" ");
}

/**
 * What a planner declares in planned-check mode: requirements and checks only. The goal and the
 * contract's version are the harness's to fill in; a planner asked to retype a long task text
 * verbatim failed at it more than twenty times and spent its whole step budget doing so.
 */
const plannedChecksInput = z.strictObject({
  requirements: goalContractSchema.shape.requirements,
  checks: goalContractSchema.shape.checks,
  immutablePaths: goalContractSchema.shape.immutablePaths.default([]),
});

/**
 * The planner's additions on top of a supplied contract, or the planner's contract alone. The
 * supplied goal, requirements, checks, preset and immutable paths stand unchanged; what the
 * planner adds must be command-line behavior checks with a declared base expectation, and it
 * cannot author a preset, challenge fixtures or references, which are what admission would trust.
 */
function plannedContract(
  goal: string,
  input: z.infer<typeof plannedChecksInput>,
  base: GoalContract | undefined,
): GoalContract {
  const authored = input.checks.map((check) => ({
    ...check,
    author: "model" as const,
    exposure: "shared" as const,
  }));
  const problems = authored.flatMap((check) => {
    const wrong = [
      check.behavior?.kind === "cli" ? null : "behavior.kind must be cli",
      check.atBase === undefined ? "atBase must be fails or passes" : null,
      check.artifacts.length > 0 ? "artifacts must be empty (put the script inline in argv)" : null,
    ].filter((one): one is string => one !== null);
    return wrong.length === 0 ? [] : [`${check.id}: ${wrong.join(", ")}`];
  });
  if (problems.length > 0)
    throw new Error(
      `every planned check is a command-line behavior check with its script inline in argv, no ` +
        `artifacts, and atBase set; fix these and declare again: ${problems.join("; ")}`,
    );
  const taken = new Set([
    ...(base?.requirements ?? []).map((one) => one.id),
    ...(base?.checks ?? []).map((one) => one.id),
  ]);
  const reused = [...input.requirements, ...authored].filter((one) => taken.has(one.id));
  if (reused.length > 0)
    throw new Error(
      `${reused.map((one) => one.id).join(", ")} already exist in the supplied contract; use new ids`,
    );
  return freezeGoalContract({
    version: 1,
    goal: base?.goal ?? goal,
    ...(base?.preset === undefined ? {} : { preset: base.preset }),
    requirements: [...(base?.requirements ?? []), ...input.requirements],
    checks: [...(base?.checks ?? []), ...authored],
    immutablePaths: [...new Set([...(base?.immutablePaths ?? []), ...input.immutablePaths])],
    ...(base === undefined ? {} : { selection: base.selection }),
    ...(base?.challenges === undefined ? {} : { challenges: base.challenges }),
  }).contract;
}
