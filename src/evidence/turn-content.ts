/**
 * Whether an assistant turn carried anything, decided by the harness at the boundary where
 * the turn enters the ledger and so the bundle.
 *
 * A turn is model output, and "the model answered" is a claim about it. Reading that claim off
 * the turn's own text is fine only if something computes it: two calibration bundles recorded
 * runs as executed whose turns held nothing, because nothing between the transport and the
 * report ever asked whether the text was there. This is that question, asked once, in the one
 * place every recorded turn passes through, with a reason code rather than a boolean so an
 * abstention says which emptiness it was.
 */

export type EmptyTurnReason =
  /** Neither text nor a tool call arrived. */
  | "no-content"
  /** Text arrived and is entirely whitespace, with no tool call beside it. */
  | "whitespace-only-text"
  /** The call raised before a turn existed, so there is nothing to have been empty. */
  | "call-failed";

export interface TurnContent {
  /** Trimmed, because a turn of spaces is a turn of nothing. */
  readonly textCharacters: number;
  readonly toolCalls: number;
  readonly empty: boolean;
  /** Null exactly when the turn carried something. */
  readonly emptyReason: EmptyTurnReason | null;
}

/** What the classifier is given: the two fields of a turn that can carry content. */
export interface TurnShape {
  readonly text: string;
  readonly toolCalls: readonly unknown[];
}

export function classifyTurn(turn: TurnShape): TurnContent {
  const textCharacters = turn.text.trim().length;
  const toolCalls = turn.toolCalls.length;
  if (textCharacters > 0 || toolCalls > 0) {
    return { textCharacters, toolCalls, empty: false, emptyReason: null };
  }
  return {
    textCharacters,
    toolCalls,
    empty: true,
    // Whitespace and nothing are separated because they point at different layers: an
    // untrimmed turn means the backend emitted something, and no turn at all means it did not.
    emptyReason: turn.text.length > 0 ? "whitespace-only-text" : "no-content",
  };
}

/** A call that raised. No turn arrived, which is not the same as a turn that was empty. */
export const failedTurnContent: TurnContent = {
  textCharacters: 0,
  toolCalls: 0,
  empty: true,
  emptyReason: "call-failed",
};

/** The shape the ledger carries, flat so a predicate can reach each field. */
export function turnContentPayload(content: TurnContent): {
  textCharacters: number;
  toolCalls: number;
  empty: boolean;
  emptyReason: string | null;
} {
  return {
    textCharacters: content.textCharacters,
    toolCalls: content.toolCalls,
    empty: content.empty,
    emptyReason: content.emptyReason,
  };
}
