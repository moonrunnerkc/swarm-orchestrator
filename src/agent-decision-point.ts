import type { Clock } from "./core/clock.ts";
import type {
  DecisionPoint,
  DecisionPointInput,
  DecisionPointOutcome,
  runAgentLoop,
} from "./core/loop.ts";
import type { LoopEvent, LoopUsage } from "./core/loop-events.ts";
import type { ToolCallOutcome } from "./core/model-client.ts";
import type { ToolInvoker } from "./core/tool-invoker.ts";
import {
  chooseDecision,
  decisionNoticePrefix,
  decisionRule,
  decisionSignals,
  deriveWorkingState,
  describeWorkingState,
  exitCodeOf,
  type Hypothesis,
  predictionHolds,
  type WorkingState,
  type WorkingStateExecution,
} from "./core/working-state.ts";
import { asJsonValue, digestOfBytes } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { diffAgainstBase } from "./gates/scratch-index.ts";
import { parseUnifiedDiff } from "./gates/unified-diff.ts";
import { classifyShellCommand } from "./tools/shell-observation.ts";

/**
 * The adaptive decision point (adaptive-decision-v1): once per loop, at 40 percent of its steps or
 * its wall, whichever comes first, the controller reads the loop's working state and chooses one
 * action. Continuing costs nothing. Retrieving names the loop searched for and did not find is a
 * harness search, with no model call. Otherwise one fresh, read-only diagnosis is asked for a
 * structured answer: the unresolved question, competing explanations with what each predicts of
 * one distinguishing command, the locations to change and an approach.
 *
 * Its answer is a claim. The harness checks what it can: a named location counts only if the
 * harness can read it, through the chokepoint, from the workspace; the distinguishing command runs
 * through the worker's own chokepoint and its result decides which explanations it contradicts.
 * An answer with no readable location, no executed distinction and no approach grounded in a
 * readable file is not actionable, and the loop is told nothing. Nothing here accepts work,
 * changes a check, or widens the contract; the gates judge the tree afterwards exactly as before.
 *
 * Every model call, step and token the diagnosis spends is charged to the loop it serves, and the
 * point does nothing where too little of that loop's allowance remains to act on its answer.
 */

/** Where in a loop's allowance the decision point sits, registered before any live trial. */
export const decisionShare = 0.4;

/** The most a diagnosis may take: steps, and shares of what is left of the loop's allowance. */
const diagnosisMaxSteps = 5;
const diagnosisTokenShare = 0.25;
const diagnosisWallShare = 0.3;
const diagnosisWallCapMs = 150_000;
/** What must remain to the loop after a diagnosis, or it is not asked for. */
const reserveStepsAfter = 3;
const minimumWallMs = 60_000;

const excerptRadius = 10;
const maxLocations = 3;

/**
 * A diagnosis as the harness keeps it. The model's answer is normalized field by field rather
 * than accepted or refused whole: development run 2 refused three answers that each named a real
 * location, for an array where a string was expected, a null, a long approach and one bad escape.
 * Nothing normalized here counts for anything until the harness checks it: a location still has to
 * be readable through the chokepoint and a command still has to run.
 */
export interface Diagnosis {
  readonly question?: string;
  readonly hypotheses?: readonly {
    readonly statement: string;
    readonly predicts?: { readonly exitCode?: number; readonly outputIncludes?: readonly string[] };
  }[];
  readonly test?: { readonly command: string };
  readonly locations?: readonly {
    readonly path: string;
    readonly line: number;
    readonly why?: string;
  }[];
  readonly approach?: string;
  /** One concrete implementation action, carried out only on a reassessment. */
  readonly action?: DiagnosedAction;
}

const cut = (value: unknown, limit: number): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, limit) : undefined;

const objectOf = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The fields of a parsed answer that have the declared shape, with what was dropped named. */
export function normalizeDiagnosis(value: unknown): { diagnosis: Diagnosis; dropped: string[] } {
  const dropped: string[] = [];
  const answer = objectOf(value) ?? {};
  const hypotheses: NonNullable<Diagnosis["hypotheses"]>[number][] = [];
  for (const entry of Array.isArray(answer.hypotheses) ? answer.hypotheses : []) {
    const statement = cut(objectOf(entry)?.statement, 800);
    if (statement === undefined) {
      dropped.push("a hypothesis with no statement");
      continue;
    }
    const predicts = objectOf(objectOf(entry)?.predicts);
    const includes = predicts?.outputIncludes;
    const outputIncludes = (
      typeof includes === "string" ? [includes] : Array.isArray(includes) ? includes : []
    )
      .map((one) => cut(one, 240))
      .filter((one): one is string => one !== undefined);
    const exitCode = Number.isInteger(predicts?.exitCode)
      ? (predicts?.exitCode as number)
      : undefined;
    hypotheses.push({
      statement,
      ...(exitCode === undefined && outputIncludes.length === 0
        ? {}
        : {
            predicts: {
              ...(exitCode === undefined ? {} : { exitCode }),
              ...(outputIncludes.length === 0 ? {} : { outputIncludes }),
            },
          }),
    });
  }
  const locations: NonNullable<Diagnosis["locations"]>[number][] = [];
  for (const entry of Array.isArray(answer.locations) ? answer.locations : []) {
    const path = cut(objectOf(entry)?.path, 300);
    const line = Number(objectOf(entry)?.line);
    if (path === undefined || !Number.isInteger(line) || line < 1) {
      dropped.push("a location without a path and a positive line");
      continue;
    }
    const why = cut(objectOf(entry)?.why, 300);
    locations.push({ path, line, ...(why === undefined ? {} : { why }) });
  }
  // A command is run as written or not at all: one too long to run is dropped, never shortened.
  const rawCommand = typeof answer.test === "string" ? answer.test : objectOf(answer.test)?.command;
  const command =
    typeof rawCommand === "string" && rawCommand.trim().length > 0 && rawCommand.length <= 400
      ? rawCommand.trim()
      : undefined;
  if (rawCommand !== undefined && command === undefined)
    dropped.push("a test command that is empty or longer than 400 characters");
  const question = cut(answer.question, 800);
  const approach = cut(answer.approach, 1500);
  const action = normalizeAction(answer.action);
  if (answer.action !== undefined && answer.action !== null && action === undefined)
    dropped.push("an action that is neither an edit batch nor one shell command");
  return {
    diagnosis: {
      ...(action === undefined ? {} : { action }),
      ...(question === undefined ? {} : { question }),
      ...(hypotheses.length === 0 ? {} : { hypotheses: hypotheses.slice(0, 3) }),
      ...(command === undefined ? {} : { test: { command } }),
      ...(locations.length === 0 ? {} : { locations: locations.slice(0, 4) }),
      ...(approach === undefined ? {} : { approach }),
    },
    dropped,
  };
}

