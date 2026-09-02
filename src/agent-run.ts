import { resolve } from "node:path";
import type { Clock } from "./core/clock.ts";
import { type AgentLoopOutcome, runAgentLoop } from "./core/loop.ts";
import type { LoopEvent } from "./core/loop-events.ts";
import type { ConversationMessage, ModelClient, SamplingSettings } from "./core/model-client.ts";
import type { RandomSource } from "./core/random-source.ts";
import type { ToolInvoker } from "./core/tool-invoker.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import type { ResolveRequest } from "./gates/auto-resolve.ts";
import type { SingleFileCommand } from "./gates/base-control.ts";
import type { GateSetOptions } from "./gates/default-gates.ts";
import {
  assembleGateSet,
  defaultDiffBudget,
  type GatesEngineRun,
  runGatesEngine,
  vacuousBlockingBonds,
} from "./gates/engine.ts";
import type { FileSetRegistry } from "./gates/file-set.ts";
import { createAmendFileSetTool, createDeclareFileSetTool } from "./gates/file-set-tool.ts";
import type { DiffBudget } from "./gates/gate-definition.ts";
import { measuredTheChange } from "./gates/gate-runner.ts";
import { describeGateSet, sealGateSet } from "./gates/gate-set-seal.ts";
import { createGitWorkspaceProbe } from "./gates/git-workspace.ts";
import { captureInheritedChanges, type InheritedChanges } from "./gates/inherited-changes.ts";
import { detectProject } from "./gates/project-type.ts";
import { diffAgainstBase } from "./gates/scratch-index.ts";
import { type ConfirmationPrompt, createToolChokepoint } from "./tools/chokepoint.ts";
import { createLedgerChokepointRecorder } from "./tools/chokepoint-record.ts";
import { createClaimTool } from "./tools/claim-tool.ts";
import { createDerivationHeuristic } from "./tools/derivation.ts";
import { createSandbox, defaultShellAllowlist, type Sandbox } from "./tools/sandbox.ts";
import type { ToolDefinition } from "./tools/tool-definition.ts";
import { createWorkspaceTools } from "./tools/workspace-tools.ts";

