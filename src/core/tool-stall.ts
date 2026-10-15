/**
 * A loop that keeps asking the same question and getting the same answer.
 *
 * A development run of the September campaign repeated one shell command thirty-five times in
 * consecutive steps, each call identical and each result identical, until the step budget
 * ended it with the manifest half changed and a million tokens spent. The text-repetition
 * detector beside this one watches a single response for a marker repeated to the cap; this
 * watches the sequence of tool calls for a call whose result the model has already seen.
 *
 * Progress is novelty: a call and result the recent window has not seen. A poll whose output
 * changes is novel every time. A reread after an edit is novel, because the edit was, and so is
 * the reread when the file changed. A denied call retried unchanged is not, and neither is the
 * same inspection repeated with the same answer. Nothing here reads the output's meaning; a
 * result is compared by a hash so no copy of it is retained (the ledger already holds it).
 *
 * Pure text arithmetic, so it belongs in core and costs nothing ambient (invariant 8).
 */

export interface StallPolicy {
  /** How many recent observations are remembered when asking whether one is new. */
  readonly window: number;
  /** How many consecutive already-seen observations it takes to call the loop stalled. */
  readonly threshold: number;
}

/**
 * Three repeats of something already answered: the fourth identical inspection in a row. One
 * repeat is a model double-checking; two is a model that did not read the answer; three is a
 * model that is not going to.
 */
export const defaultStallPolicy: StallPolicy = { window: 16, threshold: 3 };

export interface ToolObservation {
  readonly toolName: string;
  readonly input: unknown;
  readonly failed: boolean;
  readonly output: string;
}

export interface StallDetected {
  readonly toolName: string;
  /** Consecutive observations the window had already seen, this one included. */
  readonly repeats: number;
  /** The repeated call's arguments, as bounded JSON, so the notice can name what was repeated. */
  readonly input: string;
  /** The first line of the answer it kept getting, bounded, so the notice can name that too. */
  readonly output: string;
}

/** How much of a repeated call and its answer a notice quotes back. */
const excerptChars = 240;

function excerpt(text: string): string {
  const firstLine = text.replace(evidenceTrailer, "").split("\n")[0] ?? "";
  return firstLine.length > excerptChars ? `${firstLine.slice(0, excerptChars)}...` : firstLine;
}

export interface StallTracker {
  /** Record one tool outcome; the stall it completes, or null while the loop is making progress. */
  observe(observation: ToolObservation): StallDetected | null;
  /** How many consecutive observations, the last one included, the window had already seen. */
  repeats(): number;
  /** Forget the repeats after an intervention, so the next stall is a new one. */
  reset(): void;
  /** Forget everything seen: after compaction, an earlier answer is no longer one the model has. */
  forget(): void;
}

/**
 * The chokepoint ends every tool result with the ledger record it produced, which differs per
 * call by construction. It is stripped before results are compared, or no two would ever match.
 */
const evidenceTrailer = /\n\[evidence record sha256:[0-9a-f]{64} kind [^\]]*\]$/;

export function createStallTracker(policy: StallPolicy = defaultStallPolicy): StallTracker {
  const seen: string[] = [];
  let repeats = 0;
  return {
    observe(observation) {
      const key = observationKey(observation);
      const novel = !seen.includes(key);
      seen.push(key);
      if (seen.length > policy.window) seen.shift();
      if (novel) {
        repeats = 0;
        return null;
      }
      repeats += 1;
      return repeats >= policy.threshold
        ? {
            toolName: observation.toolName,
            repeats,
            input: excerpt(stableJson(observation.input) ?? "null"),
            output: excerpt(observation.output),
          }
        : null;
    },
    repeats: () => repeats,
    reset() {
      repeats = 0;
    },
    forget() {
      seen.length = 0;
      repeats = 0;
    },
  };
}

/**
 * What the model is handed in place of an answer it already has. The answer's first line is
 * quoted so the two can be matched by eye, and the count says how long this has gone on. The
 * ledger holds the full result of every call, this one included.
 */
export function repeatedAnswerNotice(toolName: string, output: string, repeats: number): string {
  return (
    `[harness notice: already answered] This ${toolName} call is identical to one answered ` +
    `earlier in this conversation (${repeats === 1 ? "once" : `${repeats} times`} now), and its ` +
    `result is unchanged; it began: ${JSON.stringify(excerpt(output))}. The full result is above. ` +
    "Nothing in the workspace changed since. Act on the answer you have: make the edit it calls " +
    "for, try a different approach, or finish with a summary that names exactly what is blocking you."
  );
}

function observationKey(observation: ToolObservation): string {
  const output = observation.output.replace(evidenceTrailer, "");
  return [
    observation.toolName,
    stableJson(observation.input),
    observation.failed ? "failed" : "ok",
    String(output.length),
    fingerprint(output),
  ].join("\u0000");
}

/** JSON with object keys in one order, so `{a,b}` and `{b,a}` are the same call. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

/**
 * Two independent 32-bit FNV-1a hashes over the text, as one 64-bit-ish fingerprint. Not a
 * cryptographic digest and not meant as one: a collision here reads a changed result as
 * unchanged once, which costs one repeat count, and the alternative is keeping the result.
 */
function fingerprint(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ (code + index), 0x01000193) >>> 0;
  }
  return `${a.toString(16)}${b.toString(16)}`;
}

/**
 * What the model is told, once. Attributed to the harness in the text itself because it travels
 * as a conversation message, the only channel the loop has into the next turn, and a message
 * there is not a user instruction and grants nothing.
 */
export const stallNoticePrefix = "[harness notice: repeated tool calls]";

export function stallNotice(stall: StallDetected): string {
  return (
    `${stallNoticePrefix} The last ${stall.repeats + 1} ${stall.toolName} calls were calls ` +
    "you had already made, with results you had already received, and nothing in the workspace " +
    `changed between them. The repeated call was ${stall.toolName} ${stall.input} and its ` +
    `answer each time began: ${JSON.stringify(stall.output)}. Repeating it again will not change ` +
    "the answer: a search that matched nothing names something that is not in this workspace, " +
    "so stop looking for it and work from the files you have already read. Act on the result " +
    "you have: make the edit it calls for, try a different approach, or finish with a summary " +
    "that names exactly what is blocking you. Repeating already-answered calls again ends this loop."
  );
}
