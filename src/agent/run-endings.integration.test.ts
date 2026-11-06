import { describe, expect, it } from "vitest";
import { type ModelClient, ModelError } from "./model.ts";
import { fixture, write } from "./test-doubles.ts";

/** A change that is not the fix: the run goes on past it, to whatever ends it. */
const wip = write("NOTES.md", "half: work in progress");

describe("a run that ends before the task is done", () => {
  it("finalizes the tree a provider failure leaves", async () => {
    const probe = await fixture();
    let turns = 0;
    const failing: ModelClient = {
      model: "failing",
      async complete() {
        turns += 1;
        if (turns === 1)
          return {
            content: wip,
            inputTokens: 9,
            outputTokens: 1,
            inferenceMs: 1,
            retries: 0,
            truncated: false,
          };
        throw new ModelError("HTTP 500: overloaded (three attempts in a row)", 2);
      },
    };
    const ran = await probe.run(failing);
    expect(ran.stop).toBe("model-error");
    // The failed turn's own retries are counted with the rest.
    expect(ran.report.resources.retries).toBe(2);
    expect(ran.report.verification).toBe("fresh");
    expect(ran.result?.change.files).toEqual([{ path: "NOTES.md", status: "added" }]);
  });

  it("writes an incomplete report bound to the tree when the run is cancelled", async () => {
    const probe = await fixture();
    const controller = new AbortController();
    let turns = 0;
    const cancelling: ModelClient = {
      model: "cancelling",
      async complete() {
        turns += 1;
        if (turns === 1)
          return {
            content: wip,
            inputTokens: 9,
            outputTokens: 1,
            inferenceMs: 1,
            retries: 0,
            truncated: false,
          };
        controller.abort(new Error("interrupted"));
        throw controller.signal.reason;
      },
    };
    const ran = await probe.run(cancelling, { signal: controller.signal });
    expect(ran.stop).toBe("cancelled");
    expect(ran.report).toMatchObject({ state: "incomplete", verification: "not run" });
    expect(ran.report.snapshot.patchSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(ran.report.requirements[0]?.limitation).toBe(
      "final verification did not run: the run was cancelled",
    );
  });
});