export const systemPrompt = [
  "You are a coding agent working inside one workspace directory.",
  "State a short plan on your first turn, then use the tools to carry it out.",
  "Before you edit anything, call declare_file_set with the files you intend to touch:",
  "a change to a file outside that set fails the file-set gate. If the work turns out to need",
  "another file, call amend_file_set with a reason a reviewer will read.",
  "Read before you edit. Make the smallest change that satisfies the task.",
  "Leave the work runnable by the project's own test command, and put your tests where that",
  "command looks for them. A change nothing runs over does not pass, however good it looks, so",
  "a run that writes a language the project cannot test has done nothing that counts.",
  "Tests run unattended, with nobody at a keyboard and no input coming. Take input as an",
  "argument and export what you write, so a test can call it with the input it wants; put any",
  "prompting or stdin reading behind the entry-point guard the language uses, so importing the",
  "file runs none of it. A test that reads standard input, waits on a prompt, or starts",
  "something that does not exit cannot finish: nothing will ever answer it, and the runner will",
  "be killed still waiting rather than reporting a failure you can fix.",
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

/**
 * Appended only where a run has peers to read, so the prompt a single agent sees stays the
 * one above, byte for byte. It is a constant on purpose: the only route a peer's words take
 * into this model is a read_trail result, which the chokepoint tags as tool output.
 */
/**
 * What the harness detected the project to be, said before the model guesses.
 *
 * Three runs in a row wrote Python, then Python again, then Go into a workspace whose tests run
 * with `node --test`, each time spending its whole budget on work nothing could execute. The
 * model had no way to know: telling it to work "in the language the project is already in"
 * assumes it worked that out from a manifest it may not have read.
 *
 * A type name and nothing else. The manifest's own text never travels: a command string is
 * workspace content, and content that reaches a system prompt has gone round the provenance
 * tagging every other route into the model passes through. These names come from a closed set
 * the harness chose, so nothing a repository writes can steer what is said here.
 */
export function projectInstruction(types: readonly string[]): string {
  if (types.length === 0) {
    return "";
  }
  const named =
    types.length === 1 ? types[0] : `${types.slice(0, -1).join(", ")} and ${types.at(-1)}`;
  return (
    ` The harness detects this as a ${named} project, so write the change in that language and` +
    " leave its manifest alone: the command that measures you is read from the base commit, and" +
    " editing it changes nothing except which files you are answerable for."
  );
}

const trailInstruction = [
  "",
  "You are one of several workers running at once against separate copies of this workspace.",
  "Call read_trail to see what the others have declared, which gates have failed on them, and",
  "which approaches they have already spent their attempts on. What it returns is their account",
  "of their own runs, not a result about yours, and never a reason to claim anything.",
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
  /**
   * The peer-trail tool, present only on the parallel path. A worker with no peers is
   * offered nothing, so the single-agent tool set is unchanged (phase 6 stays phase 6).
   */
  readonly trail?: ToolDefinition;
  /**
   * Set only where a task is being tried several ways at once, so the attempts can diverge
   * rather than being one answer written down N times. Absent is the ordinary run.
   */
  readonly sampling?: SamplingSettings;
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
/** What a run gives its model, and the one path every call takes to get there. */
export interface AgentToolset {
  readonly definitions: readonly ToolDefinition[];
  readonly toolInvoker: ToolInvoker;
}

export interface ToolsetOptions {
  readonly workspace: string;
  readonly homeDir: string;
  readonly confirm: ConfirmationPrompt;
  readonly evidence: EvidenceRecorder;
  /** Which tools this run offers, given the sandbox they have to be built against. */
  readonly tools: (sandbox: Sandbox) => readonly ToolDefinition[];
}

/**
 * The sandbox and the chokepoint, assembled once for every kind of run there is.
 *
 * A second assembly beside this one is how a run ends up with a different sandbox, a
 * different denylist, or a path around the chokepoint, and invariant 3 says there is one
 * execution path. Runs differ in which tools they are handed, which is the parameter, and in
 * nothing else.
 */
export function assembleToolset(options: ToolsetOptions): AgentToolset {
  const sandbox = createSandbox({
    workspaceRoot: options.workspace,
    homeDir: options.homeDir,
    shellAllowlist: defaultShellAllowlist,
    // The session store is denied to tools: evidence the subject can reach is not evidence.
    deniedRoots: [resolve(options.homeDir, ".swarm")],
  });

  const definitions = options.tools(sandbox);

  return {
    definitions,
    toolInvoker: createToolChokepoint({
      definitions,
      sandbox,
      derivation: createDerivationHeuristic(),
      confirm: options.confirm,
      recorder: createLedgerChokepointRecorder(options.evidence),
    }),
  };
}

export async function runAgentTask(options: AgentTaskOptions): Promise<AgentTaskResult> {
  const { definitions, toolInvoker } = assembleToolset({
    workspace: options.workspace,
    homeDir: options.homeDir,
    confirm: options.confirm,
    evidence: options.evidence,
    tools: (sandbox) => [
      ...createWorkspaceTools(sandbox),
      createClaimTool(options.evidence, options.model.modelId),
      createDeclareFileSetTool(options.fileSet, options.model.modelId),
      createAmendFileSetTool(options.fileSet, options.model.modelId),
      ...(options.trail === undefined ? [] : [options.trail]),
    ],
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

  // Before the loop, because after it there is no telling the run's work from what it found.
  // A git failure is not raised here: the gates raise it properly, with the sentence that says
  // to run inside a repository, and swallowing it there to throw a worse one here helps nobody.
  const inherited = await captureInherited(options);
  const detected = await detectedTypes(options);
  const criteriaSealed = await sealCriteria(options);
  if (inherited.size > 0) {
    await options.evidence.record({
      type: "inherited-changes",
      actor: "harness",
      provenance: ["tool-output"],
      payload: {
        baseRef: options.baseRef,
        files: [...inherited.keys()].sort(),
        note: "already different from the base when the run started, so not attributed to it",
      },
    });
  }

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
    systemPrompt:
      systemPrompt +
      projectInstruction(detected) +
      (options.trail === undefined ? "" : trailInstruction),
    maxOutputTokens: 8192,
    retryPolicy: { attempts: 3, baseDelayMs: 500, maxJitterRatio: 0.5 },
    ...(options.sampling === undefined ? {} : { sampling: options.sampling }),
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
    abortSignal: options.abortSignal,
    inherited,
    criteriaSealed,
    resolve: (request) => resolveWithModel(request, options, loopDependencies),
    ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    ...(options.diffBudget === undefined ? {} : { budgets: options.diffBudget }),
    ...(options.singleFileTestCommand === undefined
      ? {}
      : { singleFileTestCommand: options.singleFileTestCommand }),
  });

  // Said to the screen as well as written down, because a gate strip of passes over a tree
  // nothing touched looks exactly like a gate strip of passes over work.
  options.emit({
    type: "changes",
    changedFiles: gates.outcome.finalCycle.measures.changedFiles ?? 0,
  });

  // What the task did to the tree, as a patch, recorded once the gates have settled so it is
  // the state that was judged. Nothing else in the ledger answers "what did it change to my
  // code?": the file-set record names files, the diff budget counts lines, and the tool calls
  // hold fragments, so a reviewer had to leave the evidence and run git themselves.
  await recordWorkspaceDiff(options);

  return {
    loop,
    gates,
    // The gates decide this, because deciding the outcome is what the gates are for. A run the
    // model stopped short of and the auto-resolve carried to green leaves a tree every gate
    // measured and passed, and reading the model's own stop reason as a second condition let
    // its account of itself overrule that measurement, which is invariant 1 the wrong way
    // round. The one thing the gates cannot speak for is a run somebody cancelled: that is not
    // a verdict on the tree, so it is not green whatever the gates last saw.
    green: wasGreen(loop, gates),
  };
}

/**
 * Whether this run is a result anybody should act on.
 *
 * The gates decide it, because deciding an outcome is what the gates are for: a run the model
 * stopped short of and the auto-resolve carried to green leaves a tree every gate measured and
 * passed, and reading the model's own account of itself as a second condition let it overrule
 * that measurement, which is invariant 1 the wrong way round.
 *
 * Two things the gates cannot speak for. A run somebody cancelled is not a verdict on the tree.
 * And gates over a tree nothing touched pass for the same reason an empty diff has no bugs: a
 * run that died before it wrote anything left every gate trivially satisfied and reported
 * success, which is the reward log's "nothing was done and there is nothing to reward" being
 * told to a person as green. Changing nothing is only a result where the model meant to.
 */
function wasGreen(loop: AgentLoopOutcome, gates: GatesEngineRun): boolean {
  if (gates.outcome.settled !== "green" || loop.stopReason === "interrupted") {
    return false;
  }
  // A blocking pass that could not be made to fail is not a pass. The gates said green over
  // a check that would have said green over anything, and green means the check held.
  if (vacuousBlockingBonds(gates.bonds).length > 0) {
    return false;
  }
  const changed = gates.outcome.finalCycle.measures.changedFiles ?? 0;
  if (changed === 0) {
    return loop.stopReason === "completed";
  }

  // One definition, in the cycle that measured it. This rule lived here and in the resolve
  // loop's own green, and the loop's copy did not have it, so a run that knew it was unmeasured
  // never asked the model to fix it: it reported the failure accurately and did nothing about
  // it, which is not the same as working.
  return measuredTheChange(gates.outcome.finalCycle);
}

/**
 * The criteria, on the chain before the model is asked for anything. Not raised on a
 * workspace the gates cannot read: those raise their own error when they run, with the remedy.
 */
async function sealCriteria(options: AgentTaskOptions): Promise<boolean> {
  let assembled: Awaited<ReturnType<typeof assembleGateSet>>;
  try {
    assembled = await assembleGateSet({
      workspaceRoot: options.workspace,
      baseRef: options.baseRef,
      ...(options.gateOptions === undefined ? {} : { gateOptions: options.gateOptions }),
    });
  } catch {
    return false;
  }
  await sealGateSet(
    options.evidence,
    describeGateSet({
      detection: assembled.detection,
      gates: assembled.gates,
      budgets: options.diffBudget ?? defaultDiffBudget,
      attemptCap: options.attempts,
    }),
  );
  return true;
}

/** From the base commit, for the same reason the gate command is: a run cannot restyle itself. */
async function detectedTypes(options: AgentTaskOptions): Promise<readonly string[]> {
  try {
    const probe = createGitWorkspaceProbe({
      workspaceRoot: options.workspace,
      baseRef: options.baseRef,
    });
    const detection = await detectProject(
      async (manifest) => (await probe.readBase(manifest)) ?? (await probe.readCurrent(manifest)),
    );
    return detection.types;
  } catch {
    return [];
  }
}

async function captureInherited(options: AgentTaskOptions): Promise<InheritedChanges> {
  try {
    return await captureInheritedChanges(
      createGitWorkspaceProbe({ workspaceRoot: options.workspace, baseRef: options.baseRef }),
    );
  } catch {
    return new Map();
  }
}

/** A patch is only worth reading up to a point, past which it is a file to open, not a page to read. */
const diffCharacterCap = 200_000;

async function recordWorkspaceDiff(options: AgentTaskOptions): Promise<void> {
  let patch: string;
  try {
    patch = await diffAgainstBase({
      workspaceRoot: options.workspace,
      baseRef: options.baseRef,
    });
  } catch {
    // A tree the diff cannot be taken from is a fact about the workspace, and one the gates
    // have already reported on. It is not a reason to lose the run's evidence.
    return;
  }

  const truncated = patch.length > diffCharacterCap;
  await options.evidence.record({
    type: "workspace-diff",
    actor: "harness",
    // The patch is the harness's reading of the tree, and the tree is what the model wrote.
    provenance: ["model"],
    payload: {
      baseRef: options.baseRef,
      truncated,
      characters: patch.length,
      patch: truncated ? `${patch.slice(0, diffCharacterCap)}\n... truncated` : patch,
    },
  });
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
