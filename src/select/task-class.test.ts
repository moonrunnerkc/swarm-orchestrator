import { describe, expect, it } from "vitest";
import { classifyTask, taskClasses } from "./task-class.ts";

describe("classifyTask", () => {
  it("covers the four strata the golden set is built from", () => {
    expect(taskClasses).toEqual(["edit", "multi-file", "test-fix", "tool-heavy"]);
  });

  it("reads a failing test as a test-fixing task", () => {
    expect(classifyTask("fix the failing test in parser.test.ts").taskClass).toBe("test-fix");
    expect(classifyTask("make the suite green again").taskClass).toBe("test-fix");
  });

  it("reads a sweep across the tree as a multi-file task", () => {
    expect(classifyTask("rename Widget to Gadget across the codebase").taskClass).toBe(
      "multi-file",
    );
    expect(classifyTask("migrate every caller to the new signature").taskClass).toBe("multi-file");
  });

  it("reads a question about the code as a tool-heavy task", () => {
    expect(classifyTask("find where the retry budget is configured").taskClass).toBe("tool-heavy");
    expect(classifyTask("investigate why the bundle is so large").taskClass).toBe("tool-heavy");
  });

  it("falls back to a plain edit, which is the common case", () => {
    expect(classifyTask("add a --version flag to the CLI").taskClass).toBe("edit");
    expect(classifyTask("").taskClass).toBe("edit");
  });

  it("names the rule that fired, so a routing record explains its own arm", () => {
    const classification = classifyTask("fix the failing test in parser.test.ts");

    expect(classification.rule).toMatch(/test/);
    expect(classifyTask("add a --version flag").rule).toMatch(/nothing more specific/);
  });

  it("prefers the more specific reading when a task could be read two ways", () => {
    // Ordered on purpose: a sweep that is described as fixing tests is a test-fixing task.
    expect(classifyTask("fix the tests that fail across every package").taskClass).toBe("test-fix");
  });

  it("does not depend on case or surrounding punctuation", () => {
    expect(classifyTask("FIND WHERE the budget lives!").taskClass).toBe("tool-heavy");
  });

  it("gives the same answer every time, because a routing arm is not a coin toss", () => {
    const once = classifyTask("rename Widget across the tree");
    const twice = classifyTask("rename Widget across the tree");

    expect(once).toEqual(twice);
  });
});
