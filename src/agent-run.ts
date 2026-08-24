import { resolve } from "node:path";
import type { Clock } from "./core/clock.ts";
import { type AgentLoopOutcome, runAgentLoop } from "./core/loop.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { ConversationMessage, ModelClient } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import type { ResolveRequest } from "./gates/auto-resolve.ts";
import type { SingleFileCommand } from "./gates/base-control.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import { type GatesEngineRun, runGatesEngine } from "./gates/engine.ts";
import type { FileSetRegistry } from "./gates/file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./gates/file-set-tool.ts";
import type { DiffBudget } from "./gates/gate-definition.ts";
import { type ConfirmationPrompt, createToolChokepoint } from "./tools/chokepoint.ts";
import { createLedgerChokepointRecorder } from "./tools/chokepoint-record.ts";
import { createClaimTool } from "./tools/claim-tool.ts";
import { createDerivationHeuristic } from "./tools/derivation.ts";
import { createSandbox, defaultShellAllowlist } from "./tools/sandbox.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";

export const systemPrompt = [
  "You are a coding agent working inside one workspace directory.",
  "State a short plan on your first turn, then use the tools to carry it out.",
  "Before you edit anything, call declare_file_set with the files you intend to touch:",
  "a change to a file outside that set fails the file-set gate. If the work turns out to need",
  "another file, call amend_file_set with a reason a reviewer will read.",
  "Read before you edit. Make the smallest change that satisfies the task.",
  "Every tool result ends with an [evidence record sha256:... kind ...] trailer naming the ledger",
  "record it produced and what kind of record it is.",
  "To assert that work is done, call the claim tool with a predicate over such a record, the record",
  'digest, and that record kind: for example predicate "facts.exitCode == 0" with recordKind',
  '"tool-call:shell", citing the record of the test command you ran.',
  "A claim whose kind does not match the record it cites renders UNVERIFIED, so a predicate that",
  "happens to hold against some other record never stands in for the one you are claiming about.",
  "The harness evaluates the predicate and decides the verdict; your prose never counts as a result.",
  "When the work is done, reply with a summary and no tool calls.",
  "Quality gates then run against the workspace. If one fails you will be given its raw output",
  "and asked to fix it. Fixes are measured: removing tests, removing assertions, adding skip",
  "markers, or lowering coverage of the lines you changed gets the attempt rejected outright.",
].join(" ");

export interface AgentTaskOptions {
  readonly task: string;
  readonly workspace: string;
  readonly baseRef: string;
  readonly maxSteps: number;
  /** Auto-resolve retries a blocking gate failure gets. Zero measures and reports. */
  readonly attempts: number;
  /** Already wrapped in whatever recording the caller wants around it. */
  readonly model: ModelClient;
  readonly evidence: EvidenceRecorder;
  readonly fileSet: FileSetRegistry;
  readonly clock: Clock;
  readonly random: RandomSource;
  readonly emit: (event: LoopEvent) => void;
  readonly confirm: ConfirmationPrompt;
  readonly abortSignal: AbortSignal;
  /** Denied to tools along with everything under it, since the session store lives there. */
  readonly homeDir: string;
  /** Earlier turns of the same session, so a follow-up task knows what was already done. */
  readonly history?: readonly ConversationMessage[];
  readonly gateOptions?: GateSetOptions;
  /** Replaces the engine's built-in size budget, from swarm.toml. */
  readonly diffBudget?: DiffBudget;
  readonly singleFileTestCommand?: SingleFileCommand;
}

export interface AgentTaskResult {
  readonly loop: AgentLoopOutcome;
  readonly gates: GatesEngineRun;
  /** The model finished and the gates went green. Not the model's opinion of either. */
  readonly green: boolean;
}

/**
 * One task, start to finish: sandbox, tools, chokepoint, loop, then the gates over what it
 * left behind. Extracted from the CLI so that a parallel worker is this exact path rather
 * than a second copy of it: a worker differs from an ordinary run only in which directory it
 * works in and which chain it writes to.
 */
