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

describe("planning a later layer of a graph", () => {
  it("continues the worker numbering, so two layers never share a branch name", () => {
    const first = planAttempts(tasks, 2, "ollama:qwen");
    const second = planAttempts(["a third"], 2, "ollama:qwen", {
      tasks: tasks.length,
      workers: first.length,
    });

    expect(second.map((one) => one.workerId)).toEqual(["worker-5", "worker-6"]);
  });

  it("continues the task numbering, so a later layer's task is not the first layer's", () => {
    const second = planAttempts(["a third"], 1, "ollama:qwen", { tasks: 2, workers: 2 });

    expect(second[0]?.taskId).toBe("task-3");
  });

  it("numbers from the start when nothing has been planned yet", () => {
    expect(planAttempts(tasks, 1, "ollama:qwen", { tasks: 0, workers: 0 })).toEqual(
      planAttempts(tasks, 1, "ollama:qwen"),
    );
  });
});
