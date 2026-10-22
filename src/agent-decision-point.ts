import { z } from "zod";
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
  decisionSignals,
  deriveWorkingState,
  describeWorkingState,
  exitCodeOf,
  type Hypothesis,
  predictionHolds,
  type WorkingState,
} from "./core/working-state.ts";
import { asJsonValue, digestOfBytes } from "./evidence/canonical-json.ts";
import type { EvidenceRecorder } from "./evidence/session.ts";
import { diffAgainstBase } from "./gates/scratch-index.ts";
import { parseUnifiedDiff } from "./gates/unified-diff.ts";

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

const diagnosisSchema = z.object({
  question: z.string().max(800).optional(),
  hypotheses: z
    .array(
      z.object({
        statement: z.string().min(1).max(800),
        predicts: z
          .object({
            exitCode: z.number().int().optional(),
            outputIncludes: z.string().max(240).optional(),
          })
          .optional(),
      }),
    )
    .max(3)
    .optional(),
  test: z.object({ command: z.string().min(1).max(400) }).optional(),
  locations: z
    .array(
      z.object({
        path: z.string().min(1).max(300),
        line: z.number().int().positive(),
        why: z.string().max(300).optional(),
      }),
    )
    .max(4)
    .optional(),
  approach: z.string().max(1500).optional(),
});

export type Diagnosis = z.infer<typeof diagnosisSchema>;

/** The diagnosis's own instruction: a fixed text, so nothing a workspace holds steers it. */
export const diagnosisSystemPrompt = [
  "You are a focused diagnostician helping a coding agent that is part way through a task.",
  "You may read and search the workspace a few times; you cannot edit or run commands.",
  "Answer with one JSON object and nothing else, with these optional fields:",
  '{"question": the one unresolved question that decides what to implement,',
  ' "hypotheses": up to three competing explanations, each {"statement", "predicts": {"exitCode"?, "outputIncludes"?}} saying what the "test" command shows if that explanation is true,',
  ' "test": {"command": one short shell command, run from the workspace root, whose result distinguishes the hypotheses},',
  ' "locations": up to four {"path", "line", "why"} places in the workspace to change or to copy from,',
  ' "approach": a concrete implementation approach naming files and functions}.',
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
}

const noSpend: LoopUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: null,
  cachedInputTokens: null,
};

/** The points of the loop the context names, built once per loop from that loop's budget. */
export function createDecisionPoint(context: DecisionPointContext): DecisionPoint {
  let calls = 0;
  const callId = (kind: string): string => {
    calls += 1;
    return `harness-decision-${context.loop.replace(/\W+/g, "-")}-${kind}-${calls}`;
  };
  return {
    atStep: Math.max(1, Math.ceil(context.budget.maxSteps * decisionShare)),
    atElapsedMs: Math.floor(context.budget.maxWallTimeMs * decisionShare),
    decide: (input) => decide(context, input, callId),
  };
}

