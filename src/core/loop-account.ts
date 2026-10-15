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
}

/** How many entries of each kind the account keeps, and how long any one line may be. */
const maxEntries = 24;
const maxLineChars = 200;

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

const evidenceTrailer = /\n\[evidence record sha256:[0-9a-f]{64} kind [^\]]*\]$/;

function strip(output: string): string {
  return output.replace(evidenceTrailer, "").trim();
}

/** A shell result the loop learned nothing from: it ran and printed nothing, or it did not run. */
function shellWasEmpty(output: string): boolean {
  const text = strip(output);
  const printedNothing = !/\n(stdout|stderr):\n/.test(`\n${text}`);
  return printedNothing || /^exit code: [1-9]\d*\s*$/m.test(text);
}

function count(into: Map<string, number>, key: string): void {
  into.set(key, (into.get(key) ?? 0) + 1);
}

export function priorLoopAccount(
  messages: readonly ConversationMessage[],
  stopReason: StopReason,
  steps: number,
): PriorLoopAccount {
  const edits = new Set<string>();
  const reads = new Set<string>();
  const emptySearches = new Map<string, number>();
  const refused = new Map<string, { reason: string; times: number }>();
  const emptyShell = new Map<string, number>();

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
        break;
      case "read":
        reads.add(spelled);
        break;
      case "search":
        if (text.startsWith("no match for ")) count(emptySearches, spelled);
        break;
      case "shell":
        if (shellWasEmpty(outcome.output)) count(emptyShell, spelled);
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
  return lines.join("\n");
}
