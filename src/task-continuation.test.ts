import { describe, expect, it } from "vitest";
import { taskContinuation } from "./task-continuation.ts";

describe("the continuation owed to a task loop stopped at its step limit", () => {
  it("names the limit, holds the attempt to the task's own words, and hardcodes no deliverable", () => {
    const owed = taskContinuation({ task: "add a shout helper", steps: 40, maxSteps: 40 });
    expect(owed.brief).toContain("stopped at its step limit (40 of 40 steps)");
    expect(owed.brief).toContain("every deliverable it names");
    expect(owed.brief).toContain("Do not redo what is done");
    expect(owed.brief).toContain("say so in one line and make no edit");
    expect(owed.brief).toContain("no test is weakened");
    // The task text travels in the attempt's brief beside this, not inside it; nothing here names
    // a project, a file, a test runner or a kind of change.
    expect(owed.brief).not.toContain("add a shout helper");
    expect(owed.brief).not.toMatch(/sinon|regression test|\.js|npm/i);
  });

  it("has an identity that covers the task under its step cap, so one run owes it once", () => {
    const first = taskContinuation({ task: "add a shout helper", steps: 40, maxSteps: 40 });
    const again = taskContinuation({ task: "add a shout helper", steps: 40, maxSteps: 40 });
    const other = taskContinuation({ task: "add a whisper helper", steps: 40, maxSteps: 40 });
    expect(first.identity).toBe(again.identity);
    expect(first.identity).not.toBe(other.identity);
    expect(first.identity).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
