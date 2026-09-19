import { describe, expect, it } from "vitest";
import { readAnEmptyPatch } from "./empty-patch-attribution.ts";
import { attributeInvocation } from "./endpoint-health.ts";

const generating = attributeInvocation({
  probe: { generates: true, failure: null, detail: "" },
});
const notGenerating = (detail: string) =>
  attributeInvocation({ probe: { generates: false, failure: "unreachable", detail } });

describe("what an empty patch is attributable to", () => {
  /**
   * The ordinary case, and the one the corpus already learned to record: the model ran and wrote
   * nothing, which is a model failure and belongs in the denominator as one.
   */
  it("charges an empty patch to the model where the endpoint generated afterwards", () => {
    const reading = readAnEmptyPatch(generating);

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
    const reading = readAnEmptyPatch(notGenerating("connect ECONNREFUSED 127.0.0.1:8000"));

    expect(reading.attributable).toBe(false);
    expect(reading.detail).toContain("ECONNREFUSED");
    expect(reading.detail).not.toContain("wrote nothing");
  });

  it("says what a reader should do about an unreachable endpoint", () => {
    const reading = readAnEmptyPatch(notGenerating("no answer"));

    expect(reading.detail).toContain("says nothing about the model");
  });

  it("refuses where the endpoint recovered and no model call of the invocation was answered", () => {
    const reading = readAnEmptyPatch(
      attributeInvocation({
        probe: { generates: true, failure: null, detail: "" },
        calls: { modelCalls: 1, failedCalls: 1 },
      }),
    );

    expect(reading.attributable).toBe(false);
    expect(reading.detail).toContain("none of the invocation's 1 model call(s) was answered");
  });
});