/** The diagnosis's own instruction: a fixed text, so nothing a workspace holds steers it. */
export const diagnosisSystemPrompt = [
  "You are a focused diagnostician helping a coding agent that is part way through a task.",
  "You may read and search the workspace a few times; you cannot edit or run commands.",
  "Answer with one JSON object and nothing else, with these optional fields:",
  '{"question": the one unresolved question that decides what to implement,',
  ' "hypotheses": up to three competing explanations, each {"statement", "predicts": {"exitCode"?, "outputIncludes"?}} saying what the "test" command shows if that explanation is true,',
  ' "test": {"command": one short shell command, run from the workspace root, whose result distinguishes the hypotheses},',
  ' "locations": up to four {"path", "line", "why"} places in the workspace to change or to copy from,',
  ' "approach": a concrete implementation approach naming files and functions,',
  ' "action": where asked for, the one next action: {"tool": "edit", "edits": [{"path", "find", "replace"}]} with exact text from files you read, or {"tool": "shell", "command"}}.',
  "Name only files you have seen. Do not restate the task or give general advice: an answer without a real location, a distinguishing command or a concrete approach is discarded.",
].join(" ");

export interface DecisionPointContext {
  /** Which loop this serves, for the record: the task's first loop or a numbered attempt. */
  readonly loop: string;
  readonly task: string;
  readonly requiredChecks: readonly string[];
  readonly workspace: string;
  readonly baseRef: string;
  readonly budget: { readonly maxSteps: number; readonly maxWallTimeMs: number };
  readonly clock: Clock;
  readonly evidence: EvidenceRecorder;
  /** The worker's own chokepoint, for the harness's retrieval and distinguishing execution. */
  readonly toolInvoker: ToolInvoker;
  readonly shellAllowed: boolean;
  /** Read-only tools behind their own chokepoint, for the diagnosis. */
  readonly readOnly: () => {
    readonly toolInvoker: ToolInvoker;
    readonly definitions: Parameters<typeof runAgentLoop>[1]["toolSchemas"];
  };
  readonly runLoop: typeof runAgentLoop;
  readonly loopDependencies: Parameters<typeof runAgentLoop>[1];
  /** Run-level explanations, shared by every loop of the run so findings survive repairs. */
  readonly hypotheses: Hypothesis[];
  /** The task's own sentences on what to keep and deliver, kept in view in every brief. */
  readonly taskStatements?: readonly string[];
}

const noSpend: LoopUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  cachedInputTokens: null,
};

/** The most interventions a loop gets: the first decision's, and one reassessment of it. */
export const maxInterventionsPerLoop = 2;

/**
 * How many of the worker's steps pass before the point looks at what an intervention led to. Not a
 * trigger: looking is free, and what follows depends on what the worker did in those steps.
 */
export function followUpWindow(maxSteps: number): number {
  return Math.max(3, Math.ceil(maxSteps * 0.1));
}

/** What an intervention was for, so a later look can tell whether it happened. */
interface Intervention {
  readonly kind: "retrieve" | "diagnose" | "reassess";
  readonly step: number;
  /** A change landing on the tree, or the failures open at the time stopping being open. */
  readonly intent: "change-lands" | "failure-resolves";
  readonly generation: number;
  readonly openSubjects: readonly string[];
  readonly readPaths: ReadonlySet<string>;
  readonly executions: number;
  readonly notice: string | null;
  /** Looks taken at it so far. */
  looks: number;
}

/** The points of the loop the context names, built once per loop from that loop's budget. */
export function createDecisionPoint(context: DecisionPointContext): DecisionPoint {
  let calls = 0;
  const callId = (kind: string): string => {
    calls += 1;
    return `harness-decision-${context.loop.replace(/\W+/g, "-")}-${kind}-${calls}`;
  };
  const interventions: Intervention[] = [];
  return {
    atStep: Math.max(1, Math.ceil(context.budget.maxSteps * decisionShare)),
    atElapsedMs: Math.floor(context.budget.maxWallTimeMs * decisionShare),
    decide: (input) => {
      const last = interventions.at(-1);
      return last === undefined
        ? decide(context, input, callId, interventions)
        : followUp(context, input, callId, interventions, last);
    },
  };
}

