import { describe, expect, it } from "vitest";
import { seedForRepeat } from "../select/calibration-run.ts";
import { planAttempts } from "./fan-out.ts";

const tasks = ["add a shout", "add a whisper"];

describe("planning the fan-out", () => {
  it("is one worker per task, named as it is today, when nothing is tried twice", () => {
    const planned = planAttempts(tasks, 1, "ollama:qwen");

    expect(planned.map((one) => one.workerId)).toEqual(["worker-1", "worker-2"]);
    expect(planned.map((one) => one.task)).toEqual(tasks);
  });

  it("passes no sampling at all when nothing is tried twice", () => {
    const planned = planAttempts(tasks, 1, "ollama:qwen");

    expect(planned.every((one) => one.sampling === null)).toBe(true);
  });

  it("keeps a task's attempts together and numbers the workers straight through", () => {
    const planned = planAttempts(tasks, 3, "ollama:qwen");

    expect(planned.map((one) => one.workerId)).toEqual([
      "worker-1",
      "worker-2",
      "worker-3",
      "worker-4",
      "worker-5",
      "worker-6",
    ]);
    expect(planned.map((one) => one.taskId)).toEqual([
      "task-1",
      "task-1",
      "task-1",
      "task-2",
      "task-2",
      "task-2",
    ]);
    expect(planned.map((one) => one.attemptIndex)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("gives every attempt at one task a different seed, so they are separate samples", () => {
    const seeds = planAttempts(tasks, 3, "ollama:qwen")
      .filter((one) => one.taskId === "task-1")
      .map((one) => one.sampling?.seed);

    expect(new Set(seeds).size).toBe(3);
  });

  it("derives the seed from the task and the model, so a report can re-derive it", () => {
    const planned = planAttempts(tasks, 2, "ollama:qwen");

    expect(planned[0]?.sampling?.seed).toBe(seedForRepeat("task-1", "ollama:qwen", 0));
    expect(planned[1]?.sampling?.seed).toBe(seedForRepeat("task-1", "ollama:qwen", 1));
  });

  it("samples above zero, because a temperature of zero would give one answer twice", () => {
    const planned = planAttempts(tasks, 2, "ollama:qwen");

    expect(planned[0]?.sampling?.temperature).toBeGreaterThan(0);
  });

  it("plans nothing from no tasks", () => {
    expect(planAttempts([], 3, "ollama:qwen")).toEqual([]);
  });
});
