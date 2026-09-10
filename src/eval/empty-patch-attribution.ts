/**
 * Whether an empty patch says anything about the model.
 *
 * A run that produced no patch is a model failure and belongs in the denominator as one. That is
 * what the corpus already learned, the expensive way: twelve rows the agent had failed on were
 * recorded as an oracle nobody could run, which reported a sixth of the corpus as an instrument
 * problem instead of a model one.
 *
 * This is the same mistake running the other way, and it was measured rather than imagined. An MLX
 * server ran out of GPU memory mid-batch, in `mx.eval` over its own prompt cache, and every task
 * after it came back with a zero-byte patch and was recorded as the model writing nothing. An
 * endpoint that is not answering says nothing about a model, so nothing is what gets recorded.
 *
 * The residual, named rather than implied away: the probe is one sample taken after the run, so a
 * run that failed on a transient error and then recovered is still charged to the model. What it
 * catches is an endpoint that stayed down, which is the shape the outage above had and the shape
 * that corrupts a batch rather than a row. Measured on the task the outage first hit: re-run
 * against a live endpoint, `koajs/koa#1910` produced nothing again, so that row is the model.
 */
export interface EmptyPatchReading {
  /** Whether the emptiness can be charged to the model at all. */
  readonly attributable: boolean;
  readonly detail: string;
}

export function readAnEmptyPatch(input: {
  /** Whether the model endpoint answered a trivial request after the run finished. */
  readonly endpointAnswered: boolean;
  /** What came back instead, where it did not answer. */
  readonly endpointDetail: string;
}): EmptyPatchReading {
  if (input.endpointAnswered) {
    return {
      attributable: true,
      detail: "the agent wrote nothing, so there is no patch to judge",
    };
  }
  return {
    attributable: false,
    detail:
      `the model endpoint did not answer after the run, so an empty patch says nothing about ` +
      `the model: ${input.endpointDetail}. Nothing is recorded for this task. Fix the endpoint ` +
      `and run it again.`,
  };
}