const workingStateOf = (messages: DecisionPointInput["messages"]): WorkingState =>
  deriveWorkingState(messages, { classifyShell: classifyShellCommand });

function signalsRecord(signals: ReturnType<typeof decisionSignals>) {
  const brief = (one: WorkingStateExecution) => ({
    subject: one.subject,
    exitCode: one.exitCode,
    step: one.step,
    record: one.record,
  });
  return {
    landedEdits: signals.landedEdits,
    failedEdits: signals.failedEdits,
    failingEditedGenerations: signals.failingEditedGenerations,
    openFailures: signals.openFailures.map(brief),
    staleFailures: signals.staleFailures.map(brief),
    latestCheckAtCurrentTree:
      signals.latestCheckAtCurrentTree === null ? null : brief(signals.latestCheckAtCurrentTree),
    missingNames: signals.missingNames,
  };
}

function remainingRecord(input: DecisionPointInput) {
  // Named as budgets are elsewhere on the chain: a field called "tokens" is scrubbed as a credential.
  return {
    maxSteps: input.remaining.steps,
    maxTokens: input.remaining.tokens,
    maxWallTimeMs: input.remaining.wallMs,
  };
}

function interventionFrom(
  kind: Intervention["kind"],
  intent: Intervention["intent"],
  state: WorkingState,
  signals: ReturnType<typeof decisionSignals>,
  step: number,
  notice: string | null,
): Intervention {
  return {
    kind,
    intent,
    step,
    generation: state.generation,
    openSubjects: signals.openFailures.map((one) => one.subject),
    readPaths: new Set(state.reads.map((read) => read.path)),
    executions: state.executions.length,
    notice,
    looks: 0,
  };
}