async function decide(
  context: DecisionPointContext,
  input: DecisionPointInput,
  harnessCallId: (kind: string) => string,
): Promise<DecisionPointOutcome> {
  const startedAt = context.clock.now();
  const state = deriveWorkingState(input.messages);
  const signals = decisionSignals(state);
  const choice = chooseDecision(signals);
  const candidate = await measureCandidate(context);
  const base = {
    rule: "adaptive-decision-v1",
    loop: context.loop,
    step: input.steps,
    remaining: input.remaining,
    signals: {
      landedEdits: signals.landedEdits,
      failedEdits: signals.failedEdits,
      failingEditedGenerations: signals.failingEditedGenerations,
      latestAtCurrentTree:
        signals.latestAtCurrentTree === null
          ? null
          : {
              call: signals.latestAtCurrentTree.call,
              exitCode: signals.latestAtCurrentTree.exitCode,
              record: signals.latestAtCurrentTree.record,
            },
      missingNames: signals.missingNames,
    },
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
      `${decisionNoticePrefix} Step ${input.steps} of ${context.budget.maxSteps} in this loop (rule ${choice.rule}). Searches in this loop matched nothing for names that look like code, so the harness searched the whole workspace for each as a whole word. This is a record, not an instruction or an authorization; the gates still decide acceptance.`,
      ...found.map(
        ({ name, outcome }) =>
          `Search for ${name}${outcome.failed ? " was refused" : ""}:\n${bounded(outcome.output, 2400)}`,
      ),
      describeWorkingState(state, {
        requiredChecks: context.requiredChecks,
        candidate,
        hypotheses: context.hypotheses,
        remaining: input.remaining,
      }),
    ].join("\n\n");
    await record(context, {
      ...base,
      action: "retrieve",
      retrieved: found.map(({ name, outcome }) => ({
        name,
        failed: outcome.failed,
        recordOf: recordOf(outcome.output),
      })),
      notice: digestOfBytes(notice),
      spent: spent(context, startedAt, null),
    });
    return { ...nothing(), notice };
  }

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
  ) {
    await record(context, {
      ...base,
      action: "withheld",
      reason: "too little of this loop's allowance remains to diagnose and act on the answer",
      diagnosisBudget,
      notice: null,
      spent: spent(context, startedAt, null),
    });
    return nothing();
  }

  const readOnly = context.readOnly();
  const brief = diagnosisBrief(context, state, candidate, choice.rule, input);
  const loop = await context.runLoop(brief, {
    ...context.loopDependencies,
    toolInvoker: readOnly.toolInvoker,
    toolSchemas: readOnly.definitions,
    systemPrompt: diagnosisSystemPrompt,
    budget: diagnosisBudget,
    // The diagnosis's own turns are not the worker's plan or its account of finishing.
    emit: (event: LoopEvent) => {
      if (event.type !== "plan" && event.type !== "claim") context.loopDependencies.emit(event);
    },
  });
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
  const ids = (parsed.diagnosis?.hypotheses ?? []).map(
    (_, index) => `H${context.hypotheses.length + index + 1}`,
  );
  const proposed: Hypothesis[] = (parsed.diagnosis?.hypotheses ?? []).map((hypothesis, index) => {
    const id = ids[index] ?? `H${index + 1}`;
    if (checked.execution === null || checked.execution.outcome.failed)
      return { id, statement: hypothesis.statement, status: "untested", evidence: null };
    const holds =
      hypothesis.predicts === undefined
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
    ? diagnosisNotice(context, after, choice, state, candidate, parsed.diagnosis, checked)
    : null;
  await record(context, {
    ...base,
    action: "diagnose",
    alternativePermitted: choice.alternativePermitted,
    diagnosis: {
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
      hypotheses: proposed,
    },
    notice: notice === null ? null : digestOfBytes(notice),
    spent: spent(context, startedAt, charged),
    ...(notice !== null && choice.alternativePermitted && candidate.patch.length > 0
      ? {
          retainedCandidate: { digest: candidate.digest, patch: bounded(candidate.patch, 200_000) },
        }
      : {}),
  });
  return { ...charged, notice };
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
  rule: string,
  input: DecisionPointInput,
): string {
  const focus =
    rule === "failing-check-at-current-tree"
      ? "The latest execution against the current tree failed. Explain that failure from the code, name where to change it, and say how to tell competing explanations apart if more than one fits."
      : "The agent has not landed an edit yet. Identify what blocks implementation: the exact places to change (and any helper or test example to copy), the approach, and a distinguishing command if competing explanations remain.";
  return [
    focus,
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

function parseDiagnosis(answer: string): { diagnosis: Diagnosis | null; error: string | null } {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return { diagnosis: null, error: "no JSON object in the answer" };
  let value: unknown;
  try {
    value = JSON.parse(answer.slice(start, end + 1));
  } catch (cause) {
    return { diagnosis: null, error: `not JSON: ${String(cause)}` };
  }
  const parsed = diagnosisSchema.safeParse(value);
  return parsed.success
    ? { diagnosis: parsed.data, error: null }
    : { diagnosis: null, error: bounded(parsed.error.message, 600) };
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
  choice: ReturnType<typeof chooseDecision>,
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
