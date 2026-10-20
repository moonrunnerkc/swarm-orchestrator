import { describe, expect, it } from "vitest";
import { createStallWatch, inferenceDeadlineMs, pollStallWatch } from "./stall.mjs";

const event = (body) =>
  `${JSON.stringify({ schema: "swarm.event.v1", runId: "r", event: body })}\n`;

describe("the stall watch", () => {
  it("opens a request at model-call, keeps it open while text streams, closes it at any other event, and names a stall past the deadline", () => {
    let clock = 1_000;
    const watch = createStallWatch({ deadlineMs: 5_000, now: () => clock });
    expect(watch.state()).toMatchObject({ open: null, stalled: null });

    watch.observe(event({ type: "model-call", step: 3, modelId: "m" }));
    expect(watch.state()).toMatchObject({
      open: { step: 3, startedAt: 1_000 },
      quietMs: 0,
      stalled: null,
    });
    clock = 4_000;
    watch.observe(event({ type: "model-text", step: 3, text: "I" }));
    clock = 8_500;
    // 4.5 s since the last text: not yet a stall, though 7.5 s since the call started.
    expect(watch.state()).toMatchObject({ quietMs: 4_500, stalled: null });
    clock = 9_100;
    expect(watch.state().stalled).toBe(
      "the arm's model call at step 3 has had no answer for 5 s, past the declared request deadline of 5 s",
    );
    watch.observe(event({ type: "tool-call", callId: "c", toolName: "shell", input: {} }));
    expect(watch.state()).toMatchObject({ open: null, stalled: null });
    expect(watch.state().lastEvent).toMatchObject({ type: "tool-call" });
  });

  it("reads a retried request as a new request on the same step, and the final error as the request closing", () => {
    let clock = 0;
    const watch = createStallWatch({ deadlineMs: 1_000, now: () => clock });
    watch.observe(event({ type: "model-call", step: 1, modelId: "m" }));
    clock = 900;
    watch.observe(
      event({ type: "model-error", step: 1, message: "cut off mid-answer", willRetry: true }),
    );
    clock = 1_800;
    expect(watch.state()).toMatchObject({
      open: { step: 1, retries: 1 },
      quietMs: 900,
      stalled: null,
    });
    clock = 2_000;
    expect(watch.state().stalled).toMatch(/step 1 \(retry 1\) has had no answer for 1 s/);
    watch.observe(
      event({ type: "model-error", step: 1, message: "did not return", willRetry: false }),
    );
    expect(watch.state()).toMatchObject({ open: null, stalled: null });
  });

  it("holds a partial line until its newline, and ignores lines that are not the product's events", () => {
    const watch = createStallWatch({ deadlineMs: 1_000, now: () => 0 });
    const line = event({ type: "model-call", step: 1, modelId: "m" });
    watch.observe(Buffer.from(line.slice(0, 20)));
    expect(watch.state().open).toBeNull();
    watch.observe(Buffer.from(line.slice(20)));
    expect(watch.state().open).toMatchObject({ step: 1 });
    watch.observe("✓ repository ready\n{not json\n");
    watch.observe(`${JSON.stringify({ schema: "other", event: { type: "stopped" } })}\n`);
    expect(watch.state().open).toMatchObject({ step: 1 });
    watch.observe(event({ type: "stopped", reason: "completed", steps: 1, tokensUsed: 1 }));
    expect(watch.state().open).toBeNull();
  });

  it("polls and reports a stall once, within one interval of the deadline", async () => {
    let clock = 0;
    const watch = createStallWatch({ deadlineMs: 50, now: () => clock });
    const seen = [];
    const stop = pollStallWatch(watch, {
      intervalMs: 10,
      now: () => clock,
      onStall: (reason, at) => seen.push({ reason, at }),
    });
    watch.observe(event({ type: "model-call", step: 2, modelId: "m" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toEqual([]);
    clock = 60;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toHaveLength(1);
    expect(seen[0].reason).toMatch(/step 2 has had no answer/);
    expect(seen[0].at).toBeInstanceOf(Date);
    clock = 200;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(seen).toHaveLength(1);
    stop();
  });

  it("declares three minutes by default, above every healthy latency the ordinary launch recorded", () => {
    expect(inferenceDeadlineMs).toBe(180_000);
    expect(inferenceDeadlineMs).toBeGreaterThan(17_793 * 5);
  });
});