async function decide(
  context: DecisionPointContext,
  input: DecisionPointInput,
  harnessCallId: (kind: string) => string,
  interventions: Intervention[],
): Promise<DecisionPointOutcome> {
  const startedAt = context.clock.now();
  const state = workingStateOf(input.messages);
  const signals = decisionSignals(state);
  const choice = chooseDecision(signals);
  const candidate = await measureCandidate(context);
  const window = followUpWindow(context.budget.maxSteps);
  const base = {
    rule: decisionRule,
    phase: "decided",
    loop: context.loop,
    step: input.steps,
    remaining: remainingRecord(input),
    signals: signalsRecord(signals),
    chosen: choice.kind,
    chosenBy: choice.rule,
    candidate: { digest: candidate.digest, changedFiles: candidate.changedFiles },
  };

  if (choice.kind === "continue") {
    await record(context, {
      ...base,
      action: "continue",
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }

  if (choice.kind === "retrieve") {
    const found: { name: string; outcome: ToolCallOutcome }[] = [];
    for (const name of signals.missingNames.slice(0, 2))
      found.push({
        name,
        outcome: await context.toolInvoker.invoke({
          callId: harnessCallId("search"),
          toolName: "search",
          input: { pattern: `\\b${name.replace(/[$]/g, "\\$")}\\b`, path: "." },
          provenance: "model",
        }),
      });
    const notice = [
      `${decisionNoticePrefix} Step ${input.steps} of ${context.budget.maxSteps} in this loop (rule ${choice.rule}). Names that look like code were searched for in this loop and appear in nothing it has been shown, so the harness searched the whole workspace for each as a whole word. This is a record, not an instruction or an authorization; the gates still decide acceptance.`,
      ...found.map(
        ({ name, outcome }) =>
          `Search for ${name}${outcome.failed ? " was refused" : ""}:\n${bounded(outcome.output, 2400)}`,
      ),
      describeWorkingState(state, {
        requiredChecks: context.requiredChecks,
        candidate,
        hypotheses: context.hypotheses,
        taskStatements: context.taskStatements,
        remaining: input.remaining,
      }),
    ].join("\n\n");
    interventions.push(
      interventionFrom("retrieve", "change-lands", state, signals, input.steps, notice),
    );
    await record(context, {
      ...base,
      action: "retrieve",
      retrieved: found.map(({ name, outcome }) => ({
        name,
        failed: outcome.failed,
        recordOf: recordOf(outcome.output),
      })),
      notice: digestOfBytes(notice),
      followUpAtStep: input.steps + window,
      spent: spent(context, startedAt, null),
    });
    return { ...nothing(), notice, followUpAtStep: input.steps + window };
  }

  const diagnosed = await diagnose(context, input, state, candidate, harnessCallId, {
    rule: choice.rule,
    alternativePermitted: choice.alternativePermitted,
    focus: null,
  });
  if (diagnosed === "withheld") {
    await record(context, {
      ...base,
      action: "withheld",
      reason: "too little of this loop's allowance remains to diagnose and act on the answer",
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }
  const followUpAtStep =
    diagnosed.notice === null ? undefined : input.steps + diagnosed.charged.steps + window;
  if (diagnosed.notice !== null)
    interventions.push(
      interventionFrom(
        "diagnose",
        choice.rule === "failing-check-at-current-tree" ? "failure-resolves" : "change-lands",
        state,
        signals,
        input.steps,
        diagnosed.notice,
      ),
    );
  await record(context, {
    ...base,
    action: "diagnose",
    alternativePermitted: choice.alternativePermitted,
    diagnosis: diagnosed.account,
    notice: diagnosed.notice === null ? null : digestOfBytes(diagnosed.notice),
    ...(followUpAtStep === undefined ? {} : { followUpAtStep }),
    spent: spent(context, startedAt, diagnosed.charged),
    ...(diagnosed.notice !== null && choice.alternativePermitted && candidate.patch.length > 0
      ? {
          retainedCandidate: { digest: candidate.digest, patch: bounded(candidate.patch, 200_000) },
        }
      : {}),
  });
  return { ...diagnosed.charged, notice: diagnosed.notice, followUpAtStep };
}

/**
 * A later look at the last intervention. If what it was for happened (a change landed; the
 * failures it was about are no longer open on the current tree), the point is done. If the worker
 * is still learning something new (reading files it had not read, running checks), it looks once
 * more. Otherwise the intervention did not lead anywhere, and while the loop's intervention limit
 * and allowance permit, one reassessment asks for a concrete action, which the harness carries out
 * through the worker's own chokepoint, so its permissions, scope and records are the worker's.
 */
async function followUp(
  context: DecisionPointContext,
  input: DecisionPointInput,
  harnessCallId: (kind: string) => string,
  interventions: Intervention[],
  last: Intervention,
): Promise<DecisionPointOutcome> {
  const startedAt = context.clock.now();
  const state = workingStateOf(input.messages);
  const signals = decisionSignals(state);
  last.looks += 1;
  const open = new Set(signals.openFailures.map((one) => one.subject));
  const occurred =
    last.intent === "change-lands"
      ? state.generation > last.generation
      : last.openSubjects.every((subject) => !open.has(subject));
  const newReads = state.reads.filter((read) => !last.readPaths.has(read.path)).length;
  const newExecutions = state.executions.filter((one) => one.step > last.step).length;
  const learning = newReads > 0 || newExecutions > 0;
  const window = followUpWindow(context.budget.maxSteps);
  const base = {
    rule: decisionRule,
    phase: "followed-up",
    loop: context.loop,
    step: input.steps,
    intervention: { kind: last.kind, step: last.step, intent: last.intent, looks: last.looks },
    observed: { occurred, newReads, newExecutions, generation: state.generation },
    remaining: remainingRecord(input),
    signals: signalsRecord(signals),
  };
  if (occurred) {
    await record(context, {
      ...base,
      action: "none",
      reason: "the intervention's intended outcome occurred",
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }
  if (learning && last.looks < 2) {
    await record(context, {
      ...base,
      action: "look-again",
      reason: "the outcome has not occurred, but the worker is reading or running something new",
      notice: null,
      followUpAtStep: input.steps + window,
      spent: spent(context, startedAt, null),
    });
    return { ...nothing(), followUpAtStep: input.steps + window };
  }
  if (interventions.length >= maxInterventionsPerLoop) {
    await record(context, {
      ...base,
      action: "none",
      reason: `this loop has had its ${maxInterventionsPerLoop} interventions`,
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }

  const candidate = await measureCandidate(context);
  const rule = "intervention-without-effect";
  const focus = [
    `The controller intervened at step ${last.step} (${last.kind}) so that ${last.intent === "change-lands" ? "a change would land on the tree" : `the failing check(s) ${last.openSubjects.join(", ")} would be fixed`}. That has not happened: ${input.steps - last.step} worker steps later ${last.intent === "change-lands" ? "no change has landed" : "those checks still fail on the current tree"}${learning ? "" : ", and those steps read nothing new and ran nothing new"}.`,
    `Decide what the worker should do now and give it as one concrete action in the answer's "action" field: either {"tool": "edit", "edits": [{"path", "find", "replace"}, ...]} with exact text from files you have read (several files at once if the change is mechanical), or {"tool": "shell", "command": one command that changes the workspace, such as moving files}. The harness carries out a valid action through the worker's own tools, and the worker sees its result. Every command already runs from the workspace root, ${context.workspace}: use workspace-relative paths and do not cd anywhere. Where a fact is still missing, give the distinguishing command instead; general advice is discarded.`,
  ].join(" ");
  const diagnosed = await diagnose(context, input, state, candidate, harnessCallId, {
    rule,
    alternativePermitted: false,
    focus,
  });
  if (diagnosed === "withheld") {
    await record(context, {
      ...base,
      action: "withheld",
      reason: "too little of this loop's allowance remains to reassess and act on the answer",
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }
  const carried = await carryOut(context, diagnosed.action, harnessCallId);
  const notice =
    carried === null && diagnosed.notice === null
      ? null
      : [
          `${decisionNoticePrefix} Step ${input.steps} of ${context.budget.maxSteps} in this loop (reassessment, rule ${rule}). The intervention at step ${last.step} was meant to ${last.intent === "change-lands" ? "lead to a change" : "lead to the failing checks being fixed"}, and it has not. One more read-only diagnosis was charged to this loop.`,
          ...(carried === null
            ? []
            : [
                carried.outcome.failed
                  ? `The action it named was refused, so nothing changed: ${carried.summary}\n${bounded(carried.outcome.output, 1200)}`
                  : `The harness carried out the action it named through this loop's own tools: ${carried.summary}\n${bounded(carried.outcome.output, 2400)}\nThe change is yours to keep, extend or revert; the gates still decide acceptance, and nothing here relaxes a check or the task's scope.`,
              ]),
          ...(diagnosed.notice === null ? [] : ["", diagnosed.notice]),
        ].join("\n");
  if (notice !== null)
    interventions.push(
      interventionFrom("reassess", last.intent, state, signals, input.steps, notice),
    );
  await record(context, {
    ...base,
    action: "reassess",
    chosenBy: rule,
    diagnosis: diagnosed.account,
    carriedOut:
      carried === null
        ? null
        : {
            tool: carried.tool,
            summary: carried.summary,
            refused: carried.outcome.failed,
            record: recordOf(carried.outcome.output),
          },
    notice: notice === null ? null : digestOfBytes(notice),
    spent: spent(context, startedAt, diagnosed.charged),
  });
  return { ...diagnosed.charged, notice };
}

/** A concrete action a diagnosis named, in the shape the worker's own tools take. */
export type DiagnosedAction =
  | {
      readonly tool: "edit";
      readonly edits: readonly {
        readonly path: string;
        readonly find: string;
        readonly replace: string;
      }[];
    }
  | { readonly tool: "shell"; readonly command: string };

/** The action field of an answer, if it has the declared shape; anything else is dropped. */
export function normalizeAction(value: unknown): DiagnosedAction | undefined {
  const action = objectOf(value);
  if (action === null) return undefined;
  if (action.tool === "shell") {
    const command = typeof action.command === "string" ? action.command.trim() : "";
    return command.length > 0 && command.length <= 2000 ? { tool: "shell", command } : undefined;
  }
  if (action.tool === "edit") {
    const raw = Array.isArray(action.edits) ? action.edits : [action];
    const edits = raw
      .map(objectOf)
      .filter((one): one is Record<string, unknown> => one !== null)
      .filter(
        (one) =>
          typeof one.path === "string" &&
          typeof one.find === "string" &&
          one.find.length > 0 &&
          typeof one.replace === "string",
      )
      .map((one) => ({
        path: one.path as string,
        find: one.find as string,
        replace: one.replace as string,
      }));
    return edits.length > 0 && edits.length <= 50 ? { tool: "edit", edits } : undefined;
  }
  return undefined;
}

/**
 * The action, run as the worker would run it. An edit batch is applied whole or not at all by the
 * edit tool itself, after its files are declared (or the declaration amended) through the same
 * chokepoint, as a worker must before editing: the fresh block's first markdown-it reassessment
 * named a correct batch and the file set refused it, undeclared. A shell command is guarded, and
 * its measured effect is in its result; one that only inspects the workspace is not carried out at
 * all, since it is not an action (another reassessment of that block ran `git diff --stat; ls`).
 */
async function carryOut(
  context: DecisionPointContext,
  action: DiagnosedAction | undefined,
  harnessCallId: (kind: string) => string,
): Promise<{ tool: string; summary: string; outcome: ToolCallOutcome } | null> {
  if (action === undefined) return null;
  if (action.tool === "shell" && !context.shellAllowed) return null;
  if (action.tool === "shell" && classifyShellCommand(action.command).kind === "inspection")
    return {
      tool: "shell",
      summary: `shell ${bounded(action.command, 400)}`,
      outcome: {
        callId: harnessCallId("action-shell"),
        toolName: "shell",
        failed: true,
        output:
          "not carried out: the command only inspects the workspace, and a reassessment's action has to change it",
      },
    };
  if (action.tool === "edit") {
    const files = [...new Set(action.edits.map((one) => one.path))];
    const declared = await context.toolInvoker.invoke({
      callId: harnessCallId("action-declare"),
      toolName: "declare_file_set",
      input: { files },
      provenance: "model",
    });
    if (declared.failed)
      await context.toolInvoker.invoke({
        callId: harnessCallId("action-amend"),
        toolName: "amend_file_set",
        input: {
          files,
          reason:
            "the controller's reassessment carries out an edit of these files, as its record names",
        },
        provenance: "model",
      });
  }
  const invocation =
    action.tool === "edit"
      ? {
          callId: harnessCallId("action-edit"),
          toolName: "edit",
          input: { edits: action.edits },
          provenance: "model" as const,
        }
      : {
          callId: harnessCallId("action-shell"),
          toolName: "shell",
          input: { command: action.command, timeoutMs: 60_000 },
          provenance: "model" as const,
        };
  const outcome = await context.toolInvoker.invoke(invocation);
  const summary =
    action.tool === "edit"
      ? `edit of ${[...new Set(action.edits.map((one) => one.path))].join(", ")} (${action.edits.length} replacement(s))`
      : `shell ${bounded(action.command, 400)}`;
  return { tool: action.tool, summary, outcome };
}

interface Diagnosed {
  readonly notice: string | null;
  readonly charged: Omit<DecisionPointOutcome, "notice">;
  readonly account: Record<string, unknown>;
  readonly action: DiagnosedAction | undefined;
}

/** One bounded read-only diagnosis and what the harness can establish about its answer. */
async function diagnose(
  context: DecisionPointContext,
  input: DecisionPointInput,
  state: WorkingState,
  candidate: Candidate,
  harnessCallId: (kind: string) => string,
  framing: { rule: string; alternativePermitted: boolean; focus: string | null },
): Promise<Diagnosed | "withheld"> {
  const startedAt = context.clock.now();
  // A diagnosis needs room to act on afterwards; with too little left the point says so and
  // the loop goes on as it would have.
  const diagnosisBudget = {
    maxSteps: Math.min(diagnosisMaxSteps, input.remaining.steps - reserveStepsAfter),
    maxTokens: Math.floor(input.remaining.tokens * diagnosisTokenShare),
    maxWallTimeMs: Math.min(
      diagnosisWallCapMs,
      Math.floor(input.remaining.wallMs * diagnosisWallShare),
    ),
  };
  const maxOutput = context.loopDependencies.maxOutputTokens;
  if (
    diagnosisBudget.maxSteps < 2 ||
    diagnosisBudget.maxTokens < 2 * maxOutput ||
    input.remaining.wallMs < minimumWallMs
  )
    return "withheld";

  const readOnly = context.readOnly();
  // Every step but the last may read; the last is an answer with no tool to call. Live acorn run
  // 1 of the development study spent all five steps reading and never answered.
  const toolSteps = diagnosisBudget.maxSteps - 1;
  const brief = diagnosisBrief(context, state, candidate, framing, input, toolSteps);
  const diagnosisDependencies = {
    ...context.loopDependencies,
    toolInvoker: readOnly.toolInvoker,
    toolSchemas: readOnly.definitions,
    systemPrompt: diagnosisSystemPrompt,
    // The diagnosis's own turns are not the worker's plan or its account of finishing.
    emit: (event: LoopEvent) => {
      if (event.type !== "plan" && event.type !== "claim") context.loopDependencies.emit(event);
    },
  };
  const reading = await context.runLoop(brief, {
    ...diagnosisDependencies,
    budget: { ...diagnosisBudget, maxSteps: toolSteps },
  });
  const left = {
    maxSteps: 1,
    maxTokens: Math.max(0, diagnosisBudget.maxTokens - reading.tokensUsed),
    maxWallTimeMs: Math.max(0, diagnosisBudget.maxWallTimeMs - (context.clock.now() - startedAt)),
  };
  const loop =
    reading.stopReason === "max-steps" && left.maxTokens >= maxOutput && left.maxWallTimeMs > 0
      ? joinLoops(
          reading,
          await context.runLoop(answerNowNotice, {
            ...diagnosisDependencies,
            toolSchemas: [],
            history: reading.messages,
            budget: left,
          }),
        )
      : reading;
  const charged = {
    steps: loop.steps,
    tokensUsed: loop.tokensUsed,
    usage: loop.usage,
    callsWithUnknownUsage: loop.callsWithUnknownUsage,
  };
  const parsed = parseDiagnosis(loop.completionClaim);
  const checked = await checkDiagnosis(
    context,
    parsed.diagnosis,
    state,
    candidate,
    input,
    harnessCallId,
  );
  // A command distinguishes hypotheses only where they predict different results of it; where two
  // or more predict the same thing, its result moves none of them.
  const stated = (parsed.diagnosis?.hypotheses ?? [])
    .map((hypothesis) => hypothesis.predicts)
    .filter((predicts) => predicts !== undefined)
    .map((predicts) => JSON.stringify(predicts));
  const distinguishing = stated.length < 2 || new Set(stated).size === stated.length;
  const ids = (parsed.diagnosis?.hypotheses ?? []).map(
    (_, index) => `H${context.hypotheses.length + index + 1}`,
  );
  const proposed: Hypothesis[] = (parsed.diagnosis?.hypotheses ?? []).map((hypothesis, index) => {
    const id = ids[index] ?? `H${index + 1}`;
    if (checked.execution === null || checked.execution.outcome.failed)
      return { id, statement: hypothesis.statement, status: "untested", evidence: null };
    const holds =
      hypothesis.predicts === undefined || !distinguishing
        ? null
        : predictionHolds(hypothesis.predicts, {
            exitCode: checked.execution.exitCode,
            output: checked.execution.outcome.output,
          });
    return {
      id,
      statement: hypothesis.statement,
      status: holds === null ? "proposed" : holds ? "consistent" : "contradicted",
      evidence: {
        call: checked.execution.command,
        exitCode: checked.execution.exitCode,
        record: recordOf(checked.execution.outcome.output),
        tree: candidate.digest,
      },
    };
  });
  context.hypotheses.push(...proposed);

  const actionable =
    checked.locations.length > 0 ||
    (checked.execution !== null && !checked.execution.outcome.failed) ||
    checked.approachGrounded;
  // What the loop has left once the diagnosis is charged, which is what the notice reports.
  const after: DecisionPointInput = {
    ...input,
    remaining: {
      steps: Math.max(0, input.remaining.steps - loop.steps),
      tokens: Math.max(0, input.remaining.tokens - loop.tokensUsed),
      wallMs: Math.max(0, input.remaining.wallMs - (context.clock.now() - startedAt)),
    },
  };
  const notice = actionable
    ? diagnosisNotice(context, after, framing, state, candidate, parsed.diagnosis, checked)
    : null;
  return {
    notice,
    charged,
    action: parsed.diagnosis?.action,
    account: {
      stopReason: loop.stopReason,
      answerDigest: digestOfBytes(loop.completionClaim),
      answer: bounded(loop.completionClaim, 4000),
      parsed: parsed.diagnosis !== null,
      parseError: parsed.error,
      actionable,
      locations: checked.locations.map(({ path, line, recordOf: record }) => ({
        path,
        line,
        record,
      })),
      rejectedLocations: checked.rejectedLocations,
      approachGrounded: checked.approachGrounded,
      execution:
        checked.execution === null
          ? null
          : {
              command: checked.execution.command,
              refused: checked.execution.outcome.failed,
              exitCode: checked.execution.exitCode,
              record: recordOf(checked.execution.outcome.output),
            },
      action: parsed.diagnosis?.action ?? null,
      hypotheses: proposed,
    },
  };
}

interface Candidate {
  readonly digest: string;
  readonly changedFiles: readonly string[];
  readonly patch: string;
}

async function measureCandidate(context: DecisionPointContext): Promise<Candidate> {
  try {
    const patch = await diffAgainstBase({
      workspaceRoot: context.workspace,
      baseRef: context.baseRef,
    });
    return {
      digest: digestOfBytes(patch),
      changedFiles: parseUnifiedDiff(patch).map((file) => file.path),
      patch,
    };
  } catch {
    return { digest: "unmeasured", changedFiles: [], patch: "" };
  }
}

function diagnosisBrief(
  context: DecisionPointContext,
  state: WorkingState,
  candidate: Candidate,
  framing: { readonly rule: string; readonly focus: string | null },
  input: DecisionPointInput,
  toolSteps: number,
): string {
  const focus =
    framing.focus ??
    (framing.rule === "failing-check-at-current-tree"
      ? "The latest execution against the current tree failed. Explain that failure from the code, name where to change it, and say how to tell competing explanations apart if more than one fits."
      : "The agent has not landed an edit yet. Identify what blocks implementation: the exact places to change (and any helper or test example to copy), the approach, and a distinguishing command if competing explanations remain.");
  return [
    focus,
    `You have at most ${toolSteps} reading step(s); your answer comes after them. The files the working state lists as read are known to the agent: read only what your answer needs.`,
    "",
    describeWorkingState(state, {
      task: context.task,
      requiredChecks: context.requiredChecks,
      candidate,
      hypotheses: context.hypotheses,
      remaining: input.remaining,
    }),
  ].join("\n");
}

/** The diagnosis's last turn, given no tools, so what it has read becomes an answer. */
export const answerNowNotice =
  "[harness notice: answer now] Your reading steps are used. Answer now with the one JSON object described above, from what you have read; no more tool calls are available.";

function joinLoops(
  first: Awaited<ReturnType<typeof runAgentLoop>>,
  second: Awaited<ReturnType<typeof runAgentLoop>>,
): Awaited<ReturnType<typeof runAgentLoop>> {
  const add = (a: number | null, b: number | null): number | null =>
    a === null && b === null ? null : (a ?? 0) + (b ?? 0);
  return {
    ...second,
    steps: first.steps + second.steps,
    answeredSteps: first.answeredSteps + second.answeredSteps,
    tokensUsed: first.tokensUsed + second.tokensUsed,
    callsWithUnknownUsage: first.callsWithUnknownUsage + second.callsWithUnknownUsage,
    usage: {
      inputTokens: first.usage.inputTokens + second.usage.inputTokens,
      outputTokens: first.usage.outputTokens + second.usage.outputTokens,
      reasoningTokens: add(first.usage.reasoningTokens, second.usage.reasoningTokens),
      cachedInputTokens: add(first.usage.cachedInputTokens, second.usage.cachedInputTokens),
    },
    plan: first.plan,
  };
}

/**
 * The answer's JSON object, normalized. Where the object does not parse, only path-and-line pairs
 * are recovered from its text, since those are the one claim the harness reads back for itself.
 */
export function parseDiagnosis(answer: string): {
  diagnosis: Diagnosis | null;
  error: string | null;
} {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return { diagnosis: null, error: "no JSON object in the answer" };
  try {
    const { diagnosis, dropped } = normalizeDiagnosis(JSON.parse(answer.slice(start, end + 1)));
    return { diagnosis, error: dropped.length === 0 ? null : `dropped: ${dropped.join("; ")}` };
  } catch (cause) {
    const locations = [
      ...answer.matchAll(/"path"\s*:\s*"([^"\\]{1,300})"\s*,\s*"line"\s*:\s*(\d+)/g),
    ].map((match) => ({ path: match[1] as string, line: Number(match[2]) }));
    return {
      diagnosis: locations.length === 0 ? null : { locations: locations.slice(0, 4) },
      error: `not JSON (${String(cause)}); ${locations.length} location(s) recovered from its text`,
    };
  }
}

interface CheckedDiagnosis {
  readonly locations: readonly {
    readonly path: string;
    readonly line: number;
    readonly why: string;
    readonly excerpt: string;
    readonly recordOf: string | null;
  }[];
  readonly rejectedLocations: readonly {
    readonly path: string;
    readonly line: number;
    readonly reason: string;
  }[];
  readonly execution: {
    readonly command: string;
    readonly outcome: ToolCallOutcome;
    readonly exitCode: number | null;
  } | null;
  readonly approachGrounded: boolean;
}

/** What the harness can establish about an answer, through the worker's chokepoint. */
async function checkDiagnosis(
  context: DecisionPointContext,
  diagnosis: Diagnosis | null,
  state: WorkingState,
  candidate: Candidate,
  input: DecisionPointInput,
  harnessCallId: (kind: string) => string,
): Promise<CheckedDiagnosis> {
  const locations: CheckedDiagnosis["locations"][number][] = [];
  const rejectedLocations: CheckedDiagnosis["rejectedLocations"][number][] = [];
  for (const location of (diagnosis?.locations ?? []).slice(0, maxLocations)) {
    const outcome = await context.toolInvoker.invoke({
      callId: harnessCallId("read"),
      toolName: "read",
      input: {
        path: location.path,
        startLine: Math.max(1, location.line - excerptRadius),
        endLine: location.line + excerptRadius,
      },
      provenance: "model",
    });
    const body = outcome.output.replace(/\n\[evidence record [^\]]*\]$/, "");
    if (outcome.failed || body.trim().length === 0)
      rejectedLocations.push({
        path: location.path,
        line: location.line,
        reason: bounded(body.split("\n")[0] ?? "unreadable", 200),
      });
    else
      locations.push({
        path: location.path,
        line: location.line,
        why: location.why ?? "",
        excerpt: bounded(body, 1600),
        recordOf: recordOf(outcome.output),
      });
  }
  const command = diagnosis?.test?.command;
  const execution =
    command === undefined || !context.shellAllowed || input.remaining.wallMs < minimumWallMs
      ? null
      : await (async () => {
          const outcome = await context.toolInvoker.invoke({
            callId: harnessCallId("shell"),
            toolName: "shell",
            input: { command, timeoutMs: 30_000 },
            provenance: "model",
          });
          return { command, outcome, exitCode: outcome.failed ? null : exitCodeOf(outcome.output) };
        })();
  const known = new Set([
    ...locations.map((location) => location.path),
    ...candidate.changedFiles,
    ...state.reads.map((read) => read.path),
    ...state.edits.map((edit) => edit.path),
  ]);
  // A file named by its path, or by a base name long enough not to be a common word.
  const approach = diagnosis?.approach ?? "";
  const approachGrounded =
    approach.trim().length >= 40 &&
    [...known].some((path) => {
      const name = path.split("/").at(-1) ?? path;
      return approach.includes(path) || (name.length >= 6 && approach.includes(name));
    });
  return { locations, rejectedLocations, execution, approachGrounded };
}

function diagnosisNotice(
  context: DecisionPointContext,
  input: DecisionPointInput,
  choice: { readonly rule: string; readonly alternativePermitted: boolean },
  state: WorkingState,
  candidate: Candidate,
  diagnosis: Diagnosis | null,
  checked: CheckedDiagnosis,
): string {
  const lines = [
    `${decisionNoticePrefix} Step ${input.steps} of ${context.budget.maxSteps} in this loop (rule ${choice.rule}). The controller asked one fresh read-only diagnosis, charged to this loop, while most of its allowance remains. What follows is a record and advice: not an instruction to stop, not an authorization and not a result. The gates still decide acceptance, and nothing here relaxes a check or the task's scope. Where the advice and an observation disagree, the observation stands.`,
    "",
    describeWorkingState(state, {
      requiredChecks: context.requiredChecks,
      candidate,
      hypotheses: context.hypotheses,
      taskStatements: context.taskStatements,
      openQuestion: diagnosis?.question,
      remaining: input.remaining,
    }),
  ];
  if (checked.locations.length > 0) {
    lines.push("", "Locations the diagnosis named, as the harness read them now:");
    for (const location of checked.locations)
      lines.push(
        `${location.path}:${location.line}${location.why === "" ? "" : ` (${location.why})`}`,
        location.excerpt,
      );
  }
  if (diagnosis?.approach !== undefined && diagnosis.approach.trim().length > 0)
    lines.push("", `Approach (model-proposed, unverified): ${diagnosis.approach.trim()}`);
  if (checked.execution !== null)
    lines.push(
      "",
      checked.execution.outcome.failed
        ? `The distinguishing command was refused by the chokepoint: ${bounded(checked.execution.outcome.output, 400)}`
        : `Harness-run distinguishing command on ${candidate.digest}: ${checked.execution.command}\n${bounded(checked.execution.outcome.output, 1600)}`,
    );
  if (choice.alternativePermitted)
    lines.push(
      "",
      `Two edited trees in a row ended with a failing check. A different implementation is admissible; the current candidate ${candidate.digest} is kept on the record as a recoverable patch.`,
    );
  return lines.join("\n");
}

const recordOf = (output: string): string | null =>
  /\[evidence record (sha256:[0-9a-f]{64}) kind [^\]]*\]$/.exec(output)?.[1] ?? null;

function bounded(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n[cut at ${limit} characters]` : text;
}

function nothing(): DecisionPointOutcome {
  return { notice: null, steps: 0, tokensUsed: 0, usage: noSpend, callsWithUnknownUsage: 0 };
}

function spent(
  context: DecisionPointContext,
  startedAt: number,
  charged: { steps: number; tokensUsed: number; callsWithUnknownUsage: number } | null,
) {
  return {
    wallMs: context.clock.now() - startedAt,
    steps: charged?.steps ?? 0,
    tokensUsed: charged?.tokensUsed ?? 0,
    callsWithUnknownUsage: charged?.callsWithUnknownUsage ?? 0,
  };
}

async function record(
  context: DecisionPointContext,
  payload: Record<string, unknown>,
): Promise<void> {
  await context.evidence.record({
    type: "verification-command",
    actor: "harness",
    provenance: ["tool-output", "model"],
    payload: asJsonValue(payload),
  });
}
