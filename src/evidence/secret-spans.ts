import { assignmentLabel, isCredentialName, knownSecretPatterns } from "./credential-names.ts";

/**
 * A value that already carries a redaction is not a secret: the sensitive span is the one
 * that was replaced. Matching anywhere rather than at the ends is what makes both passes
 * idempotent and stops the export scan refusing a bundle precisely because write-time
 * scrubbing worked.
 */
export const carriesRedaction = /\[redacted:[a-z-]+\]/;
export const jsonNumber = /^-?\d+(?:\.\d+)?$/;

/** A four-digit PIN is the shortest credential anyone issues, so it is the floor for all of them. */
export const shortestCredential = 4;

export type ValueVerdict = "not-credential" | "opaque" | "credential-shaped";

/**
 * What a value beside a credential-bearing name is worth doing about. Scrubbing acts on
 * anything but a measurement, since over-redacting costs nothing. A gate blocks a change, so
 * it only ever sees the shaped verdict: a gate that cries wolf on `key: gate.gateId` is a
 * gate people learn to work around, and the credential is scrubbed out of every record either
 * way. What the asymmetry loses is a warning, never the redaction.
 */
export function classifyValue(value: string): ValueVerdict {
  if (carriesRedaction.test(value) || value.length === 0) {
    return "not-credential";
  }
  // Shorter than the shortest credential anyone issues. The numeric branch below already
  // draws that line at four, for the PIN case, and drawing it anywhere else for text was
  // the whole defect: at eight, `hunter2` under a field named password read as too short to
  // be anything and travelled as plain text. Four is not a confidence threshold, it is the
  // point below which a value cannot carry a secret to begin with.
  if (value.length < shortestCredential) {
    return "not-credential";
  }
  if (jsonNumber.test(value)) {
    // A decimal or a negative is a measurement. A run of digits is a PIN, an OTP, or an
    // account number, and those are the credentials that carry no letters to be recognized by.
    if (value.includes(".") || value.startsWith("-")) {
      return "not-credential";
    }
    return value.length <= 19 ? "credential-shaped" : "opaque";
  }
  if (/[0-9]/.test(value) && /[A-Za-z]/.test(value) && value.length >= 12) {
    return "credential-shaped";
  }
  if (/[+/=]/.test(value) && value.length >= 20) {
    return "credential-shaped";
  }
  // Everything else a credential-bearing name was given. The name already said what the
  // value is, and nothing above it earned a stronger verdict, so it is redacted and the gate
  // is not offered it. Length stops deciding here: what it still decides, above, is how
  // confident the gate gets to be, where a false positive blocks a change rather than
  // redacting a record.
  return "opaque";
}

/**
 * `name = value` and `name: value`, quoted or not, which covers a shell export, a dotenv
 * line, a source literal, and a serialized JSON field with one reader. The bracketed
 * alternative comes first because a bare value would otherwise eat the opening bracket and
 * stop at the first comma, which is how `PIN: [4, 8, 2]` read as the value `[4`.
 *
 * The name is any letter, not any Latin letter, so that a name a reader reads as a credential
 * reaches the fold in `wordsOf` rather than failing to match here.
 *
 * Two details keep one match from hiding the next, which is how a credential used to travel
 * through the gate unreported. The opening delimiter is a lookbehind rather than something
 * the match consumes: `{"b":{"client_secret":"..."}}` gave `b` the `{` that `client_secret`
 * needed to be found by, and only that pair, so whether a secret was seen depended on what
 * an unrelated name three characters earlier happened to eat. And a bare value stops before
 * `{` and `[` as it already stops before `}` and `)`, because an opening brace begins a
 * nested structure rather than being a scalar anybody assigned.
 */
export const assignmentPattern =
  /(?<=^|[\s,{[])["']?(\p{L}[\p{L}\p{N}_-]{0,63})["']?\s*[=:]\s*(?:(\[[^\]\n]*\])|"([^"]*)"|'([^']*)'|([^\s"',;{}[\])]+))/dgu;

export interface SecretSpan {
  readonly label: string;
  readonly start: number;
  readonly end: number;
  /** False for a match too loose to block a change on, only to redact one. */
  readonly blocking: boolean;
}

export function shapeSpans(text: string): readonly SecretSpan[] {
  const spans: SecretSpan[] = [];
  for (const { label, source } of knownSecretPatterns) {
    for (const match of text.matchAll(new RegExp(source, "gi"))) {
      spans.push({
        label,
        start: match.index,
        end: match.index + match[0].length,
        blocking: true,
      });
    }
  }
  return spans;
}

export function assignmentSpans(text: string): readonly SecretSpan[] {
  const spans: SecretSpan[] = [];
  for (const match of text.matchAll(assignmentPattern)) {
    const name = match[1];
    if (name === undefined || !isCredentialName(name)) {
      continue;
    }
    const group = [2, 3, 4, 5].find((index) => match[index] !== undefined);
    const value = group === undefined ? undefined : match[group];
    const at = group === undefined ? undefined : match.indices?.[group];
    if (value === undefined || at === undefined) {
      continue;
    }
    // An array under a credential name is that credential written in pieces, so the pieces
    // are judged joined. The name is what says so; nothing here infers a secret from shape.
    // A value that already carries a marker is judged as it stands, since joining would strip
    // the brackets the marker is recognized by and the second pass would redact its own work.
    const joinable = group === 2 && !carriesRedaction.test(value);
    const verdict = classifyValue(joinable ? joinedElements(value) : value);
    if (verdict === "not-credential") {
      continue;
    }
    spans.push({
      label: assignmentLabel,
      start: at[0],
      end: at[1],
      blocking: verdict === "credential-shaped",
    });
  }
  return spans;
}

/** `[4, 8, 2]` and `["ab", "cd"]` as the one value they stand for. */
export function joinedElements(bracketed: string): string {
  return bracketed
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim().replace(/^["']/, "").replace(/["']$/, ""))
    .join("");
}

/** Every span the detector claims, longest first at a tie, with overlaps dropped. */
export function secretSpans(text: string): readonly SecretSpan[] {
  const all = [...shapeSpans(text), ...assignmentSpans(text)].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );

  const kept: SecretSpan[] = [];
  let reached = 0;
  for (const span of all) {
    if (span.start < reached) {
      continue;
    }
    kept.push(span);
    reached = span.end;
  }
  return kept;
}
