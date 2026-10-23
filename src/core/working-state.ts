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
 * ran against. A generation is the number of changes the harness knows landed before the call:
 * file edits, and shell commands whose measured effect changed the tree (src/agent-workspace-
 * effects.ts writes that measurement into the result). A shell command whose effect was not
 * measured may have changed anything, so what came before it is named as possibly changed rather
 * than current. Explanations are a separate, explicitly labelled kind: a model proposed them, and
 * only a harness-run execution moves one to consistent or contradicted.
 *
 * An execution is a check or an inspection (the caller's classifier decides, from the shell
 * tool's own tokenizer). A check's result is kept per subject: a later success of something else
 * says nothing about it, which the first version of this got wrong (an `ls` exiting 0 after a
 * failing `npm test` was read as the tree's latest result). A check failure stays open until the
 * same check runs again on a later tree, or a known change makes it stale. A refused call, a
 * timeout and an unmeasured effect are uncertainty, never a pass and never a failure.
 *
 * Pure text arithmetic over the transcript (invariant 8). No model text is read as a fact here.
 */

/**
 * What an execution's result says: the command exited 0, exited otherwise, gave a status that is
 * not the check's (a filter's, a fallback's, a timeout's), or did not run at all.
 */
export type ExecutionStatus = "exit-zero" | "exit-nonzero" | "unknown" | "not-run";

export interface WorkingStateExecution {
  /** The assistant turn, counted within the transcript given, that made the call. */
  readonly step: number;
  readonly tool: string;
  readonly call: string;
  /** Read from the tool's own status line; null where the result carries none. */
  readonly exitCode: number | null;
  /** The chokepoint refused the call or the tool failed, so nothing was observed. */
  readonly failed: boolean;
  readonly excerpt: string;
  readonly record: string | null;
  /** Known changes that had landed before this call. */
  readonly generation: number;
  readonly kind: "check" | "inspection";
  /** What the result is about; a check's result is compared only with the same subject's. */
  readonly subject: string;
  readonly status: ExecutionStatus;
  /** Whether a later shell command with no measured effect may have changed the tree since. */
  readonly possiblyChangedSince: boolean;
}

export interface WorkingStateEdit {
  readonly step: number;
  readonly path: string;
  /** The generation this edit started. */
  readonly generation: number;
  /** Present where a shell command made the change, as the harness measured it. */
  readonly byShell?: string | undefined;
}

/** How the caller's classifier reads a shell command. */
export interface ShellReading {
  readonly kind: "check" | "inspection";
  readonly subject: string;
  /** False where the shell's status is not the check's own (a pipe into a filter, `|| true`). */
  readonly statusIsTheCheck: boolean;
}

export interface WorkingStateOptions {
  /** Absent, every shell command is a check of its own text with its exit status as its own. */
  readonly classifyShell?: ((command: string) => ShellReading) | undefined;
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
  /** Each check subject's latest result, in the order they were last run. */
  readonly checks: readonly WorkingStateExecution[];
  /** Shell commands that may have changed files with no measured effect. */
  readonly unmeasuredShell: number;
  /** Files a declaration named that no landed edit has touched yet. */
  readonly declaredUnedited: readonly string[];
  /** Code-like names searched for and found nowhere the loop has looked, in any result. */
  readonly unseenNames: readonly string[];
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
  /** Text the output must contain; every entry, where several are given. */
  readonly outputIncludes?: string | readonly string[] | undefined;
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

/** One entry of a measured change, as the workspace-effect line spells it. */
export interface MeasuredChange {
  readonly status: string;
  readonly path: string;
  readonly from?: string | undefined;
}

export type WorkspaceEffect =
  | { readonly changes: readonly MeasuredChange[]; readonly more: number }
  | { readonly unmeasured: string };

const effectPrefix = "[workspace after this command: ";

/** The harness's line naming what a shell command changed, written into its result. */
export function workspaceEffectLine(effect: WorkspaceEffect): string {
  if ("unmeasured" in effect)
    return `${effectPrefix}not measured (${effect.unmeasured.replace(/[\]\n]/g, " ").slice(0, 200)})]`;
  if (effect.changes.length === 0) return `${effectPrefix}unchanged]`;
  const spelled = effect.changes.map((change) =>
    change.status === "R" || change.status === "C"
      ? `${change.status} ${change.from ?? ""} -> ${change.path}`
      : `${change.status} ${change.path}`,
  );
  return `${effectPrefix}changed ${spelled.join("; ")}${effect.more > 0 ? `; and ${effect.more} more` : ""}]`;
}

/** The measured effect a result carries, or null where it carries none. */
export function workspaceEffectOf(output: string): WorkspaceEffect | null {
  const line = strip(output)
    .split("\n")
    .find((one) => one.startsWith(effectPrefix) && one.endsWith("]"));
  if (line === undefined) return null;
  const body = line.slice(effectPrefix.length, -1);
  if (body === "unchanged") return { changes: [], more: 0 };
  if (body.startsWith("not measured")) return { unmeasured: body };
  if (!body.startsWith("changed ")) return { unmeasured: body };
  let more = 0;
  const changes: MeasuredChange[] = [];
  for (const entry of body.slice("changed ".length).split("; ")) {
    const counted = /^and (\d+) more$/.exec(entry);
    if (counted !== null) {
      more = Number(counted[1]);
      continue;
    }
    const renamed = /^([RC]) (.+) -> (.+)$/.exec(entry);
    if (renamed !== null)
      changes.push({ status: renamed[1] ?? "R", from: renamed[2], path: renamed[3] ?? "" });
    else {
      const plain = /^([A-Z]) (.+)$/.exec(entry);
      if (plain !== null) changes.push({ status: plain[1] ?? "M", path: plain[2] ?? "" });
    }
  }
  return { changes, more };
}

function excerptOf(output: string): string {
  const lines = strip(output).split("\n");
  const kept = lines.slice(0, excerptLines).join("\n");
  const cut = kept.length > excerptChars ? kept.slice(0, excerptChars) : kept;
  return cut.length < strip(output).length ? `${cut}...` : cut;
}

const executionTools = new Set(["shell", "run_check"]);
const fileWriters = new Set(["write", "edit"]);

/** The paths a file-tool call names: one, or each of a batch's edits. */
export function writtenPaths(call: ModelToolCall): readonly string[] {
  const single = text(call, "path");
  const batch = field(call, "edits");
  const fromBatch = Array.isArray(batch)
    ? batch
        .map((one) => (one as Record<string, unknown> | null)?.path)
        .filter((path): path is string => typeof path === "string")
    : [];
  return [...new Set([...(single === null ? [] : [single]), ...fromBatch])];
}

const codeName = /[A-Za-z_$][A-Za-z0-9_$]{3,}/g;

/** camelCase, PascalCase with an inner capital, or a name joined by an underscore. */
function looksLikeCodeName(word: string): boolean {
  return /[a-z][A-Z]/.test(word) || /[A-Za-z0-9]_[A-Za-z0-9]/.test(word);
}

const timedOut = /^the command was killed for exceeding its timeout$/m;

export function deriveWorkingState(
  messages: readonly ConversationMessage[],
  options: WorkingStateOptions = {},
): WorkingState {
  const classify =
    options.classifyShell ??
    ((command: string): ShellReading => ({
      kind: "check",
      subject: command.trim(),
      statusIsTheCheck: true,
    }));
  const calls = new Map<string, { call: ModelToolCall; step: number }>();
  let steps = 0;
  for (const message of messages)
    if (message.role === "assistant") {
      steps += 1;
      for (const call of message.toolCalls) calls.set(call.callId, { call, step: steps });
    }

  let generation = 0;
  let unmeasuredShell = 0;
  const edits: WorkingStateEdit[] = [];
  const failedEdits: { step: number; path: string; reason: string }[] = [];
  const reads = new Map<string, (readonly [number, number] | null)[]>();
  const emptySearches: { step: number; pattern: string; path: string }[] = [];
  const executions: (Omit<WorkingStateExecution, "possiblyChangedSince"> & {
    readonly unmeasuredBefore: number;
  })[] = [];
  const declared = new Set<string>();
  // Everything the loop was shown, for telling a name it never saw from one it saw elsewhere.
  const shown: string[] = [];

  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const outcome of message.outcomes) {
      const found = calls.get(outcome.callId);
      if (found === undefined) continue;
      const { call, step } = found;
      const body = strip(outcome.output);
      if (!outcome.failed && call.toolName !== "search") shown.push(body);
      if (fileWriters.has(call.toolName)) {
        const paths = writtenPaths(call);
        const path = bounded(paths.length === 0 ? JSON.stringify(call.input) : paths.join(", "));
        if (outcome.failed)
          failedEdits.push({ step, path, reason: bounded(body.split("\n")[0] ?? "") });
        else {
          generation += 1;
          for (const one of paths.length === 0 ? [path] : paths)
            edits.push({ step, path: bounded(one), generation });
        }
        continue;
      }
      if (call.toolName === "declare_file_set" || call.toolName === "amend_file_set") {
        const files = field(call, "files");
        if (!outcome.failed && Array.isArray(files))
          for (const file of files) if (typeof file === "string") declared.add(file);
        continue;
      }
      if (outcome.failed && !executionTools.has(call.toolName)) continue;
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
      } else if (call.toolName === "search") {
        if (body.startsWith("no match for "))
          emptySearches.push({
            step,
            pattern: bounded(text(call, "pattern") ?? ""),
            path: text(call, "path") ?? ".",
          });
        else shown.push(body);
      }
      if (!executionTools.has(call.toolName)) continue;
      const command =
        call.toolName === "shell"
          ? (text(call, "command") ?? JSON.stringify(call.input))
          : JSON.stringify(call.input);
      const reading: ShellReading =
        call.toolName === "shell"
          ? classify(command)
          : {
              kind: "check",
              subject: `run_check ${text(call, "check") ?? text(call, "id") ?? command}`,
              statusIsTheCheck: true,
            };
      const exitCode = outcome.failed ? null : exitCodeOf(outcome.output);
      const status: ExecutionStatus = outcome.failed
        ? "not-run"
        : exitCode === null ||
            (reading.kind === "check" && !reading.statusIsTheCheck) ||
            timedOut.test(body)
          ? "unknown"
          : exitCode === 0
            ? "exit-zero"
            : "exit-nonzero";
      executions.push({
        step,
        tool: call.toolName,
        call: bounded(command),
        exitCode,
        failed: outcome.failed,
        excerpt: excerptOf(outcome.output),
        record: evidenceTrailer.exec(outcome.output)?.[1] ?? null,
        generation,
        kind: reading.kind,
        subject: bounded(reading.subject),
        status,
        unmeasuredBefore: unmeasuredShell,
      });
      if (call.toolName !== "shell" || outcome.failed) continue;
      // The command's own result is about the tree it started on; what it changed starts the
      // next generation. An inspection prints; a command of any other kind with no measured
      // effect may have written anything.
      const effect = workspaceEffectOf(outcome.output);
      if (effect !== null && "changes" in effect) {
        if (effect.changes.length > 0 || effect.more > 0) {
          generation += 1;
          for (const change of effect.changes)
            edits.push({
              step,
              path: bounded(change.path),
              generation,
              byShell:
                change.status === "R"
                  ? `renamed from ${change.from ?? "?"}`
                  : change.status === "D"
                    ? "deleted"
                    : change.status === "A"
                      ? "added"
                      : "modified",
            });
        }
      } else if (reading.kind === "check") unmeasuredShell += 1;
    }
  }

  const finished = executions.map(({ unmeasuredBefore, ...execution }) => ({
    ...execution,
    possiblyChangedSince: unmeasuredShell > unmeasuredBefore,
  }));
  // Only a decisive result stands for its check: a filter's status, a timeout or a refusal of the
  // same command neither passes nor fails it.
  const latestBySubject = new Map<string, WorkingStateExecution>();
  for (const execution of finished)
    if (
      execution.kind === "check" &&
      (execution.status === "exit-zero" || execution.status === "exit-nonzero")
    ) {
      latestBySubject.delete(execution.subject);
      latestBySubject.set(execution.subject, execution);
    }
  const everythingShown = shown.join("\n");
  const unseen = new Set<string>();
  for (const search of emptySearches)
    for (const word of search.pattern.match(codeName) ?? [])
      if (looksLikeCodeName(word) && !everythingShown.includes(word)) unseen.add(word);
  const edited = new Set(edits.map((edit) => edit.path));
  return {
    steps,
    generation,
    edits: edits.slice(-maxEntries),
    failedEdits: failedEdits.slice(-maxEntries),
    reads: [...reads].slice(0, maxEntries).map(([path, ranges]) => ({ path, ranges })),
    emptySearches: emptySearches.slice(-maxEntries),
    executions: finished.slice(-maxExecutions),
    checks: [...latestBySubject.values()].slice(-maxExecutions),
    unmeasuredShell,
    declaredUnedited: [...declared].filter((path) => !edited.has(path)).slice(0, maxEntries),
    unseenNames: [...unseen].slice(0, 3),
  };
}

