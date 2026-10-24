import { expect, it } from "vitest";
import { relationInputs, taskCodeStatements } from "./task-code-statements.ts";

it("reads examples the task writes as code, each with its role", () => {
  const task =
    'Fix pad(text, width) so short text is padded: pad("ab", 4) is "ab  ". Today pad("ab", 4) returns "ab". What must not change: pad("abcd", 2) stays "abcd", and trim(" a ") still returns "a". When width is 0 (for example pad("x", 0) is "x") nothing is added.';
  const read = taskCodeStatements(task).map((one) =>
    one.kind === "example" ? [one.role, one.call, one.expected] : [one.kind],
  );
  expect(read).toEqual([
    ["requested", 'pad("ab", 4)', "ab  "],
    ["base", 'pad("ab", 4)', "ab"],
    ["preserve", 'pad("abcd", 2)', "abcd"],
    ["preserve", 'trim(" a ")', "a"],
    // Prose with a parenthesis ("is 0 (for example") is not a call; the example inside it is.
    ["requested", 'pad("x", 0)', "x"],
  ]);
});

it("reads a relation between two calls over one free name, with the domain it states", () => {
  const task =
    'Add drop(input, keep). drop(input, () => true) equals rebuild(input, {}) for every input that contains "?". Examples: drop("/a?x=1", (k) => k !== "x") is "/a", and drop("file:///C:/x", () => false) is "file:///C:/x".';
  const relation = taskCodeStatements(task).find((one) => one.kind === "relation");
  expect(relation).toMatchObject({
    subject: "drop(input, () => true)",
    reference: "rebuild(input, {})",
    subjectName: "drop",
    referenceName: "rebuild",
    variable: "input",
    domain: { contains: "?" },
  });
  // The task's own literal without a "?" is carried into the domain with the others' query.
  expect(relation?.kind === "relation" ? relation.inputs : []).toEqual([
    "/a?x=1",
    "file:///C:/x?x=1",
  ]);
});

it("keeps a domain it cannot follow as unfollowed, and reads no literal it would have to guess at", () => {
  const statements = taskCodeStatements(
    "norm(input) equals clean(input) for every valid URL. parse(text) gives [1, 2] and size(x) is not 3. keep(key, value) returns true.",
  );
  expect(statements).toHaveLength(1);
  expect(statements[0]).toMatchObject({ kind: "relation", domain: "unfollowed" });
});

it("carries seeds into a contains-domain and caps the inputs", () => {
  expect(relationInputs(["a?1", "b"], { contains: "?" })).toEqual(["a?1", "b?1"]);
  expect(relationInputs(["a", "b"], null)).toEqual(["a", "b"]);
  expect(
    relationInputs(
      Array.from({ length: 20 }, (_, index) => `s${index}`),
      null,
    ),
  ).toHaveLength(12);
});
