import type { ConversationMessage, ModelToolCall } from "./model-client.ts";

/**
 * A loop's working state, kept short enough to hand to a fresh context and derived from the
 * recorded tool calls and results alone.
 *
 * Both acorn loops of 2026-10-22 (sessions 20261022T083045-433e79 and 20261022T084048-f4121d)
 * reproduced the bug by their middle step and then spent the rest of their forty steps reading:
 * one re-read eleven ranges of the file it had declared after an edit whose find text was not in
 * the file, the other searched three times for a test helper under spellings the file did not
 * use. Nothing in either conversation said, in one place, what had been established, on which
 * tree, and what was still open. The transcript held all of it, spread over forty turns.
 *
 * Every line here is checkable against the ledger: executions carry their command, exit status,
 * a bounded excerpt and the record that holds the whole result, and the workspace generation they
 * ran against. A generation is the number of file edits that had landed before the call, so an
 * observation made before a later edit is named as such rather than presented as current. Shell
 * commands can change files without a recorded edit; the harness says so instead of guessing.
 * Explanations are a separate, explicitly labelled kind: a model proposed them, and only a
 * harness-run execution moves one to consistent or contradicted.
 *
 * Pure text arithmetic over the transcript (invariant 8). No model text is read as a fact here.
 */

export interface WorkingStateExecution {
  /** The assistant turn, counted within the transcript given, that made the call. */
  readonly step: number;
  readonly tool: string;
  readonly call: string;
  /** Read from the tool's own status line; null where the result carries none. */
  readonly exitCode: number | null;
  readonly failed: boolean;
  readonly excerpt: string;
  readonly record: string | null;
  /** File edits that had landed before this call. */
  readonly generation: number;
}

export interface WorkingStateEdit {
  readonly step: number;
  readonly path: string;
  /** The generation this edit started. */
  readonly generation: number;
}

export interface WorkingStateRead {
  readonly path: string;
  /** Line ranges read, in order; null for a whole-file read. */
  readonly ranges: readonly (readonly [number, number] | null)[];
}

export interface WorkingState {
  readonly steps: number;
  readonly generation: number;
  readonly edits: readonly WorkingStateEdit[];
  readonly failedEdits: readonly {
    readonly step: number;
    readonly path: string;
    readonly reason: string;
  }[];
  readonly reads: readonly WorkingStateRead[];
  readonly emptySearches: readonly {
    readonly step: number;
    readonly pattern: string;
    readonly path: string;
  }[];
  readonly executions: readonly WorkingStateExecution[];
  /** Files a declaration named that no landed edit has touched yet. */
  readonly declaredUnedited: readonly string[];
}

/** An explanation a model proposed, and what a harness-run execution has shown about it. */
export interface Hypothesis {
  readonly id: string;
  readonly statement: string;
  readonly status: "proposed" | "consistent" | "contradicted" | "untested";
  /** The execution that decided the status, where one did. */
  readonly evidence: {
    readonly call: string;
    readonly exitCode: number | null;
    readonly record: string | null;
    readonly tree: string;
  } | null;
}

/** What a hypothesis says a distinguishing execution will show if it is true. */
export interface Prediction {
  readonly exitCode?: number | undefined;
  readonly outputIncludes?: string | undefined;
}

/** The first words of the one message a decision point may add to a loop's conversation. */
export const decisionNoticePrefix = "[harness decision point]";

const maxExecutions = 8;
const maxEntries = 16;
const lineChars = 200;
const excerptLines = 6;
const excerptChars = 360;

const evidenceTrailer = /\n\[evidence record (sha256:[0-9a-f]{64}) kind [^\]]*\]$/;

const bounded = (text: string, limit = lineChars): string =>
  text.length > limit ? `${text.slice(0, limit)}...` : text;

function strip(output: string): string {
  return output.replace(evidenceTrailer, "").trim();
}

function field(call: ModelToolCall, name: string): unknown {
  return (call.input as Record<string, unknown> | null)?.[name];
}

function text(call: ModelToolCall, name: string): string | null {
  const value = field(call, name);
  return typeof value === "string" ? value : null;
}

/** The shell tool's own first line, or the bounded view's recorded status. */
export function exitCodeOf(output: string): number | null {
  const body = strip(output);
  const direct = /^exit code: (-?\d+)\s*$/m.exec(body);
  if (direct !== null) return Number(direct[1]);
  const viewed = /recorded status: exit code (-?\d+)/.exec(body);
  return viewed === null ? null : Number(viewed[1]);
}

