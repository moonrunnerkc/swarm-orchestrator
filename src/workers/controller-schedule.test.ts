import { expect, it } from "vitest";
import { readyTasks, type TaskState } from "./controller-schedule.ts";

it("releases a dependent without waiting for an unrelated running task", () => {
  const states = new Map<string, TaskState>([
    ["a", "accepted"],
    ["b", "running"],
    ["c", "pending"],
  ]);
  expect(
    readyTasks(
      [
        { id: "a", dependsOn: [], files: ["a.ts"] },
        { id: "b", dependsOn: [], files: ["b.ts"] },
        { id: "c", dependsOn: ["a"], files: ["c.ts"] },
      ],
      states,
    ),
  ).toEqual(["c"]);
});
it("holds overlapping pending work through candidate validation and refuses failed prerequisites", () => {
  const tasks = [
    { id: "a", dependsOn: [], files: ["shared.ts"] },
    { id: "b", dependsOn: [], files: ["shared.ts"] },
    { id: "c", dependsOn: ["d"], files: ["c.ts"] },
    { id: "d", dependsOn: [], files: ["d.ts"] },
  ];
  expect(
    readyTasks(
      tasks,
      new Map<string, TaskState>([
        ["a", "candidate"],
        ["b", "pending"],
        ["c", "pending"],
        ["d", "failed"],
      ]),
    ),
  ).toEqual([]);
});
