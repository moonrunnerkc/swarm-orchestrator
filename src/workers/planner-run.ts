import { existsSync } from "node:fs";
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
import {
  describeDeclaredCases,
  describeMissingRelation,
  describeUncoveredSentences,
  type PlannedCheckCall,
  type PlannedChecksDeclaration,
  type PlannedRelationCall,
  plannedCheckInput,
  plannedContract,
  plannedRelationInput,
  withPlannedCheck,
} from "./planned-check-program.ts";
import type { TaskGraph } from "./task-graph.ts";

export interface PlannerOptions {
  readonly requireGoalChecks?: boolean;
  /**
   * The planned-check mode of `--plan-checks`: the planner states requirements and, for each, a
   * program and cases that the harness turns into a behavior check with a base expectation, so it
   * can be admitted by that control before anything is implemented. Where a supplied contract is
   * named, the planner adds to it and cannot change what it already holds.
   */
  readonly plannedChecks?: {
    readonly base?: GoalContract;
    /** The task as the user gave it, which requirements quote; a revision's brief is not. */
    readonly task: string;
    /** What the harness does to a fresh checkout before a check runs, read from the run's settings. */
    readonly preparation: string;
    /**
     * Admission's own base run of the checks pinned so far, offered to the planner as a tool so
     * it sees what each did while it still holds its reasoning. Its answer is recorded output.
     */
    readonly tryOnBase?: (contract: GoalContract) => Promise<string>;
  };
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
  /** What the planner declared in planned-check mode, as it declared it: its quotes live here. */
  readonly plannedDeclaration?: PlannedChecksDeclaration | null;
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
  let plannedDeclaration: PlannedChecksDeclaration | null = null;

  // Nothing has run yet, so a planner that finds a mistake in what it pinned may replace it:
  // refusing that spent two launches' remaining wall on re-declares. The supplied contract is
  // never part of what is replaced.
  const pinPlanned = (input: PlannedCheckCall | PlannedRelationCall) => {
    const task = options.plannedChecks?.task ?? options.goal;
    const replacing = plannedDeclaration?.checks.some((one) => one.id === input.id) ?? false;
    const declaration = withPlannedCheck(plannedDeclaration, input);
    goalContract = plannedContract(task, declaration, options.plannedChecks?.base, {
      root: options.workspace,
      exists: existsSync,
    });
    plannedDeclaration = declaration;
    const pinned = declaration.checks.find((one) => one.id === input.id);
    return {
      text: [
        `check ${input.id} pinned${replacing ? ", replacing the earlier one" : ""}; ${declaration.checks.length} planned check(s) so far (${declaration.checks.map((one) => one.id).join(", ")}), each run once on the unchanged base before implementation.`,
        ...describeDeclaredCases({
          requirements: [],
          checks: pinned === undefined ? [] : [pinned],
        }),
        ...describeUncoveredSentences(task, declaration),
        ...describeMissingRelation(declaration),
        "When every input is what you meant and every behaviour the task states is covered, finish with a one-line summary and no tool calls.",
      ].join("\n"),
      facts: { checks: declaration.checks.length },
    };
  };

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
                  name: "declare_planned_check",
                  description:
                    "Pin one acceptance check, with the requirement it covers; call once per check, and again with the same id to replace that check. program is a short ES module whose default export is called once per case with that case's input value itself (a string input arrives as that string, never as { input, expected }) and returns what the project gives for it; cases are inputs with the expected result (or throws: true). The harness runs the program once per case in a fresh checkout of the unchanged base before anything is implemented, compares each result with the expected one as JSON, and admits a change check only if the base gets at least one case wrong and at least one right (a case the task does not change) whose answer differs from the wrong cases' answers there, since one answer for every case is what a program that never reaches the project gives; a preserve check only if the base gets every case right. A requirement covered by a change check quotes the task's own words in quote.",
                  inputSchema: plannedCheckInput,
                  kind: "evidence",
                  pathsFrom: () => [],
                  execute: (input) => Promise.resolve(pinPlanned(input)),
                }),
            ...(options.plannedChecks === undefined
              ? []
              : [
                  defineTool({
                    name: "declare_planned_relation",
                    description:
                      "Pin one check of a rule the task states as an equivalence: some text must behave like another, such as a character the task says must be treated like one that already works. Give a few ordinary seed inputs, the reference text and the variants. The harness inserts the reference and each variant at every position of every seed, calls the program on each, and compares each variant's result with the reference's at the same position, so you write no expected results and every position is tried, not only the one an example shows. Write a whitespace or invisible text as code points: reference U+0020 with variants [U+0009] checks that a tab behaves like a space. Include at least one seed the unchanged base already handles alike for every variant, as the control that the program observes the project. A change relation is admitted only if the base breaks it for some seed and keeps it for another; a preserve relation only if the base keeps it everywhere. Call again with the same id to replace it.",
                    inputSchema: plannedRelationInput,
                    kind: "evidence",
                    pathsFrom: () => [],
                    execute: (input) => Promise.resolve(pinPlanned(input)),
                  }),
                ]),
            ...(options.plannedChecks?.tryOnBase === undefined
              ? []
              : [
                  defineTool({
                    name: "run_planned_checks_on_base",
                    description:
                      "Run every check pinned so far once on a fresh checkout of the unchanged base, exactly as admission will when you finish, and see what each did there: admitted or dropped, why, and what a dropped one printed. It takes as long as the repository's preparation. Fix what it reports with declare_planned_check or declare_planned_relation (the same id replaces a check) and run it again while time allows.",
                    inputSchema: z.strictObject({}),
                    kind: "evidence",
                    pathsFrom: () => [],
                    async execute() {
                      const tryOnBase = options.plannedChecks?.tryOnBase;
                      if (goalContract === null || tryOnBase === undefined)
                        throw new Error("pin a check with declare_planned_check first");
                      const task = options.plannedChecks?.task ?? options.goal;
                      // Where the planner decides to stop: what its checks did, and what of the
                      // task none of them yet exercises.
                      return {
                        text: [
                          await tryOnBase(goalContract),
                          ...(plannedDeclaration === null
                            ? []
                            : [
                                ...describeUncoveredSentences(task, plannedDeclaration),
                                ...describeMissingRelation(plannedDeclaration),
                              ]),
                          "Before finishing, reread each sentence of the task that states a rule and ask whether a case exercises it where an implementation could get it wrong: the special input at the start or the end, repeated, next to the separators the rule names, or combined with another special input. Add such cases, or a relation where the rule says one text behaves like another (the same id replaces a check), and run this again, or finish.",
                        ].join("\n"),
                        facts: {},
                      };
                    },
                  }),
                ]),
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
        ? plannedChecksPrompt(options.plannedChecks)
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
    ...(options.plannedChecks === undefined ? {} : { plannedDeclaration }),
  };
}