function excerptOf(output: string): string {
  const lines = strip(output).split("\n");
  const kept = lines.slice(0, excerptLines).join("\n");
  const cut = kept.length > excerptChars ? kept.slice(0, excerptChars) : kept;
  return cut.length < strip(output).length ? `${cut}...` : cut;
}

const executionTools = new Set(["shell", "run_check"]);
const fileWriters = new Set(["write", "edit"]);

export function deriveWorkingState(messages: readonly ConversationMessage[]): WorkingState {
  const calls = new Map<string, { call: ModelToolCall; step: number }>();
  let steps = 0;
  for (const message of messages)
    if (message.role === "assistant") {
      steps += 1;
      for (const call of message.toolCalls) calls.set(call.callId, { call, step: steps });
    }

  let generation = 0;
  const edits: WorkingStateEdit[] = [];
  const failedEdits: { step: number; path: string; reason: string }[] = [];
  const reads = new Map<string, (readonly [number, number] | null)[]>();
  const emptySearches: { step: number; pattern: string; path: string }[] = [];
  const executions: WorkingStateExecution[] = [];
  const declared = new Set<string>();

  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const outcome of message.outcomes) {
      const found = calls.get(outcome.callId);
      if (found === undefined) continue;
      const { call, step } = found;
      const body = strip(outcome.output);
      if (fileWriters.has(call.toolName)) {
        const path = bounded(text(call, "path") ?? JSON.stringify(call.input));
        if (outcome.failed)
          failedEdits.push({ step, path, reason: bounded(body.split("\n")[0] ?? "") });
        else {
          generation += 1;
          edits.push({ step, path, generation });
        }
        continue;
      }
      if (call.toolName === "declare_file_set" || call.toolName === "amend_file_set") {
        const files = field(call, "files");
        if (!outcome.failed && Array.isArray(files))
          for (const file of files) if (typeof file === "string") declared.add(file);
        continue;
      }
      if (outcome.failed) continue;
      if (call.toolName === "read") {
        const path = text(call, "path");
        if (path === null) continue;
        const start = field(call, "startLine");
        const end = field(call, "endLine");
        const range =
          typeof start === "number" || typeof end === "number"
            ? ([
                typeof start === "number" ? start : 1,
                typeof end === "number" ? end : Number.POSITIVE_INFINITY,
              ] as const)
            : null;
        reads.set(path, [...(reads.get(path) ?? []), range]);
      } else if (call.toolName === "search" && body.startsWith("no match for ")) {
        emptySearches.push({
          step,
          pattern: bounded(text(call, "pattern") ?? ""),
          path: text(call, "path") ?? ".",
        });
      } else if (executionTools.has(call.toolName)) {
        executions.push({
          step,
          tool: call.toolName,
          call: bounded(
            call.toolName === "shell"
              ? (text(call, "command") ?? JSON.stringify(call.input))
              : JSON.stringify(call.input),
          ),
          exitCode: exitCodeOf(outcome.output),
          failed: false,
          excerpt: excerptOf(outcome.output),
          record: evidenceTrailer.exec(outcome.output)?.[1] ?? null,
          generation,
        });
      }
    }
  }

  const edited = new Set(edits.map((edit) => edit.path));
  return {
    steps,
    generation,
    edits: edits.slice(-maxEntries),
    failedEdits: failedEdits.slice(-maxEntries),
    reads: [...reads].slice(0, maxEntries).map(([path, ranges]) => ({ path, ranges })),
    emptySearches: emptySearches.slice(-maxEntries),
    executions: executions.slice(-maxExecutions),
    declaredUnedited: [...declared].filter((path) => !edited.has(path)).slice(0, maxEntries),
  };
}

/** The execution facts the decision policy reads, and nothing it would have to interpret. */
export interface DecisionSignals {
  readonly landedEdits: number;
  /** The last execution made against the current generation, if any. */
  readonly latestAtCurrentTree: WorkingStateExecution | null;
  /** Generations, edited ones only, whose last execution exited non-zero. */
  readonly failingEditedGenerations: number;
  readonly failedEdits: number;
  /** Code-like names (camelCase or snake_case) from searches that matched nothing. */
  readonly missingNames: readonly string[];
}

const codeName = /[A-Za-z_$][A-Za-z0-9_$]{3,}/g;

