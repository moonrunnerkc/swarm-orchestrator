import { describe, expect, it } from "vitest";
import { articleFor, type TaskClass, taskClasses } from "./task-class.ts";

describe("the article in front of a class name", () => {
  it("says an edit task, not a edit task", () => {
    // What a routing line read before this: "has never been tried on a edit task".
    expect(articleFor("edit")).toBe("an");
  });

  it("says a for the classes that open on a consonant", () => {
    for (const taskClass of ["multi-file", "test-fix", "tool-heavy"] satisfies TaskClass[]) {
      expect(articleFor(taskClass)).toBe("a");
    }
  });

  it("answers for every class the router can route", () => {
    for (const taskClass of taskClasses) {
      expect(["a", "an"]).toContain(articleFor(taskClass));
    }
  });
});
