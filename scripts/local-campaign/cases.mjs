import { z } from "zod";

const vectorSchema = z.object({ input: z.json(), expected: z.json() });
export const vectorsSchema = z.object({ checks: z.array(vectorSchema).min(6).max(16) });
export const authoredCaseSchema = z.object({
  specification: z.string().min(80).max(5000),
  reference: z.string().min(20).max(8000),
  counterexample: z.string().min(20).max(8000),
  publicChecks: z.array(vectorSchema).min(2).max(4),
});

export const caseTopics = [
  {
    id: "practice-clamp",
    phase: "practice",
    topic: "Clamp an integer to an inclusive range; reversed bounds are normalized.",
  },
  {
    id: "practice-count",
    phase: "practice",
    topic: "Count distinct strings without confusing object prototype names with ordinary keys.",
  },
  {
    id: "check-chunks",
    phase: "evaluation",
    topic:
      "Split a JSON array into chunks, preserving a final shorter chunk and defining invalid sizes.",
  },
  {
    id: "check-merge",
    phase: "evaluation",
    topic:
      "Merge overlapping or touching closed integer intervals, normalizing reversed endpoints and sorting the output.",
  },
  {
    id: "check-escape",
    phase: "evaluation",
    topic:
      "HTML-escape ampersand, less-than, greater-than, double quote and apostrophe exactly once in the original input.",
  },
  {
    id: "check-pages",
    phase: "evaluation",
    topic:
      "Paginate an array with one-based pages, define invalid page and size behavior, and report total pages.",
  },
  {
    id: "check-frequency",
    phase: "evaluation",
    topic:
      "Rank strings by descending frequency, breaking ties lexicographically with code-unit comparison.",
  },
  {
    id: "check-path",
    phase: "evaluation",
    topic:
      "Normalize a relative slash-separated path, handling dot segments, repeated slashes and parent segments without escaping the relative root.",
  },
  {
    id: "check-partition",
    phase: "evaluation",
    topic:
      "Partition integers into inclusive range matches and nonmatches, preserving original order and defining reversed bounds.",
  },
  {
    id: "check-rotate",
    phase: "evaluation",
    topic:
      "Rotate a JSON array by a signed integer offset, handle negative offsets and offsets larger than the length.",
  },
];

export function testSource(checks) {
  const verified = z.array(vectorSchema).min(1).parse(checks);
  return `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { solve } from './solution.mjs';\nconst vectors=${JSON.stringify(verified)};\nfor (const [index, entry] of vectors.entries()) test('vector '+index,()=>assert.deepStrictEqual(solve(structuredClone(entry.input)),entry.expected));\n`;
}

export function authorPrompt(topic) {
  return `Design one precise synthetic JavaScript task about: ${topic}. Use only JSON-compatible inputs and outputs. The implementation is a synchronous named export solve(input) in solution.mjs. No imports, I/O, timers or dependencies. Specify the exact input object fields, all edge behavior, and output representation. Return JSON with specification (complete plain-language contract), reference (correct source), counterexample (source that deliberately omits one named requirement while passing the public examples), publicChecks (2 to 4 objects with input and expected). Choose public examples that the counterexample passes. Do not put the missing requirement's distinguishing input in publicChecks. Keep source small and avoid comments. All exceptions must instead be represented as an explicitly specified JSON value. Do not leave any behavior needed by your examples unspecified.`;
}

export function checkerPrompt(specification) {
  return `Write independent acceptance examples from this specification alone. You have not been shown reference source, public tests, counterexamples, or candidate outputs. Return JSON {"checks":[{"input":...,"expected":...},...]} with 8 to 12 deterministic cases covering EVERY stated clause, boundaries and empty inputs. Follow the specified JSON representation exactly.\n${specification}`;
}