/** camelCase, PascalCase with an inner capital, or a name joined by an underscore. */
function looksLikeCodeName(word: string): boolean {
  return /[a-z][A-Z]/.test(word) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(word);
}

export function decisionSignals(state: WorkingState): DecisionSignals {
  const lastByGeneration = new Map<number, WorkingStateExecution>();
  for (const execution of state.executions) lastByGeneration.set(execution.generation, execution);
  const failingEditedGenerations = [...lastByGeneration].filter(
    ([generation, execution]) =>
      generation > 0 && execution.exitCode !== null && execution.exitCode !== 0,
  ).length;
  const names = new Set<string>();
  for (const search of state.emptySearches)
    for (const word of search.pattern.match(codeName) ?? [])
      if (looksLikeCodeName(word)) names.add(word);
  return {
    landedEdits: state.edits.length,
    latestAtCurrentTree: lastByGeneration.get(state.generation) ?? null,
    failingEditedGenerations,
    failedEdits: state.failedEdits.length,
    missingNames: [...names].slice(0, 3),
  };
}

export type DecisionKind = "continue" | "retrieve" | "diagnose";

export interface DecisionChoice {
  readonly kind: DecisionKind;
  /** Which registered rule chose it, so a record names the rule rather than a judgement. */
  readonly rule: string;
  /** Whether evidence admits advice to pursue a different implementation. */
  readonly alternativePermitted: boolean;
}

/**
 * The registered policy (adaptive-decision-v1). Landed edits whose latest check at the current
 * tree passed, or that no check has run against yet, are work in progress: continue, with no
 * model call. A check at the current tree that fails is an open question about that tree: one
 * diagnosis, and a different implementation is admissible only once two edited trees in a row
 * ended failing. With no landed edit, names searched for and not found are retrieved by the
 * harness when they look like code; otherwise one diagnosis. Reaching the decision point without
 * an edit is not called a stall: the point sits at a fixed share of the allowance, and what it
 * buys is one fresh look while most of the allowance is still there to act on it.
 */
export function chooseDecision(signals: DecisionSignals): DecisionChoice {
  if (signals.landedEdits > 0) {
    const latest = signals.latestAtCurrentTree;
    if (latest === null || latest.exitCode === null || latest.exitCode === 0)
      return {
        kind: "continue",
        rule: "edits-landed-no-failing-check",
        alternativePermitted: false,
      };
    return {
      kind: "diagnose",
      rule: "failing-check-at-current-tree",
      alternativePermitted: signals.failingEditedGenerations >= 2,
    };
  }
  if (signals.missingNames.length > 0)
    return { kind: "retrieve", rule: "no-edit-missing-code-names", alternativePermitted: false };
  return { kind: "diagnose", rule: "no-edit-at-decision-point", alternativePermitted: false };
}

/** Whether an execution's observed result is what a prediction says; null where it says nothing. */
export function predictionHolds(
  prediction: Prediction,
  observed: { readonly exitCode: number | null; readonly output: string },
): boolean | null {
  const checks: boolean[] = [];
  if (prediction.exitCode !== undefined)
    checks.push(observed.exitCode !== null && observed.exitCode === prediction.exitCode);
  if (prediction.outputIncludes !== undefined && prediction.outputIncludes.length > 0)
    checks.push(strip(observed.output).includes(prediction.outputIncludes));
  return checks.length === 0 ? null : checks.every(Boolean);
}

function describeRanges(ranges: WorkingStateRead["ranges"]): string {
  const parts = ranges.map((range) =>
    range === null ? "whole" : `${range[0]}-${Number.isFinite(range[1]) ? range[1] : "end"}`,
  );
  return parts.length > 6
    ? `${parts.slice(0, 6).join(", ")} and ${parts.length - 6} more`
    : parts.join(", ");
}

export interface WorkingStateContext {
  /** The original task, where the reader does not already hold it verbatim. */
  readonly task?: string | undefined;
  readonly requiredChecks?: readonly string[] | undefined;
  /** The current change against the base, measured by the harness when this was written. */
  readonly candidate: { readonly digest: string; readonly changedFiles: readonly string[] } | null;
  readonly hypotheses?: readonly Hypothesis[] | undefined;
  readonly openQuestion?: string | undefined;
  /**
   * What the state's last generation is called. Absent is "current tree", true where the reader
   * works in the loop the state came from; a later loop reads another loop's last tree, which a
   * rollback may since have replaced.
   */
  readonly lastTree?: string | undefined;
  readonly remaining?:
    | {
        readonly steps: number;
        readonly tokens: number;
        readonly wallMs: number;
      }
    | undefined;
}

