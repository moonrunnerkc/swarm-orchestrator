import { expect, it } from "vitest";
import { taskBrief } from "./task-brief.ts";

it("leaves the uncontracted single-worker task bytes unchanged", () => {
  const task = "Preserve exact whitespace.\n  Read this task.\n";
  expect(taskBrief(task)).toBe(task);
});
