import type { JsonValue } from "../evidence/canonical-json.ts";
import { recordedOutputToolName } from "./recorded-output-tool.ts";

/**
 * What the model is shown of a long tool output, while the ledger keeps what was captured.
 *
 * A worker ran `npm test 2>&1` and was handed all 113 KB of it. The output stayed in the resent
 * conversation for six more calls, about 51,000 input tokens each, and each of those calls spent
 * close to fifty seconds before its first token on a local server. Nothing in it was needed after
 * the first reading: the exit status was already a recorded fact.
 *
 * The view is deterministic and carries no summary: the first and last lines as printed, the
 * status facts the harness measured (never read back out of the text), where the omission is, and
 * the evidence reference that gives the omitted lines back through `read_recorded_output`. Lines
 * in the omitted part that mention a failure are listed by number as a text match, so a failure
 * printed mid-log is not hidden behind a passing tail; the match is a pointer and decides nothing.
 */
export interface OutputViewLimits {
  /** An output this long or shorter is shown whole. */
  readonly maxChars: number;
  readonly headChars: number;
  readonly tailChars: number;
  /** At most this many omitted lines are pointed at, each cut to `hintChars`. */
  readonly hintLines: number;
  readonly hintChars: number;
}

export const defaultOutputViewLimits: OutputViewLimits = {
  maxChars: 12_000,
  headChars: 3_000,
  tailChars: 6_000,
  hintLines: 12,
  hintChars: 200,
};

/** Words a runner prints beside a failure. A pointer for the model, never a reading of the result. */
const failureMention =
  /\b(?:fail(?:s|ed|ing|ure|ures)?|errors?|exception|not ok|panic(?:ked)?|assertion|traceback)\b|[✗✖✘]/i;
/** A line a runner marks as passing names a test, whatever its words: "✔ should fail on bad input". */
const passMark = /^\s*(?:[✔✓√]|ok\s)/;

const count = (value: number) => value.toLocaleString("en-US");

/**
 * The view of `text`, or null where it is short enough to be shown whole. `facts` are the call's
 * recorded facts; `record` and `kind` are the evidence reference the call was recorded under.
 */
export function outputView(input: {
  readonly text: string;
  readonly facts: Readonly<Record<string, JsonValue>>;
  readonly record: string;
  readonly kind: string;
  readonly limits?: OutputViewLimits;
}): string | null {
  const limits = input.limits ?? defaultOutputViewLimits;
  if (input.text.length <= limits.maxChars) return null;
  const lines = input.text.split("\n");
  const head = leadingLines(lines, limits.headChars);
  const tail = trailingLines(lines, limits.tailChars, head.next);
  const firstOmitted = head.next;
  const lastOmitted = tail.first - 1;
  const hints: string[] = [];
  for (
    let index = firstOmitted;
    index <= lastOmitted && hints.length < limits.hintLines;
    index += 1
  ) {
    const line = lines[index] ?? "";
    if (failureMention.test(line) && !passMark.test(line))
      hints.push(`${count(index + 1)}: ${line.slice(0, limits.hintChars)}`);
  }
  const omitted =
    lastOmitted >= firstOmitted
      ? `lines ${count(firstOmitted + 1)} to ${count(lastOmitted + 1)} omitted`
      : "no whole line omitted";
  const reading = `${recordedOutputToolName} {"record":"${input.record}","startLine":${firstOmitted + 1},"endLine":${Math.min(lastOmitted + 1, firstOmitted + 200)}}`;
  return [
    `[output view: the full output is ${count(input.text.length)} characters in ${count(lines.length)} lines, kept on evidence record ${input.record} (kind ${input.kind}); ${omitted}. recorded status: ${describeStatus(input.facts)}. This is an excerpt: nothing about the omitted lines follows from this excerpt. Read them with ${reading}, or pass "contains" instead of the line range to find lines.]`,
    ...head.shown,
    `[... ${omitted} ...]`,
    ...(hints.length === 0
      ? []
      : [
          "[omitted lines that mention a failure or an error (a text match to point at them, not a verdict):]",
          ...hints,
        ]),
    ...tail.shown,
  ].join("\n");
}

/** The harness's own facts about the call, in words; what is not recorded is said to be absent. */
function describeStatus(facts: Readonly<Record<string, JsonValue>>): string {
  if (typeof facts.exitCode !== "number") return "none recorded for this tool";
  return [
    `exit code ${facts.exitCode}`,
    facts.timedOut === true ? "timed out" : "not timed out",
    facts.cancelled === true ? "cancelled" : "not cancelled",
    facts.truncated === true ? "capture truncated at its limit" : "capture complete",
    ...(typeof facts.startFailure === "string" ? [`start failure: ${facts.startFailure}`] : []),
  ].join(", ");
}

/** A line longer than the whole budget is cut, and the cut said, so one line cannot defeat the bound. */
function cut(line: string, index: number, budget: number): string {
  return `${line.slice(0, budget)} [${count(line.length - budget)} characters of line ${count(index + 1)} omitted]`;
}

/** Whole lines from the start while they fit in `budget` characters, and the index after them. */
function leadingLines(
  lines: readonly string[],
  budget: number,
): { readonly shown: readonly string[]; readonly next: number } {
  const shown: string[] = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    if (used + line.length + 1 > budget) {
      if (shown.length === 0) return { shown: [cut(line, index, budget)], next: index + 1 };
      return { shown, next: index };
    }
    shown.push(line);
    used += line.length + 1;
  }
  return { shown, next: lines.length };
}

/** Whole lines up to the end while they fit in `budget`, never before `after`, and the first one's index. */
function trailingLines(
  lines: readonly string[],
  budget: number,
  after: number,
): { readonly shown: readonly string[]; readonly first: number } {
  const shown: string[] = [];
  let used = 0;
  let first = lines.length;
  for (let index = lines.length - 1; index >= after; index -= 1) {
    const line = lines[index] ?? "";
    if (used + line.length + 1 > budget) {
      if (shown.length === 0) return { shown: [cut(line, index, budget)], first: index };
      break;
    }
    shown.unshift(line);
    used += line.length + 1;
    first = index;
  }
  return { shown, first };
}
