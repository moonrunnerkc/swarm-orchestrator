/**
 * Whether an assistant turn carried anything, decided by the harness at the boundary where the
 * turn becomes a ledger record, and therefore part of a bundle.
 *
 * This is not the model's account of itself and cannot be: the input is the assembled response,
 * and the verdict is a predicate over it that the model has no way to write. It exists because
 * an empty turn and a worked turn are indistinguishable once a run is summarised. Two
 * calibration bundles were scored with empty turns folded in, and a repeat that measured
 * nothing about a model was counted against that model exactly as a wrong answer would be.
 *
 * A tool call is content. A turn that says nothing and calls `read` did work, and reading the
 * text alone would call it empty.
 */

/** Why a turn carried nothing. Machine-readable, so a report never has to parse a sentence. */
export type EmptyTurnReason =
  | "no-content"
  | "whitespace-only-text"
  | "output-cap-without-content"
  | "call-failed";

export type TurnContent =
  | { readonly valid: true; readonly reason: null }
  | { readonly valid: false; readonly reason: EmptyTurnReason };

/** What the classifier reads. Deliberately the assembled response and nothing around it. */
export interface AssistantTurn {
  readonly text: string;
  readonly toolCalls: readonly unknown[];
  readonly finishReason: string;
}

const valid: TurnContent = { valid: true, reason: null };

export function classifyTurnContent(turn: AssistantTurn): TurnContent {
  if (turn.toolCalls.length > 0 || turn.text.trim().length > 0) {
    return valid;
  }
  // The cap named separately from the silence: a turn that spent every token it had and a turn
  // that arrived with nothing want different responses, and the content alone cannot tell them
  // apart. This is the same distinction the loop draws between output-cap and empty-response.
  if (turn.finishReason === "length") {
    return { valid: false, reason: "output-cap-without-content" };
  }
  if (turn.text.length > 0) {
    return { valid: false, reason: "whitespace-only-text" };
  }
  return { valid: false, reason: "no-content" };
}

/** The verdict for a call that raised before any turn existed. */
export const callFailedTurn: TurnContent = { valid: false, reason: "call-failed" };
