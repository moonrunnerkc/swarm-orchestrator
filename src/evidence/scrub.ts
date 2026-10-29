import type { JsonValue } from "./canonical-json.ts";
import { assignmentLabel, fieldLabel } from "./credential-names.ts";
// Text can carry JSON, so text scrubbing hands it to the JSON traversal and back.
import { scrubValue } from "./scrub-json.ts";
import { type SecretSpan, secretSpans, type ValueVerdict } from "./secret-spans.ts";

export interface ScrubOutcome<Value> {
  readonly value: Value;
  /** Pattern labels that fired, in the order they were applied. Recorded, never the match. */
  readonly redactions: readonly string[];
}

/**
 * One thing the detector found, named for both of its audiences. A redaction marker names the
 * field it replaced and a scan names the assignment it read, so the two spellings survive;
 * what does not survive is the possibility of one site finding it and another not, since every
 * site reaches this through the same traversal.
 */
export interface SecretFinding {
  /** What the marker left in the scrubbed value says. */
  readonly redactedAs: string;
  /** What a scan over the same content reports. */
  readonly reportedAs: string;
  /** False for a match too loose to block a change on, only to redact one. */
  readonly blocking: boolean;
}

export function spanFinding(span: SecretSpan): SecretFinding {
  return { redactedAs: span.label, reportedAs: span.label, blocking: span.blocking };
}

export function nameFinding(verdict: ValueVerdict): SecretFinding {
  return {
    redactedAs: fieldLabel,
    reportedAs: assignmentLabel,
    blocking: verdict === "credential-shaped",
  };
}

/**
 * Scrubs content whose type is not known in advance, dispatching exactly as `findingsIn`
 * does: where it parses, the structural walk governs, and the line scan is what is left for
 * content that is genuinely not JSON.
 *
 * The dispatch is the guarantee, not an optimization. These two sites used to answer the
 * same question with two implementations, and a regex and a parser cannot be made to agree
 * by adding spellings to the regex: `wordsOf` splits a name on any non-alphanumeric run, so
 * `api/_key` is a credential to the walk, while the scan's name class stops at the slash and
 * sees nothing. Widening that class buys the next spelling and not the one after it. Sharing
 * the dispatch means there is one answer for JSON, which is what a payload is.
 *
 * The original bytes come back untouched when the walk finds nothing, so re-serialization is
 * only ever visible on content that was going to be rewritten anyway.
 */
export function scrubText(text: string): ScrubOutcome<string> {
  const findings: SecretFinding[] = [];
  let current = text;

  // The dispatch runs to a fixpoint, not just the line scan inside it. Scrubbing can change
  // which arm the next reader takes: a payload carrying a control byte does not parse, so it
  // goes to the line scan, and if that byte sits inside the span being replaced the result
  // does parse. The export scan then walks what the write-time scrub had only scanned, and
  // reports a name the scan's own name class could not see. Re-dispatching until nothing
  // changes means the arm that reads the output last is the arm that wrote it.
  for (let round = 0; round < scrubRounds; round += 1) {
    const next = scrubDispatched(current, findings);
    if (next === current) {
      break;
    }
    current = next;
  }

  return { value: current, redactions: findings.map((finding) => finding.redactedAs) };
}

export function scrubDispatched(text: string, findings: SecretFinding[]): string {
  const parsed = parseJsonPayload(text);
  if (parsed === undefined) {
    return scrubTextInto(text, findings);
  }
  const before = findings.length;
  const walked = scrubValue(parsed, "plain", findings);
  // Untouched content comes back as the bytes it arrived as, so re-serialization is only
  // ever visible on a payload that was going to be rewritten anyway.
  return findings.length === before ? text : JSON.stringify(walked);
}

/**
 * One pass is not a fixpoint, so this runs to one. Overlapping claims are resolved by
 * keeping the earliest and dropping what it covers, which is right for the pass it is in and
 * leaves the dropped region unexamined: replacing a span with a marker shortens the text
 * around it, and an assignment the discarded span had swallowed becomes visible only once
 * that happens. Scrubbing twice then differed from scrubbing once, which is the export scan
 * refusing a bundle for the redaction that protected it.
 *
 * It converges because every round replaces credential material with a marker and a marker
 * is not credential material, so the unredacted span count strictly decreases. The cap is a
 * backstop against a pattern that could somehow reintroduce a match, not an expected path.
 */
export const scrubRounds = 8;

export function scrubTextInto(text: string, findings: SecretFinding[]): string {
  let current = text;
  for (let round = 0; round < scrubRounds; round += 1) {
    const next = scrubTextOnce(current, findings);
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

export function scrubTextOnce(text: string, findings: SecretFinding[]): string {
  const spans = secretSpans(text);
  if (spans.length === 0) {
    return text;
  }

  const parts: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    parts.push(text.slice(cursor, span.start), `[redacted:${span.label}]`);
    findings.push(spanFinding(span));
    cursor = span.end;
  }
  parts.push(text.slice(cursor));

  return parts.join("");
}

/**
 * What the two text-reading sites see. A payload this system stores is JSON, and a scan that
 * reads JSON as lines cannot see what a walk over it sees: pretty-printing puts a
 * credential-bearing name and the value it was given on different lines, and compacting buries
 * the same pair inside a longer line where the scanner reads the enclosing object as the
 * value. Neither is a spelling a name list can be extended to cover, because a parser and a
 * line scanner genuinely disagree about where a value begins.
 *
 * So where the content parses, the structural walk governs and the line scan is not consulted
 * at all. The line scan is what is left for content that is genuinely not JSON: a source file,
 * a shell transcript, a dotenv line. Build-guide section 7.1 names that remainder rather than
 * implying the walk covers it.
 */
export function findingsIn(text: string): readonly SecretFinding[] {
  const parsed = parseJsonPayload(text);
  if (parsed === undefined) {
    return secretSpans(text).map(spanFinding);
  }
  const findings: SecretFinding[] = [];
  scrubValue(parsed, "plain", findings);
  return findings;
}

/** An object or an array, which is what a payload is. Anything else reads as text. */
export function parseJsonPayload(text: string): JsonValue | undefined {
  if (!/^\s*[[{]/.test(text)) {
    return undefined;
  }
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * The export-time second scan. Scrubbing already ran at write time; this exists because
 * once a blob directory is copied or backed up, write-time alone is too late to fix.
 */
export function findKnownSecrets(text: string): readonly string[] {
  return [...new Set(findingsIn(text).map((finding) => finding.reportedAs))];
}

/**
 * What the secret-scan gate blocks on: the same detector, minus the matches whose value is
 * too ordinary to stop a change over.
 */
export function findBlockingSecrets(text: string): readonly string[] {
  return [
    ...new Set(
      findingsIn(text)
        .filter((finding) => finding.blocking)
        .map((finding) => finding.reportedAs),
    ),
  ];
}
