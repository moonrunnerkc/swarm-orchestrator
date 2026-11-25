import { fieldLabel, isCredentialName, isMetricName } from "swarm-verify/execution";
import type { JsonValue } from "./canonical-json.ts";
import { classifyValue, secretSpans } from "./secret-spans.ts";

export interface ScrubOutcome {
  readonly value: JsonValue;
  /** Pattern labels that fired, in the order they were applied. Recorded, never the match. */
  readonly redactions: readonly string[];
}

/**
 * Scrubs a payload before it is stored: every string in it, keys included, is scanned for known
 * credential shapes and credential assignments, and a value sitting under a credential-bearing
 * name is redacted whatever its JSON type. This is the one entry point, so there is one answer
 * for any input. Known-pattern scrubbing, not secret removal.
 */
export function scrubJson(value: JsonValue): ScrubOutcome {
  const redactions: string[] = [];
  return { value: scrubValue(value, "plain", redactions), redactions };
}

/**
 * How far a credential-bearing name reaches. `named` is the value that name was given, where
 * over-redacting costs nothing and anything but a measurement goes. `nested` is deeper inside
 * that value, where only credential-shaped material goes: `secrets: { ... }` is a container,
 * and blanking every string in it throws away evidence that is not the credential.
 */
type NameContext = "plain" | "named" | "nested";

function scrubValue(value: JsonValue, context: NameContext, redactions: string[]): JsonValue {
  if (typeof value === "string") {
    const before = redactions.length;
    const scrubbed = scrubText(value, redactions);
    if (redactions.length > before) return scrubbed;
    return redactedWhereCredential(value, context, redactions) ?? value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return redactedWhereCredential(String(value), context, redactions) ?? value;
  }
  if (Array.isArray(value)) return scrubArray(value, context, redactions);

  const scrubbed: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue })) {
    // A child is read under the key that survives into the output, so a second pass, which only
    // sees the scrubbed key, classifies it the same way.
    const name = scrubLines(key, redactions);
    scrubbed[name] = scrubValue(item, contextUnder(name, context), redactions);
  }
  return scrubbed;
}

/** A pass can uncover a match the span it replaced had covered, so each scan runs to a fixpoint. */
const scrubRounds = 8;

/**
 * A string's text. Where it is itself a JSON document (a command that printed a config file),
 * the structural walk reads it, since a line scan cannot see a name on one line and its value on
 * the next; anything else is scanned as lines. The original bytes come back where nothing was
 * found. Scrubbing can turn text that did not parse into text that does, so the choice is made
 * again each round until nothing changes.
 */
function scrubText(text: string, redactions: string[]): string {
  let current = text;
  for (let round = 0; round < scrubRounds; round += 1) {
    const parsed = jsonDocument(current);
    let next: string;
    if (parsed === undefined) next = scrubLines(current, redactions);
    else {
      const before = redactions.length;
      const walked = scrubValue(parsed, "plain", redactions);
      next = redactions.length === before ? current : JSON.stringify(walked);
    }
    if (next === current) break;
    current = next;
  }
  return current;
}

/** An object or an array. Anything else, malformed JSON included, reads as text. */
function jsonDocument(text: string): JsonValue | undefined {
  if (!/^\s*[[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

function scrubLines(text: string, redactions: string[]): string {
  let current = text;
  for (let round = 0; round < scrubRounds; round += 1) {
    const spans = secretSpans(current);
    if (spans.length === 0) return current;
    const parts: string[] = [];
    let cursor = 0;
    for (const span of spans) {
      parts.push(current.slice(cursor, span.start), `[redacted:${span.label}]`);
      redactions.push(span.label);
      cursor = span.end;
    }
    parts.push(current.slice(cursor));
    current = parts.join("");
  }
  return current;
}

/**
 * A metric is exempt by key wherever it sits, so a throughput figure under a credential-named
 * container is still a measurement. Otherwise a credential-bearing key opens the strict
 * context and everything under it stays in the looser one.
 */
function contextUnder(key: string, context: NameContext): NameContext {
  if (isMetricName(key)) return "plain";
  if (isCredentialName(key)) return "named";
  return context === "plain" ? "plain" : "nested";
}

/**
 * An array directly under a credential-bearing name is that credential written in pieces, so
 * its elements are judged joined and it is redacted whole. Deeper in, and under any other
 * name, the elements are walked instead: a secret split across fields nobody named as a
 * credential is outside a name-keyed detector by construction.
 */
function scrubArray(
  items: readonly JsonValue[],
  context: NameContext,
  redactions: string[],
): JsonValue {
  if (context === "named") {
    const joined = joinedLeaves(items);
    if (joined !== null && classifyValue(joined) !== "not-credential") {
      redactions.push(fieldLabel);
      return `[redacted:${fieldLabel}]`;
    }
  }
  return items.map((item) =>
    scrubValue(item, context === "plain" ? "plain" : "nested", redactions),
  );
}

/**
 * Every primitive under a credential-named array, in document order, as the one value its
 * pieces spell: one digit per element and one digit per single-field object are the same
 * credential written down two ways. A metric keeps its exemption inside the walk, by key. Null
 * where there is nothing to join.
 */
function joinedLeaves(items: readonly JsonValue[]): string | null {
  const parts: string[] = [];
  const collect = (value: JsonValue): void => {
    if (value === null || typeof value !== "object") parts.push(String(value));
    else if (Array.isArray(value)) for (const item of value) collect(item);
    else
      for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue }))
        if (!isMetricName(key)) collect(item);
  };
  for (const item of items) collect(item);
  return parts.length === 0 ? null : parts.join("");
}

/**
 * The marker to put in a value's place, or null to leave it alone. Under a credential-bearing
 * name anything but a measurement goes; deeper inside one only credential-shaped material does.
 */
function redactedWhereCredential(
  value: string,
  context: NameContext,
  redactions: string[],
): string | null {
  const verdict = classifyValue(value);
  const redacts =
    context === "named" ? verdict !== "not-credential" : verdict === "credential-shaped";
  if (context === "plain" || !redacts) return null;
  redactions.push(fieldLabel);
  return `[redacted:${fieldLabel}]`;
}
