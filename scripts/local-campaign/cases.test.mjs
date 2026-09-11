import { expect, it } from "vitest";
import { authoredCaseSchema, caseTopics, testSource } from "./cases.mjs";
import { parseModelJson, sourceResponseSchema } from "./model.mjs";

it("keeps practice and evaluation case identities disjoint", () => {
  expect(new Set(caseTopics.map((entry) => entry.id)).size).toBe(10);
  expect(caseTopics.filter((entry) => entry.phase === "practice")).toHaveLength(2);
  expect(caseTopics.filter((entry) => entry.phase === "evaluation")).toHaveLength(8);
});
it("does not silently repair malformed model JSON or invent missing contracts", () => {
  expect(() => parseModelJson('{"source":', sourceResponseSchema)).toThrow();
  expect(() => authoredCaseSchema.parse({ specification: "missing implementations" })).toThrow();
  expect(
    parseModelJson('```json\n{"source":"export const solve=()=>1"}\n```', sourceResponseSchema)
      .source,
  ).toContain("solve");
});
it("serializes unusual input strings as literals rather than executable test source", () => {
  const text = "'; process.exit(0); //";
  expect(testSource([{ input: text, expected: text }])).toContain(JSON.stringify(text));
});
