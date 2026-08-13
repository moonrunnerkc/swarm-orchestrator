import { createHash } from "node:crypto";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export class NonCanonicalValueError extends Error {
  constructor(detail: string) {
    super(
      `${detail}. Ledger payloads must serialize to canonical JSON; convert the value first, ` +
        "for example with asJsonValue.",
    );
    this.name = "NonCanonicalValueError";
  }
}

/** A content digest as it appears everywhere in the ledger, bundle, and claims. */
export const digestPattern = /^sha256:[0-9a-f]{64}$/;

/**
 * Object keys sorted, no insignificant whitespace. Two structurally equal payloads must
 * produce identical bytes or content addressing and the hash chain both stop meaning
 * anything. The embedded verifier reimplements this function exactly.
 */
export function canonicalJson(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return raiseNonFinite(value);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  // Absent and present-but-undefined keys must hash alike, the way JSON.stringify treats
  // them, or a record built two ways would break its own chain link.
  const entries = Object.entries(value as { readonly [key: string]: JsonValue })
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => compareKeys(left, right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function digestOfBytes(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

export function digestOfJson(value: JsonValue): string {
  return digestOfBytes(canonicalJson(value));
}

/** Strips the algorithm prefix for use as a filename. */
export function digestFileName(digest: string): string {
  return `${digest.replace("sha256:", "")}.json`;
}

/**
 * Coerces arbitrary tool input into something recordable. Values with no JSON form become
 * their type tag rather than vanishing, because a payload that silently loses a field is
 * worse evidence than one that says the field was unrepresentable.
 */
export function asJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value !== "object") {
    return `[${typeof value}]`;
  }
  if (Array.isArray(value)) {
    return value.map(asJsonValue);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const converted: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) {
      converted[key] = asJsonValue(item);
    }
  }
  return converted;
}

/** Compares by UTF-16 code unit, the ordering the verifier's plain JS sort also uses. */
function compareKeys(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function raiseNonFinite(value: number): never {
  throw new NonCanonicalValueError(`${String(value)} has no JSON representation`);
}
