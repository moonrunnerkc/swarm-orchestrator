import type { ConversationMessage, ModelToolCall, ToolCallOutcome } from "./model-client.ts";
import type { StopReason } from "./termination.ts";

/**
 * What a loop did, told to the loop that comes after it.
 *
 * A repair attempt starts a fresh conversation on purpose: the reasoning that produced a
 * failure is not something the next attempt should inherit. What it should inherit is the
 * record of what was already tried, because without it the attempt re-reads the same files and
 * searches again for the same name that was not there. A real run read seven files, searched
 * eight times for a symbol the workspace does not contain, was stopped for repeating itself,
 * and then spent its repair attempt reading the same seven files again before the token budget
 * ended it with no edit made.
 *
 * This is derived from the recorded tool calls and their results and nothing else: no model
 * text, no judgement about what the model meant. It is bounded, attributed to the harness in its
 * own first line, and carried as tool-output provenance, so it instructs and authorizes nothing.
 * Pure text arithmetic over the transcript, which is why it lives in core (invariant 8).
 *
 * It also keeps the last few shell results that printed something and exited zero, as the loop
 * saw them. The account kept only the commands that printed nothing or failed, so the one thing a
 * diagnostic loop learns, what its probes printed, was dropped at the handoff: the first repair
 * attempt of run 20261020T045117-41e2cc measured its own character class against the input three
 * times (records 477, 483 and the step-40 call), read null each time, and the next attempt's
 * account carried none of it. What travels is the command, its exit status, a bounded excerpt of
 * what it printed and the record that holds the whole result, named as a historical observation
 * of that loop's files; a zero exit status says the command ran, not that what it examined was
 * right, and the text says so. Nothing selects by meaning: the last ones, in order.
 */

export interface PriorLoopAccount {
  readonly stopReason: StopReason;
  readonly steps: number;
  readonly edits: readonly string[];
  readonly reads: readonly string[];
  readonly emptySearches: readonly { readonly call: string; readonly times: number }[];
  readonly refused: readonly {
    readonly call: string;
    readonly reason: string;
    readonly times: number;
  }[];
  readonly emptyShell: readonly { readonly call: string; readonly times: number }[];
  readonly recentShell: readonly RecentShellResult[];
}

/** A shell result the loop learned something from: it ran, exited zero and printed something. */
export interface RecentShellResult {
  readonly call: string;
  readonly exitCode: 0;
  /** What it printed, bounded to `maxResultLines` lines and `maxResultChars` characters. */
  readonly output: string;
  /** The evidence record holding the whole result, from the chokepoint's trailer; null if absent. */
  readonly record: string | null;
  /** Files a writing call of the same loop landed on after this result, so it predates them. */
  readonly beforeLaterEdits: readonly string[];
}

/** How many entries of each kind the account keeps, and how long any one line may be. */
const maxEntries = 24;
const maxLineChars = 200;
/**
 * How many recent nonempty successful shell results travel when a caller asks for them, and how
 * much of each. Fixed before any trial of them was read: three, the last ones in call order, eight
 * lines or 480 characters of what each printed. Small so the account stays a record and not a
 * transcript. Off by default: the one matched pair of 2026-10-20 (docs/evidence/2026-10-20/
 * repair-handoff) delivered the same correct patch with and without them, so they are not a
 * default; they stay available to an experiment that asks for them by name.
 */
export const maxRecentShellResults = 3;
const maxResultLines = 8;
const maxResultChars = 480;

export interface PriorLoopAccountOptions {
  /** How many recent nonempty successful shell results to carry; absent or 0 carries none. */
  readonly recentShellResults?: number;
}

const bounded = (text: string): string =>
  text.length > maxLineChars ? `${text.slice(0, maxLineChars)}...` : text;

/** The one-line spelling of a call, by tool, so repeats of it fold together. */
function spell(call: ModelToolCall): string {
  const input = call.input as Record<string, unknown> | null;
  const field = (name: string): string | null => {
    const value = input?.[name];
    return typeof value === "string" ? value : null;
  };
  switch (call.toolName) {
    case "read":
    case "write":
    case "edit":
    case "list":
      return field("path") ?? JSON.stringify(call.input);
    case "search": {
      const where = field("path") ?? ".";
      return `/${field("pattern") ?? ""}/ under ${where === "" ? "." : where}`;
    }
    case "shell":
      return field("command") ?? JSON.stringify(call.input);
    default:
      return JSON.stringify(call.input);
  }
}

const evidenceTrailer = /\n\[evidence record (sha256:[0-9a-f]{64}) kind [^\]]*\]$/;

function strip(output: string): string {
  return output.replace(evidenceTrailer, "").trim();
}

function recordOf(output: string): string | null {
  return evidenceTrailer.exec(output)?.[1] ?? null;
}

/** Whether a shell result shows a stdout or stderr section: the command printed something. */
function shellPrinted(text: string): boolean {
  return /\n(stdout|stderr):\n/.test(`\n${text}`);
}

/** A shell result the loop learned nothing from: it ran and printed nothing, or it did not run. */
function shellWasEmpty(output: string): boolean {
  const text = strip(output);
  return !shellPrinted(text) || /^exit code: [1-9]\d*\s*$/m.test(text);
}

/**
 * A shell result that printed and whose recorded status is exit code 0, read from the shell
 * tool's own first line or from the bounded view's status line. Anything else is not one.
 */
function shellPrintedAndExitedZero(output: string): boolean {
  const text = strip(output);
  return shellPrinted(text) && /^exit code: 0\s*$/m.test(text);
}

