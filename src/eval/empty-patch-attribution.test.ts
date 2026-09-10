import { describe, expect, it } from "vitest";
import { readAnEmptyPatch } from "./empty-patch-attribution.ts";

describe("what an empty patch is attributable to", () => {
  /**
   * The ordinary case, and the one the corpus already learned to record: the model ran and wrote
   * nothing, which is a model failure and belongs in the denominator as one.
   */
  it("charges an empty patch to the model where the endpoint answered afterwards", () => {
    const reading = readAnEmptyPatch({ endpointAnswered: true, endpointDetail: "" });

    expect(reading.attributable).toBe(true);
    expect(reading.detail).toContain("wrote nothing");
  });

  /**
   * The case that produced this rule. An MLX server ran out of GPU memory mid-batch and every
   * task after it came back with a zero-byte patch, recorded as the model failing. That is the
   * same misattribution the corpus was bitten by in the other direction, when twelve rows the
   * agent had failed were recorded as an oracle nobody could run.
   */
  it("refuses to charge an empty patch to the model where the endpoint did not answer", () => {
    const reading = readAnEmptyPatch({
      endpointAnswered: false,
      endpointDetail: "connect ECONNREFUSED 127.0.0.1:8000",
    });

    expect(reading.attributable).toBe(false);
    expect(reading.detail).toContain("ECONNREFUSED");
    expect(reading.detail).not.toContain("wrote nothing");
  });

  it("says what a reader should do about an unreachable endpoint", () => {
    const reading = readAnEmptyPatch({ endpointAnswered: false, endpointDetail: "no answer" });

    expect(reading.detail).toContain("says nothing about the model");
  });
});
