import { expect, it } from "vitest";
import {
  batchSeed,
  generateDomainInputs,
  generatedBatches,
  relationInputs,
  taskCodeStatements,
} from "./task-code-statements.ts";

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
  // Twelve seeds already inside the domain do not crowd out the one carried into it.
  const inside = Array.from({ length: 12 }, (_, index) => `/p${index}?k=${index}`);
  expect(relationInputs([...inside, "file:///C:/x"], { contains: "?" })).toContain(
    "file:///C:/x?k=0",
  );
  expect(relationInputs(["a", "b"], null)).toEqual(["a", "b"]);
  expect(
    relationInputs(
      Array.from({ length: 20 }, (_, index) => `s${index}`),
      null,
    ),
  ).toHaveLength(12);
});

it("reads a callback the task says is called once for each entry of an existing function's answer", () => {
  const task =
    'Add pick(record: string, keep: (name: string, value: string) => boolean): string. Otherwise keep is called once for each field of fields(record), in that order, with the name and the value fields gives it, and pick(record, () => true) equals format(record) for every record that contains "=". Example: pick("a=1;b=2", (name) => name === "a") is "a=1".';
  const enumeration = taskCodeStatements(task).find((one) => one.kind === "enumeration");
  expect(enumeration).toMatchObject({
    id: "code-enumeration-1",
    subjectName: "pick",
    parameters: ["record", "keep"],
    callback: "keep",
    variable: "record",
    reference: "fields(record)",
    referenceName: "fields",
    arity: 2,
    ordered: true,
    domain: { contains: "=" },
  });
  // The relation in the same sentence gives its domain and its inputs.
  expect(enumeration?.kind === "enumeration" ? enumeration.inputs : []).toEqual(["a=1;b=2"]);
});

it("reads no enumeration without a declaration that takes both names, or with a required parameter it cannot fill", () => {
  expect(
    taskCodeStatements(
      "keep is called once for each field of fields(record). pick(record, keep) returns a string.",
    ).filter((one) => one.kind === "enumeration"),
  ).toEqual([]);
  expect(
    taskCodeStatements(
      "Add pick(record: string, keep: (name: string) => boolean, limit: number). keep is called once for each field of fields(record).",
    ).filter((one) => one.kind === "enumeration"),
  ).toEqual([]);
  // An optional parameter is left out of the call, and a key alone is compared where no value is stated.
  expect(
    taskCodeStatements(
      "Add pick(record: string, keep: (name: string, value: string) => boolean, limit?: number). keep is called once per field of fields(record).",
    ).find((one) => one.kind === "enumeration"),
  ).toMatchObject({ arity: 1, ordered: false, domain: null });
});

it("generates inputs inside the domain from the task's literals, reproducibly and apart from the excluded", () => {
  const seeds = ["/a?x=1&y=2#h", "file:///C:/x", "/b?k"];
  const options = { label: "discovery", seed: 7, count: 6, exclude: seeds } as const;
  const first = generateDomainInputs(seeds, { contains: "?" }, options);
  expect(generateDomainInputs(seeds, { contains: "?" }, options)).toEqual(first);
  expect(first).toMatchObject({ rule: "domain-inputs-v1", seed: 7, label: "discovery" });
  expect(first.inputs.length).toBeGreaterThan(0);
  expect(first.provenance).toHaveLength(first.inputs.length);
  for (const input of first.inputs) {
    expect(input).toContain("?");
    expect(seeds).not.toContain(input);
  }
  expect(new Set(first.inputs).size).toBe(first.inputs.length);
  expect(
    generateDomainInputs(seeds, { contains: "?" }, { ...options, seed: 8 }).inputs,
  ).not.toEqual(first.inputs);
  expect(generateDomainInputs(seeds, "unfollowed", options).inputs).toEqual([]);
});

it("keeps the validation batch apart from the task's inputs and the discovery batch", () => {
  const task =
    'Add drop(input, keep). drop(input, () => true) equals rebuild(input, {}) for every input that contains "?". Examples: drop("/a?x=1&y=2#f", (k) => k !== "x") is "/a?y=2#f", and drop("file:///C:/x", () => false) is "file:///C:/x".';
  const relation = taskCodeStatements(task).find((one) => one.kind === "relation");
  if (relation?.kind !== "relation") throw new Error("no relation read");
  const { discovery, validation } = generatedBatches(task, relation);
  expect(discovery.seed).toBe(batchSeed(task, relation.id, "discovery"));
  expect(validation.seed).toBe(batchSeed(task, relation.id, "validation"));
  expect(validation.seed).not.toBe(discovery.seed);
  for (const input of validation.inputs) {
    expect(relation.inputs).not.toContain(input);
    expect(discovery.inputs).not.toContain(input);
  }
  expect(validation.inputs.length).toBeGreaterThan(discovery.inputs.length);
});
