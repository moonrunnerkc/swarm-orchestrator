import type { ZodType } from "zod";
import type { $ZodIssue } from "zod/v4/core";

/**
 * OpenAI-compatible tool calling carries a call's arguments as one JSON string, and smaller
 * local models intermittently encode a nested array or object as a second JSON string inside
 * it: `{"files": "[\"README.md\"]"}` where the schema declares an array of strings. The value
 * is the one the model meant and only its encoding is wrong, so a strict parse rejects a call
 * that was, in substance, correct.
 *
 * Decoding is bounded by the declared schema and never widens it. A field is decoded only
 * where the schema itself reports that it wanted an array or an object and a string arrived,
 * the string parses as JSON, and the parsed value is of the type the schema asked for. The
 * result is then validated by that same schema at the chokepoint, so nothing skips validation.
 * A field the schema declares as a string is never touched, whatever it happens to contain.
 *
 * Only a decoding that makes the call valid is returned: a partial repair would produce a
 * denial about arguments the model never sent. What arrived is recorded either way, alongside
 * the names of the fields decoded, so a reviewer sees the model's encoding and the harness's
 * reading of it rather than only the latter.
 */

export interface DecodedToolArguments {
  /** What to validate and run. The value that arrived, identically, when nothing was decoded. */
  readonly input: unknown;
  /** Dotted paths of the decoded fields, in the order decoded. Empty when nothing was. */
  readonly decodedFields: readonly string[];
}

/** Decoding one layer can expose another, so rounds repeat; two is already beyond anything seen. */
const maxDecodeRounds = 4;

/** What a path of length zero is called, since the whole argument object has no field name. */
const wholeArgumentsField = "(arguments)";

type PathStep = string | number;

export function decodeStringifiedToolArguments(
  input: unknown,
  schema: ZodType,
): DecodedToolArguments {
  let candidate = input;
  const decodedFields: string[] = [];

  for (let round = 0; round <= maxDecodeRounds; round += 1) {
    const parsed = schema.safeParse(candidate);
    if (parsed.success) {
      return { input: candidate, decodedFields };
    }
    if (round === maxDecodeRounds) {
      break;
    }

    let progressed = false;
    for (const issue of parsed.error.issues) {
      const decoded = decodeIssue(candidate, issue);
      if (decoded === null) {
        continue;
      }
      candidate = decoded.input;
      decodedFields.push(decoded.field);
      progressed = true;
    }
    if (!progressed) {
      break;
    }
  }

  return { input, decodedFields: [] };
}

interface DecodedIssue {
  readonly input: unknown;
  readonly field: string;
}

function decodeIssue(root: unknown, issue: $ZodIssue): DecodedIssue | null {
  const expected = containerExpectedBy(issue);
  if (expected === null) {
    return null;
  }
  const path = pathOf(issue.path);
  if (path === null) {
    return null;
  }
  const encoded = valueAt(root, path);
  if (typeof encoded !== "string") {
    return null;
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(encoded);
  } catch {
    return null;
  }
  if (!isOfType(decoded, expected)) {
    return null;
  }

  return {
    input: withValueAt(root, path, decoded),
    field: path.length === 0 ? wholeArgumentsField : path.join("."),
  };
}

/** The container the schema says it wanted here, or null when it wanted something else. */
function containerExpectedBy(issue: $ZodIssue): "array" | "object" | null {
  if (issue.code !== "invalid_type") {
    return null;
  }
  if (issue.expected === "array") {
    return "array";
  }
  return issue.expected === "object" ? "object" : null;
}

/** Null for a path this cannot address, which a symbol key makes it: tool arguments are JSON. */
function pathOf(path: $ZodIssue["path"]): readonly PathStep[] | null {
  const steps: PathStep[] = [];
  for (const step of path) {
    if (typeof step !== "string" && typeof step !== "number") {
      return null;
    }
    steps.push(step);
  }
  return steps;
}

function isOfType(value: unknown, expected: "array" | "object"): boolean {
  if (expected === "array") {
    return Array.isArray(value);
  }
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(root: unknown, path: readonly PathStep[]): unknown {
  let current = root;
  for (const step of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    current = (current as Record<PathStep, unknown>)[step];
  }
  return current;
}

/** Copies the spine down to the replaced value, so what arrived is left as it arrived. */
function withValueAt(root: unknown, path: readonly PathStep[], value: unknown): unknown {
  const step = path[0];
  if (step === undefined) {
    return value;
  }
  const rest = path.slice(1);

  if (Array.isArray(root)) {
    const copy = [...(root as unknown[])];
    const index = Number(step);
    copy[index] = withValueAt(copy[index], rest, value);
    return copy;
  }
  if (typeof root === "object" && root !== null) {
    const copy = { ...(root as Record<string, unknown>) };
    const key = String(step);
    copy[key] = withValueAt(copy[key], rest, value);
    return copy;
  }
  return root;
}