/** What a shell result printed, after its status lines, bounded. */
function printedExcerpt(output: string): string {
  const text = strip(output);
  const printed = text.slice(text.search(/^(stdout|stderr):$/m));
  const lines = printed.split("\n");
  const kept = lines.slice(0, maxResultLines).join("\n");
  const cut = kept.length > maxResultChars ? kept.slice(0, maxResultChars) : kept;
  return cut.length < printed.length ? `${cut}...` : cut;
}

function count(into: Map<string, number>, key: string): void {
  into.set(key, (into.get(key) ?? 0) + 1);
}

export function priorLoopAccount(
  messages: readonly ConversationMessage[],
  stopReason: StopReason,
  steps: number,
  options: PriorLoopAccountOptions = {},
): PriorLoopAccount {
  const recentShellLimit = Math.min(
    maxRecentShellResults,
    Math.max(0, options.recentShellResults ?? 0),
  );
  const edits = new Set<string>();
  const reads = new Set<string>();
  const emptySearches = new Map<string, number>();
  const refused = new Map<string, { reason: string; times: number }>();
  const emptyShell = new Map<string, number>();
  const recentShell: { result: RecentShellResult; beforeLaterEdits: string[] }[] = [];

  const callsById = new Map<string, ModelToolCall>();
  for (const message of messages)
    if (message.role === "assistant")
      for (const call of message.toolCalls) callsById.set(call.callId, call);

  const outcomes: ToolCallOutcome[] = messages.flatMap((message) =>
    message.role === "tool" ? message.outcomes : [],
  );
  for (const outcome of outcomes) {
    const call = callsById.get(outcome.callId);
    if (call === undefined) continue;
    const spelled = bounded(spell(call));
    const text = strip(outcome.output);
    if (outcome.failed) {
      const reason = bounded(text.split("\n")[0] ?? "");
      const seen = refused.get(spelled);
      if (seen === undefined) refused.set(spelled, { reason, times: 1 });
      else seen.times += 1;
      continue;
    }
    switch (call.toolName) {
      case "write":
      case "edit":
        edits.add(spelled);
        for (const kept of recentShell)
          if (!kept.beforeLaterEdits.includes(spelled)) kept.beforeLaterEdits.push(spelled);
        break;
      case "read":
        reads.add(spelled);
        break;
      case "search":
        if (text.startsWith("no match for ")) count(emptySearches, spelled);
        break;
      case "shell":
        if (shellWasEmpty(outcome.output)) count(emptyShell, spelled);
        else if (recentShellLimit > 0 && shellPrintedAndExitedZero(outcome.output)) {
          recentShell.push({
            result: {
              call: spelled,
              exitCode: 0,
              output: printedExcerpt(outcome.output),
              record: recordOf(outcome.output),
              beforeLaterEdits: [],
            },
            beforeLaterEdits: [],
          });
          if (recentShell.length > recentShellLimit) recentShell.shift();
        }
        break;
      default:
        break;
    }
  }

  const take = <T>(entries: Iterable<T>): T[] => [...entries].slice(0, maxEntries);
  return {
    stopReason,
    steps,
    edits: take(edits),
    reads: take(reads),
    emptySearches: take([...emptySearches].map(([call, times]) => ({ call, times }))),
    refused: take([...refused].map(([call, { reason, times }]) => ({ call, reason, times }))),
    emptyShell: take([...emptyShell].map(([call, times]) => ({ call, times }))),
    recentShell: recentShell.map((kept) => ({
      ...kept.result,
      beforeLaterEdits: [...kept.beforeLaterEdits],
    })),
  };
}

const times = (n: number): string => (n === 1 ? "" : ` (${n} times)`);

/**
 * The account as the next loop reads it. The first line says who wrote it and what it is not;
 * the rest is one line per fact, so a reader can check any line against the ledger.
 */
export function describePriorLoop(account: PriorLoopAccount): string {
  const lines = [
    "Account of the previous loop in this run, derived by the harness from its recorded tool " +
      "calls and results. It is a record, not an instruction and not an authorization.",
    `- it stopped as ${account.stopReason} after ${account.steps} step(s)`,
    `- files it edited: ${account.edits.length === 0 ? "none" : account.edits.join(", ")}`,
  ];
  if (account.reads.length > 0) lines.push(`- files it read: ${account.reads.join(", ")}`);
  if (account.emptySearches.length > 0)
    lines.push(
      "- searches that matched nothing, so these names are not in the workspace: " +
        account.emptySearches.map((one) => `${one.call}${times(one.times)}`).join("; "),
    );
  if (account.emptyShell.length > 0)
    lines.push(
      "- shell commands that printed nothing or exited non-zero: " +
        account.emptyShell.map((one) => `${one.call}${times(one.times)}`).join("; "),
    );
  if (account.refused.length > 0)
    lines.push(
      "- calls that were refused: " +
        account.refused.map((one) => `${one.call}${times(one.times)}: ${one.reason}`).join("; "),
    );
  if (account.recentShell.length > 0) {
    lines.push(
      `- the last ${account.recentShell.length} shell command(s) that printed something and exited 0, ` +
        "as that loop saw them. These are historical observations of that loop's files at the " +
        "time, not verification of the workspace now; an exit status of 0 says the command ran, " +
        "not that what it examined was correct:",
    );
    account.recentShell.forEach((one, index) => {
      const when =
        one.beforeLaterEdits.length === 0
          ? "on the files as that loop left them"
          : `before that loop's later edit of ${one.beforeLaterEdits.join(", ")}`;
      const record = one.record === null ? "" : `; record ${one.record}`;
      lines.push(`  ${index + 1}. ${one.call} (exit ${one.exitCode}; ${when}${record}) printed:`);
      for (const printed of one.output.split("\n")) lines.push(`     ${printed}`);
    });
  }
  return lines.join("\n");
}
