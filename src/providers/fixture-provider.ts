import {
  type ModelClient,
  type ModelPerformance,
  type ModelRequest,
  type ModelResponse,
  type ModelToolCall,
  unobservedPerformance,
} from "../core/model-client.ts";

/**
 * One scripted turn. A failure turn lets a test drive the loop's retry and
 * escalation paths without a flaky network.
 */
export type FixtureTurn =
  | { readonly kind: "response"; readonly response: ModelResponse }
  | { readonly kind: "failure"; readonly message: string };

export interface FixtureScript {
  readonly modelId: string;
  readonly turns: readonly FixtureTurn[];
}

interface FixtureModelClient extends ModelClient {
  /** Every request the loop made, in order, for assertions about what was sent. */
  readonly requests: readonly ModelRequest[];
}

export class FixtureExhaustedError extends Error {
  constructor(modelId: string, turnsPlayed: number) {
    super(
      `fixture model ${modelId} ran out of scripted turns after ${turnsPlayed}. ` +
        "Add another turn to the script, or tighten the budget so the loop stops sooner.",
    );
    this.name = "FixtureExhaustedError";
  }
}

export class FixtureFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureFailureError";
  }
}

/**
 * Replays a canned turn sequence. This is a first-class provider, not test-only
 * scaffolding: it is the deterministic substrate the loop, termination, and guard
 * tests run against. The replay command is a different thing: a record-to-text
 * renderer over a bundle's ledger, with no provider involved at all.
 */
export function createFixtureModelClient(script: FixtureScript): FixtureModelClient {
  const requests: ModelRequest[] = [];
  let played = 0;

  return {
    modelId: script.modelId,
    requests,
    async generate(request: ModelRequest): Promise<ModelResponse> {
      requests.push(request);
      const turn = script.turns[played];
      if (turn === undefined) {
        throw new FixtureExhaustedError(script.modelId, played);
      }
      played += 1;
      if (turn.kind === "failure") {
        throw new FixtureFailureError(turn.message);
      }
      return turn.response;
    },
  };
}

/** A turn the runtime cut off at the output cap: no text, no tool call, and nothing to read. */
export function respondTruncated(
  tokens = { input: 10, output: 8192 },
  performance: ModelPerformance = unobservedPerformance,
): FixtureTurn {
  return {
    kind: "response",
    response: {
      text: "",
      toolCalls: [],
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      finishReason: "length",
      performance,
      unsupportedFeatures: [],
    },
  };
}

export function respondWithText(
  text: string,
  tokens = { input: 10, output: 5 },
  performance: ModelPerformance = unobservedPerformance,
): FixtureTurn {
  return {
    kind: "response",
    response: {
      text,
      toolCalls: [],
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      finishReason: "stop",
      performance,
      unsupportedFeatures: [],
    },
  };
}

export function respondWithToolCalls(
  text: string,
  toolCalls: readonly ModelToolCall[],
  tokens = { input: 10, output: 5 },
  performance: ModelPerformance = unobservedPerformance,
): FixtureTurn {
  return {
    kind: "response",
    response: {
      text,
      toolCalls,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      finishReason: "tool-calls",
      performance,
      unsupportedFeatures: [],
    },
  };
}

export function failWith(message: string): FixtureTurn {
  return { kind: "failure", message };
}
