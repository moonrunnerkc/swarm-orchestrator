import { readFile } from "node:fs/promises";
import type { ModelResponse } from "../../core/model-client.ts";
import type { FixtureTurn } from "../../providers/fixture-provider.ts";

/**
 * The two assistant turns that corrupted the calibration bundles of 2026-08-23 and 2026-08-24,
 * exactly as their ledgers recorded them, so a test replaying them replays the bundles and not
 * a guess at them. Neither carried text and neither carried a tool call.
 */
export interface RecordedEmptyTurn {
  readonly session: string;
  readonly sequence: number;
  readonly actor: string;
  readonly why: string;
  readonly finishReason: string;
  readonly response: {
    readonly text: string;
    readonly toolCalls: readonly [];
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly finishReason: string;
    readonly performance: ModelResponse["performance"];
  };
}

export async function recordedEmptyTurns(): Promise<readonly RecordedEmptyTurn[]> {
  const text = await readFile(new URL("./empty-assistant-turns.json", import.meta.url), "utf8");
  return (JSON.parse(text) as { turns: RecordedEmptyTurn[] }).turns;
}

/** The recorded turn as a fixture model would answer it. */
export function replayEmptyTurn(turn: RecordedEmptyTurn): FixtureTurn {
  return {
    kind: "response",
    response: { ...turn.response, toolCalls: [], unsupportedFeatures: [] },
  };
}
