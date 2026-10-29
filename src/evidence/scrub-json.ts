import type { JsonValue } from "./canonical-json.ts";
import { fieldLabel, isCredentialName, isMetricName } from "./credential-names.ts";
import { nameFinding, type ScrubOutcome, type SecretFinding, scrubTextInto } from "./scrub.ts";
import { classifyValue } from "./secret-spans.ts";

/**
 * The same pass over every string in a payload, keys included, plus the key rule: a value
 * sitting under a credential-bearing name is redacted whatever its JSON type, which is what
 * a text scan over an already-parsed payload cannot see.
 *
 * One traversal, and it is the traversal all three sites run: the write-time scrub here, and
 * the export scan and the gate through `findingsIn`, which walks the parsed payload rather
 * than reading it as lines. The name rule, the array rule, and the metric exemption are each
 * written once, so the three cannot disagree about the same input.
 */
export function scrubJson(value: JsonValue): ScrubOutcome<JsonValue> {
  const findings: SecretFinding[] = [];
  const scrubbed = scrubValue(value, "plain", findings);
  return { value: scrubbed, redactions: findings.map((finding) => finding.redactedAs) };
}

/**
 * How far a credential-bearing name reaches. `named` is the value that name was given, where
 * over-redacting costs nothing and anything but a measurement goes. `nested` is deeper inside
 * that value, where only credential-shaped material goes: `secrets: { ... }` is a container,
 * and blanking every string in it throws away evidence that is not the credential.
 */
type NameContext = "plain" | "named" | "nested";

export function scrubValue(
  value: JsonValue,
  context: NameContext,
  findings: SecretFinding[],
): JsonValue {
  if (typeof value === "string") {
    return scrubString(value, context, findings);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return redactedWhereCredential(String(value), context, findings) ?? value;
  }
  if (Array.isArray(value)) {
    return scrubArray(value, context, findings);
  }

  const scrubbed: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue })) {
    // The name a child is read under is the one that survives into the output, not the one
    // that arrived. A key can itself carry credential material and be scrubbed, and reading
    // the child under the original key meant the second pass, which only ever sees the
    // scrubbed key, could classify it differently and redact something the first pass left.
    // Scrubbing a string is idempotent, so classifying from the scrubbed key is a fixpoint.
    const name = scrubTextInto(key, findings);
    scrubbed[name] = scrubValue(item, contextUnder(name, context), findings);
  }
  return scrubbed;
}

/**
 * A metric is exempt by key wherever it sits, so a throughput figure under a credential-named
 * container is still a measurement. Otherwise a credential-bearing key opens the strict
 * context and everything under it stays in the looser one.
 */
function contextUnder(key: string, context: NameContext): NameContext {
  if (isMetricName(key)) {
    return "plain";
  }
  if (isCredentialName(key)) {
    return "named";
  }
  return context === "plain" ? "plain" : "nested";
}

function scrubString(value: string, context: NameContext, findings: SecretFinding[]): JsonValue {
  const before = findings.length;
  const scrubbed = scrubTextInto(value, findings);
  if (findings.length > before) {
    return scrubbed;
  }
  return redactedWhereCredential(value, context, findings) ?? value;
}

/**
 * An array directly under a credential-bearing name is that credential written in pieces, so
 * its elements are judged joined and it is redacted whole. Deeper in, and under any other
 * name, the elements are walked instead: a secret split across fields nobody named as a
 * credential is outside a name-keyed detector by construction, and guessing at reassembly
 * there is how a detector starts rejecting ordinary split data (build guide section 7.1).
 */
function scrubArray(
  items: readonly JsonValue[],
  context: NameContext,
  findings: SecretFinding[],
): JsonValue {
  if (context === "named") {
    const joined = joinedLeaves(items);
    const verdict = joined === null ? "not-credential" : classifyValue(joined);
    if (verdict !== "not-credential") {
      findings.push(nameFinding(verdict));
      return `[redacted:${fieldLabel}]`;
    }
  }
  return items.map((item) => scrubValue(item, context === "plain" ? "plain" : "nested", findings));
}

/**
 * Every primitive under a credential-named array, in document order, as the one value its
 * pieces spell. Containers are walked into rather than refusing the join: one digit per element
 * and one digit per single-field object are the same credential written down two ways, and a
 * rule that reads the first and not the second is a rule about JSON style. The name is still
 * what says any of this is a credential; nothing here infers one from shape.
 *
 * A metric keeps its exemption inside the walk, by key as everywhere else, so a list of token
 * counts under a credential-word name stays a list of measurements. Null where there is nothing
 * to join, which is not a credential either.
 */
function joinedLeaves(items: readonly JsonValue[]): string | null {
  const parts: string[] = [];

  const collect = (value: JsonValue): void => {
    if (value === null || typeof value !== "object") {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        collect(item);
      }
      return;
    }
    for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue })) {
      if (!isMetricName(key)) {
        collect(item);
      }
    }
  };

  for (const item of items) {
    collect(item);
  }
  return parts.length === 0 ? null : parts.join("");
}

/**
 * The marker to put in a value's place, or null to leave it alone. Under a credential-bearing
 * name anything but a measurement goes, since over-redacting costs nothing; deeper inside one
 * only credential-shaped material does, because blanking every string under `secrets: { ... }`
 * throws away evidence that is not the credential.
 */
function redactedWhereCredential(
  value: string,
  context: NameContext,
  findings: SecretFinding[],
): string | null {
  const verdict = classifyValue(value);
  const redacts =
    context === "named" ? verdict !== "not-credential" : verdict === "credential-shaped";
  if (context === "plain" || !redacts) {
    return null;
  }
  findings.push(nameFinding(verdict));
  return `[redacted:${fieldLabel}]`;
}