/** The execution facts the decision policy reads, and nothing it would have to interpret. */
export interface DecisionSignals {
  readonly landedEdits: number;
  /** Check subjects whose latest result failed on the current tree (or one only unmeasured commands may have changed). */
  readonly openFailures: readonly WorkingStateExecution[];
  /** Check subjects whose latest result failed on a tree a known change has since replaced. */
  readonly staleFailures: readonly WorkingStateExecution[];
  /** The last check made against the current tree, if any. */
  readonly latestCheckAtCurrentTree: WorkingStateExecution | null;
  /** Edited generations in which some check's latest result there failed. */
  readonly failingEditedGenerations: number;
  readonly failedEdits: number;
  /** Code-like names searched for and never shown to the loop, in any result. */
  readonly missingNames: readonly string[];
}

export function decisionSignals(state: WorkingState): DecisionSignals {
  const failing = state.checks.filter((check) => check.status === "exit-nonzero");
  const perGeneration = new Map<number, Map<string, WorkingStateExecution>>();
  for (const execution of state.executions) {
    if (
      execution.kind !== "check" ||
      (execution.status !== "exit-zero" && execution.status !== "exit-nonzero")
    )
      continue;
    const subjects = perGeneration.get(execution.generation) ?? new Map();
    subjects.set(execution.subject, execution);
    perGeneration.set(execution.generation, subjects);
  }
  const failingEditedGenerations = [...perGeneration].filter(
    ([generation, subjects]) =>
      generation > 0 && [...subjects.values()].some((one) => one.status === "exit-nonzero"),
  ).length;
  const atCurrent = state.checks.filter((check) => check.generation === state.generation);
  return {
    landedEdits: state.edits.length,
    openFailures: failing.filter((check) => check.generation === state.generation),
    staleFailures: failing.filter((check) => check.generation < state.generation),
    latestCheckAtCurrentTree: atCurrent.at(-1) ?? null,
    failingEditedGenerations,
    failedEdits: state.failedEdits.length,
    missingNames: state.unseenNames,
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

/** The policy's identity on the record; v1 read the last execution of any kind as the tree's result. */
export const decisionRule = "adaptive-decision-v2";

/**
 * The registered policy (adaptive-decision-v2). Landed changes with no check failing on the
 * current tree are work in progress: continue, with no model call. A failure made stale by a
 * later change is the worker acting on it, not an open question, and is listed for rerunning
 * rather than diagnosed. A check failing on the current tree is an open question about that tree:
 * one diagnosis, and a different implementation is admissible only once two edited trees ended
 * with a failing check. With no landed change, names searched for and shown nowhere are
 * retrieved by the harness when they look like code; otherwise one diagnosis. Reaching the point
 * without an edit is not called a stall: the point sits at a fixed share of the allowance, and
 * what it buys is one fresh look while most of the allowance is still there to act on it.
 */
export function chooseDecision(signals: DecisionSignals): DecisionChoice {
  if (signals.landedEdits > 0) {
    if (signals.openFailures.length === 0)
      return {
        kind: "continue",
        rule: "edits-landed-no-open-failure",
        alternativePermitted: false,
      };
    return {
      kind: "diagnose",
      rule: "failing-check-at-current-tree",
      alternativePermitted: signals.failingEditedGenerations >= 2,
    };
  }
  if (signals.missingNames.length > 0)
    return { kind: "retrieve", rule: "no-edit-unseen-code-names", alternativePermitted: false };
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
  const includes =
    typeof prediction.outputIncludes === "string"
      ? [prediction.outputIncludes]
      : (prediction.outputIncludes ?? []);
  for (const text of includes)
    if (text.length > 0) checks.push(strip(observed.output).includes(text));
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
  /**
   * The task's own sentences about what must be kept and what must be delivered, quoted so they
   * stay in view through every handoff; no check judges them, and the line says so.
   */
  readonly taskStatements?: readonly string[] | undefined;
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
  const tree = (generation: number, possiblyChanged = false): string => {
    if (generation !== state.generation) {
      const next = state.edits.find((edit) => edit.generation === generation + 1);
      return `before the ${next?.byShell === undefined ? "edit" : "shell change"} of ${next?.path ?? "a file"} at step ${next?.step ?? "?"}, so it predates ${context.lastTree ?? "the current tree"}`;
    }
    const current = context.lastTree ?? "current tree";
    return possiblyChanged
      ? `${current}, unless a later shell command whose effect was not measured changed it`
      : current;
  };
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
  for (const statement of context.taskStatements ?? [])
    lines.push(
      `- the task says (its own words; no check here judges this): ${bounded(statement, 600)}`,
    );
  lines.push(
    `- landed file edits: ${state.edits.length === 0 ? "none" : state.edits.map((edit) => `${edit.path} (step ${edit.step}${edit.byShell === undefined ? "" : `, by shell: ${edit.byShell}`})`).join(", ")}${state.unmeasuredShell > 0 ? `; ${state.unmeasuredShell} shell command(s) ran with no measured effect and may also have changed files` : ""}`,
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
  const signals = decisionSignals(state);
  const named = (check: WorkingStateExecution) =>
    `${check.subject} (exit ${check.exitCode}, step ${check.step}, ${tree(check.generation, check.possiblyChangedSince)})`;
  if (signals.openFailures.length > 0)
    lines.push(
      `- checks failing on ${context.lastTree ?? "the current tree"}: ${signals.openFailures.map(named).join("; ")}`,
    );
  if (signals.staleFailures.length > 0)
    lines.push(
      `- checks that failed before a later change and have not run since (rerun to know): ${signals.staleFailures.map(named).join("; ")}`,
    );
  if (state.executions.length > 0) {
    lines.push(
      "- executions (the last few; an exit status says the command ran, not that the code is right):",
    );
    for (const execution of state.executions) {
      const status =
        execution.status === "not-run"
          ? "refused or not run"
          : `exit ${execution.exitCode ?? "not recorded"}${execution.status === "unknown" && execution.exitCode !== null ? " (not the check's own status: a filter, a fallback or a timeout)" : ""}`;
      lines.push(
        `  step ${execution.step}: ${execution.tool} ${execution.call}; ${status}; ${tree(execution.generation, execution.possiblyChangedSince)}${execution.kind === "inspection" ? "; an inspection, not a check" : ""}${execution.record === null ? "" : `; record ${execution.record}`}`,
      );
      for (const printed of execution.excerpt.split("\n")) lines.push(`    ${printed}`);
    }
  }
  // A status says only whether the hypothesis's own stated prediction held for the command the
  // harness ran. A prediction can be weak: development run 3's sinon diagnosis predicted grep's exit
  // status, and the passing patch edited the file of the hypothesis whose prediction failed.
  for (const hypothesis of context.hypotheses ?? []) {
    const label =
      hypothesis.status === "contradicted"
        ? "prediction failed when the harness ran it:"
        : hypothesis.status === "consistent"
          ? "prediction held when the harness ran it (says nothing beyond that prediction):"
          : hypothesis.status === "untested"
            ? "no distinguishing execution ran:"
            : "no distinguishing prediction:";
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