export async function runAgentTask(options: AgentTaskOptions): Promise<AgentTaskResult> {
  const sandbox = createSandbox({
    workspaceRoot: options.workspace,
    homeDir: options.homeDir,
    shellAllowlist: defaultShellAllowlist,
    // The session store is denied to tools: evidence the subject can reach is not evidence.
    deniedRoots: [resolve(options.homeDir, ".swarm")],
  });

  const definitions = [
    ...createWorkspaceTools(sandbox),
    createClaimTool(options.evidence, options.model.modelId),
    createDeclareFileSetTool(options.fileSet, options.model.modelId),
    createAmendFileSetTool(options.fileSet, options.model.modelId),
  ];

  const toolInvoker = createToolChokepoint({
    definitions,
    sandbox,
    derivation: createDerivationHeuristic(),
    confirm: options.confirm,
    recorder: createLedgerChokepointRecorder(options.evidence),
  });

  await options.evidence.record({
    type: "session-started",
    actor: "harness",
    provenance: ["user"],
    payload: {
      task: options.task,
      workspace: options.workspace,
      modelSpec: options.model.modelId,
      maxSteps: options.maxSteps,
      baseRef: options.baseRef,
      attemptCap: options.attempts,
    },
  });

  const loopDependencies = {
    model: options.model,
    toolInvoker,
    toolSchemas: definitions,
    clock: options.clock,
    random: options.random,
    emit: options.emit,
    budget: {
      maxSteps: options.maxSteps,
      maxTokens: 1_000_000,
      maxWallTimeMs: 30 * 60 * 1000,
    },
    abortSignal: options.abortSignal,
    systemPrompt,
    maxOutputTokens: 8192,
    retryPolicy: { attempts: 3, baseDelayMs: 500, maxJitterRatio: 0.5 },
  };

  const loop = await runAgentLoop(options.task, {
    ...loopDependencies,
    ...(options.history === undefined ? {} : { history: options.history }),
  });

  await options.evidence.record({
    type: "session-stopped",
    actor: "harness",
    // The stop reason is the harness's; the narrative in it came from the model.
    provenance: ["model"],
    payload: {
      stopReason: loop.stopReason,
      steps: loop.steps,
      tokensUsed: loop.tokensUsed,
      // Recorded as what it is: the model's account, never a result.
      completionNarrative: loop.completionClaim,
    },
  });

  // The model has said it is done. Nothing about that is a result yet: the gates run now,
  // and what they measure is what decides the outcome.
  const gates = await runGatesEngine({
    workspaceRoot: options.workspace,
    baseRef: options.baseRef,
    evidence: options.evidence,
    fileSet: options.fileSet,
    clock: options.clock,
    emit: options.emit,
    cap: options.attempts,
    resolve: (request) => resolveWithModel(request, options, loopDependencies),
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    ...(options.diffBudget === undefined ? {} : { budgets: options.diffBudget }),
    ...(options.singleFileTestCommand === undefined
      ? {}
      : { singleFileTestCommand: options.singleFileTestCommand }),
  });

  return {
    loop,
    gates,
    green: loop.stopReason === "completed" && gates.outcome.settled === "green",
  };
}

/**
 * One attempt at fixing what a gate reported. A fresh loop rather than a continued one: the
 * gate output is the whole brief, and starting clean keeps an attempt from inheriting the
 * reasoning that produced the failure.
 */
async function resolveWithModel(
  request: ResolveRequest,
  options: AgentTaskOptions,
  loopDependencies: Parameters<typeof runAgentLoop>[1],
): Promise<void> {
  const brief = [
    `The task was: ${options.task}`,
    "",
    `A quality gate is failing. This is attempt ${request.attempt} of ${request.cap}.`,
    "Fix the cause. Do not weaken the tests: removing a test, removing an assertion, adding a",
    "skip marker, or lowering coverage of the lines you changed will have the attempt rejected",
    "and will still cost you the attempt.",
    "",
    request.gateOutput,
  ].join("\n");

  await runAgentLoop(brief, loopDependencies);
}