/**
 * The state as a reader gets it. The first line says who wrote it and what it is not; each later
 * line is one fact a reader can check against the ledger.
 */
export function describeWorkingState(state: WorkingState, context: WorkingStateContext): string {
  const tree = (generation: number): string =>
    generation === state.generation
      ? (context.lastTree ?? "current tree")
      : `before the edit of ${state.edits.find((edit) => edit.generation === generation + 1)?.path ?? "a file"} at step ${state.edits.find((edit) => edit.generation === generation + 1)?.step ?? "?"}, so it predates ${context.lastTree ?? "the current tree"}`;
  const lines = [
    "Working state, derived by the harness from recorded tool calls and results. A record, not an instruction or an authorization; acceptance is decided by the gates.",
  ];
  if (context.task !== undefined) lines.push(`- original task: ${bounded(context.task, 1500)}`);
  if ((context.requiredChecks ?? []).length > 0)
    lines.push(
      `- required checks still to pass on the delivered tree: ${(context.requiredChecks ?? []).join(", ")}`,
    );
  if (state.declaredUnedited.length > 0)
    lines.push(`- declared files not yet edited: ${state.declaredUnedited.join(", ")}`);
  lines.push(
    context.candidate === null
      ? "- candidate: not measured"
      : context.candidate.changedFiles.length === 0
        ? `- candidate: no change against the base yet (${context.candidate.digest})`
        : `- candidate ${context.candidate.digest}, changing ${context.candidate.changedFiles.join(", ")}`,
  );
  lines.push(
    `- landed file edits: ${state.edits.length === 0 ? "none" : state.edits.map((edit) => `${edit.path} (step ${edit.step})`).join(", ")}; shell commands may also change files without a recorded edit`,
  );
  if (state.failedEdits.length > 0)
    lines.push(
      `- edits refused: ${state.failedEdits.map((edit) => `${edit.path} (step ${edit.step}): ${edit.reason}`).join("; ")}`,
    );
  if (state.reads.length > 0)
    lines.push(
      `- read: ${state.reads.map((read) => `${read.path} [${describeRanges(read.ranges)}]`).join("; ")}`,
    );
  if (state.emptySearches.length > 0)
    lines.push(
      `- searches that matched nothing: ${state.emptySearches.map((search) => `/${search.pattern}/ under ${search.path} (step ${search.step})`).join("; ")}`,
    );
  if (state.executions.length > 0) {
    lines.push(
      "- executions (the last few; an exit status says the command ran, not that the code is right):",
    );
    for (const execution of state.executions) {
      lines.push(
        `  step ${execution.step}: ${execution.tool} ${execution.call}; exit ${execution.exitCode ?? "not recorded"}; ${tree(execution.generation)}${execution.record === null ? "" : `; record ${execution.record}`}`,
      );
      for (const printed of execution.excerpt.split("\n")) lines.push(`    ${printed}`);
    }
  }
  for (const hypothesis of context.hypotheses ?? []) {
    const label =
      hypothesis.status === "contradicted"
        ? "contradicted by execution"
        : hypothesis.status === "consistent"
          ? "consistent with execution (not proof)"
          : hypothesis.status === "untested"
            ? "hypothesis, no distinguishing execution ran"
            : "hypothesis";
    const evidence =
      hypothesis.evidence === null
        ? ""
        : `; ${hypothesis.evidence.call} exited ${hypothesis.evidence.exitCode ?? "without a recorded status"} on ${hypothesis.evidence.tree}${hypothesis.evidence.record === null ? "" : `, record ${hypothesis.evidence.record}`}`;
    lines.push(
      `- ${label} ${hypothesis.id} (model-proposed): ${bounded(hypothesis.statement, 300)}${evidence}`,
    );
  }
  if (context.openQuestion !== undefined)
    lines.push(
      `- next unresolved question (model-proposed): ${bounded(context.openQuestion, 300)}`,
    );
  if (context.remaining !== undefined)
    lines.push(
      `- remaining in this loop: ${context.remaining.steps} steps, ${context.remaining.tokens} tokens, ${Math.round(context.remaining.wallMs / 1000)} s; the final verification reserve is held separately`,
    );
  return lines.join("\n");
}