/**
 * How planned checks are written. Every rule here is about the shape of a check and where its
 * expected values come from, never about any particular task: the expectations come from the
 * task's own words and the project's documented or tested behaviour, and the mechanics of
 * running and comparing are the harness's, so the planner spends its effort on the task.
 */
function plannedChecksPrompt(options: NonNullable<PlannerOptions["plannedChecks"]>): string {
  const { base } = options;
  return [
    "You write the acceptance checks a coding task is implemented and repaired against, before",
    "any implementation exists. You do not implement the task. Read the relevant source, tests",
    "and manifest with the read-only tools, then call declare_planned_check once for each check",
    "(several calls may go in one turn). Then call run_planned_checks_on_base to see what each",
    "check does on the unchanged base, fix what it reports, and finish with a one-line summary and",
    "no tool calls.",
    "Derive every expected result from the task text and the project's existing documented or",
    "tested behaviour, never from a guess about how the change will be written. Cover each rule",
    "the task states where it is easy to get wrong: its boundaries, the combinations of the",
    "special cases it names (position, repetition, mixing with other inputs), and the ordinary",
    "inputs the task says must keep working. Do not add requirements the task does not state.",
    "Where the task says some text must behave like other text (a character to be treated like one",
    "that already works, one spelling like another), also declare that rule with",
    "declare_planned_relation: the harness tries the reference and each variant at every position",
    "of your seeds, which a list of examples does not.",
    "Each requirement has an id, a description and, when a change check covers it, a quote of",
    "the task's own words that ask for it. Each check names its requirement and its purpose:",
    "change for behaviour the task asks to change, which the unchanged base must get wrong on at",
    "least one case, and preserve for behaviour the task keeps, which the base already gets right",
    "on every case; keep the two kinds in separate checks. A change check also holds at least one",
    "case the task does not change, which the base gets right with an answer unlike the changed",
    "cases' answers there: it shows the program calls the project correctly, which a case the",
    "base answers null, or the same as everything else, cannot show. Its program is an ES module",
    "that imports the project and default-exports a function the harness calls once per case with",
    "that case's input value itself, exactly what you wrote as input (a string stays a string),",
    "never with the case object: write export default function (input) { ... }, not",
    "(case_) => case_.input. It returns a",
    "JSON-compatible value (undefined reads as null); the program runs from the repository root,",
    "so import project files with paths like ./src/... or ./dist/... relative to it. Do not",
    "build, install or print anything in the program: the harness prepares the checkout first.",
    options.preparation,
    "Give each requirement one check of each purpose it needs, holding all of its cases, rather",
    "than a check per case: every declaration costs a turn of the planning allowance.",
    "Each case gives the input and the expected result, or throws: true where the call must",
    "throw. The tool's arguments are JSON, so a line feed inside an input string is written \\n",
    "with one backslash, exactly as in any JSON string; \\\\n would be a backslash followed by n.",
    "The tool's answer shows every input as it was read and lists the task's sentences no",
    "requirement quotes yet. In why, say how the expected results follow from the task.",
    ...(base === undefined
      ? []
      : [
          `The contract already holds requirements ${base.requirements.map((one) => one.id).join(", ")}`,
          `and checks ${base.checks.map((one) => one.id).join(", ") || "(none)"}; they stay as they`,
          "are. Declare only what you add, with new ids.",
        ]),
  ].join(" ");
}
