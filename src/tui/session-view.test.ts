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

    expect(view.actions.map((row) => row.summary)).toEqual(["read path=x.ts", "read ok: body"]);
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

describe("the gate strip", () => {
  it("carries the ledger record each gate verdict was written from", () => {
    const view = project([
      {
        type: "gate",
        gateId: "tests",
        status: "failed",
        blocking: true,
        detail: "12 collected, 1 failed",
        record: "sha256:aaa",
      },
    ]);

    expect(view.gates).toEqual([
      {
        gateId: "tests",
        status: "failed",
        blocking: true,
        detail: "12 collected, 1 failed",
        record: "sha256:aaa",
      },
    ]);
  });

  it("replaces a gate's line on a later run rather than stacking a second one", () => {
    const view = project([
      {
        type: "gate",
        gateId: "tests",
        status: "failed",
        blocking: true,
        detail: "red",
        record: "sha256:a",
      },
      {
        type: "gate",
        gateId: "lint",
        status: "passed",
        blocking: true,
        detail: "ok",
        record: "sha256:b",
      },
      {
        type: "gate",
        gateId: "tests",
        status: "passed",
        blocking: true,
        detail: "green",
        record: "sha256:c",
      },
    ]);

    expect(view.gates.map((gate) => [gate.gateId, gate.status])).toEqual([
      ["tests", "passed"],
      ["lint", "passed"],
    ]);
  });

  it("counts attempts and marks an escalation as finished", () => {
    const view = project([
      { type: "attempt", attempt: 2, cap: 3 },
      {
        type: "ratchet",
        attempt: 2,
        accepted: false,
        detail: "assertions fell",
        record: "sha256:d",
      },
      { type: "escalated", gateId: "tests", detail: "still red", attempts: 3 },
    ]);

    expect(view.attempt).toEqual({ current: 2, cap: 3 });
    expect(view.actions.map((row) => row.summary)).toContain("ratchet rejected: assertions fell");
    expect(view.escalated).toBe(true);
    expect(view.finished).toBe(true);
    expect(view.status).toContain("escalated at the tests gate");
  });

  it("shows a not-applicable gate as its own state, never as a pass", () => {
    const view = project([
      {
        type: "gate",
        gateId: "format",
        status: "not-applicable",
        blocking: true,
        detail: "package.json declares no check-only format script",
        record: "sha256:e",
      },
    ]);

    expect(view.gates[0]?.status).toBe("not-applicable");
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

  it("names the record a gate verdict came from", () => {
    expect(
      describeLoopEvent({
        type: "gate",
        gateId: "placeholder",
        status: "failed",
        blocking: true,
        detail: "1 marker introduced",
        record: "sha256:abc",
      }),
    ).toBe("gate placeholder failed: 1 marker introduced [evidence record sha256:abc]");
  });

  it("labels an advisory gate as advisory", () => {
    expect(
      describeLoopEvent({
        type: "gate",
        gateId: "diff-budget",
        status: "failed",
        blocking: false,
        detail: "over budget",
        record: "sha256:abc",
      }),
    ).toContain("(advisory)");
  });
});

describe("what an expanded row can show", () => {
  it("keeps the whole tool input beside the one-line summary", () => {
    const view = project([
      {
        type: "tool-call",
        callId: "a",
        toolName: "edit",
        input: { path: "src/parse.ts", find: "a", replace: "b" },
      },
    ]);

    expect(view.actions[0]?.summary).toBe("edit path=src/parse.ts find=a replace=b");
    expect(JSON.parse(view.actions[0]?.detail ?? "null")).toEqual({
      path: "src/parse.ts",
      find: "a",
      replace: "b",
    });
  });

  it("keeps every line of a tool's output, not only the first", () => {
    const view = project([
      {
        type: "tool-outcome",
        callId: "a",
        toolName: "shell",
        failed: true,
        output: "1 failing\nAssertionError: expected 2 to be 3",
      },
    ]);

    expect(view.actions[0]?.summary).toBe("shell failed: 1 failing");
    expect(view.actions[0]?.detail).toBe("1 failing\nAssertionError: expected 2 to be 3");
    expect(view.actions[0]?.failed).toBe(true);
  });

  it("carries the ledger record a ratchet row was written from", () => {
    const view = project([
      { type: "ratchet", attempt: 1, accepted: true, detail: "held", record: "sha256:r" },
    ]);

    expect(view.actions[0]?.record).toBe("sha256:r");
  });
});

describe("the counters the header shows", () => {
  it("counts steps, the model, and both ratchet outcomes from the events alone", () => {
    const view = project([
      { type: "model-call", step: 1, modelId: "local:qwen3-coder:30b-a3b" },
      { type: "model-call", step: 2, modelId: "local:qwen3-coder:30b-a3b" },
      { type: "ratchet", attempt: 1, accepted: false, detail: "fell", record: "sha256:a" },
      { type: "ratchet", attempt: 2, accepted: true, detail: "held", record: "sha256:b" },
    ]);

    expect(view.modelId).toBe("local:qwen3-coder:30b-a3b");
    expect(view.steps).toBe(2);
    expect(view.ratchetRejected).toBe(1);
    expect(view.ratchetAccepted).toBe(1);
  });

  it("has no token count until the harness reports one, and never invents one", () => {
    const running = project([{ type: "model-call", step: 3, modelId: "fixture:a" }]);
    expect(running.tokensUsed).toBe(0);

    const stopped = project([
      { type: "model-call", step: 3, modelId: "fixture:a" },
      { type: "stopped", reason: "completed", steps: 3, tokensUsed: 902 },
    ]);
    expect(stopped.tokensUsed).toBe(902);
  });
});
