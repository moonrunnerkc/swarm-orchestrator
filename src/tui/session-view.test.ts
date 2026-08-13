import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { describeLoopEvent } from "./plain-lines.ts";
import { applyLoopEvent, emptySessionView, type SessionView } from "./session-view.ts";

function project(events: readonly LoopEvent[]): SessionView {
  return events.reduce(applyLoopEvent, emptySessionView);
}

describe("session view projection", () => {
  it("fills the plan pane from the plan event", () => {
    const view = project([{ type: "plan", text: "read, then edit" }]);
    expect(view.plan).toBe("read, then edit");
    expect(view.status).toBe("planning");
  });

  it("appends the action stream in the order the loop reported it", () => {
    const view = project([
      { type: "tool-call", callId: "a", toolName: "read", input: { path: "x.ts" } },
      { type: "tool-outcome", callId: "a", toolName: "read", failed: false, output: "body" },
    ]);

    expect(view.actions).toEqual(["read path=x.ts", "read ok: body"]);
  });

  it("marks a completion claim as unverified rather than done", () => {
    const view = project([{ type: "claim", text: "all tests pass", verified: false }]);
    expect(view.status).toBe("claim recorded, unverified");
    expect(view.finished).toBe(false);
  });

  it("finishes only on the harness stop event", () => {
    const view = project([{ type: "stopped", reason: "max-steps", steps: 4, tokensUsed: 120 }]);
    expect(view.finished).toBe(true);
    expect(view.status).toContain("max-steps");
  });
});

describe("plain line fallback", () => {
  it("renders one line per event when there is no TTY", () => {
    expect(describeLoopEvent({ type: "model-call", step: 2, modelId: "fixture:a" })).toBe(
      "step 2: calling fixture:a",
    );
    expect(
      describeLoopEvent({
        type: "tool-outcome",
        callId: "a",
        toolName: "read",
        failed: true,
        output: "denied: .env",
      }),
    ).toBe("tool read failed: denied: .env");
  });

  it("labels a claim as unverified in plain output too", () => {
    expect(describeLoopEvent({ type: "claim", text: "done", verified: false })).toBe(
      "claim (unverified): done",
    );
  });

  it("says nothing for an empty plan", () => {
    expect(describeLoopEvent({ type: "plan", text: "" })).toBeNull();
  });
});
