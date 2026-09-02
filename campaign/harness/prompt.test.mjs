import { describe, expect, it } from "vitest";
import { taskPrompt } from "./prompt.mjs";

describe("the task prompt", () => {
  it("names the command to run, what passing is, and the NOT-DONE fallback", () => {
    const prompt = taskPrompt("go test ./...");

    expect(prompt).toContain("Run `go test ./...`");
    expect(prompt).toContain("so that the same command passes");
    expect(prompt).toContain("reply NOT-DONE");
    expect(prompt).toContain("Do not edit, delete, skip or weaken any test");
  });

  it("never names where the defect is", () => {
    expect(taskPrompt("npm run --silent test")).not.toMatch(/line \d|\.go\b|\.py\b|\.js\b/);
  });
});
