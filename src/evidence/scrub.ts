import type { JsonValue } from "./canonical-json.ts";
import { asLatinLetters } from "./latin-lookalikes.ts";
import { reassembledStrings } from "./value-flow.ts";

/**
 * One detector, three callers: the write-time scrub, the export-time second scan, and the
 * secret-scan gate (invariant 9). They shared a regex before and drifted anyway, because the
 * relaxation that stopped a throughput metric being read as a credential also let every
 * numeric-only credential through. Detection keys on the name now, so a PIN, an OTP, and an
 * account number are caught whatever shape their value takes, and a metric stays exempt
 * because of its key rather than because its value looked harmless.
 *
 * Name the guarantee honestly wherever it is described: this is known-pattern scrubbing, not
 * secret removal. A credential under a name nobody listed here survives, so the sandbox
 * denylist stays the primary defense.
 */

interface SecretPattern {
  readonly label: string;
  /** Held as source rather than a RegExp so every use gets a fresh lastIndex. */
  readonly source: string;
}

/** Shapes that name themselves. A value like this is credential material wherever it sits. */
const knownSecretPatterns: readonly SecretPattern[] = [
  {
    label: "private-key-block",
    source: "-----BEGIN[A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END[A-Z ]*PRIVATE KEY-----",
  },
  { label: "openai-style-key", source: "sk-[A-Za-z0-9_-]{16,}" },
  { label: "anthropic-key", source: "sk-ant-[A-Za-z0-9_-]{16,}" },
  { label: "github-token", source: "gh[pousr]_[A-Za-z0-9]{20,}" },
  { label: "github-fine-grained-token", source: "github_pat_[A-Za-z0-9_]{20,}" },
  { label: "aws-access-key-id", source: "(?:AKIA|ASIA)[0-9A-Z]{16}" },
  { label: "google-api-key", source: "AIza[0-9A-Za-z_-]{35}" },
  { label: "slack-token", source: "xox[baprs]-[0-9A-Za-z-]{10,}" },
  { label: "bearer-token", source: "[Bb]earer\\s+[A-Za-z0-9._~+/=-]{20,}" },
  {
    label: "json-web-token",
    source: "eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}",
  },
];

const assignmentLabel = "credential-assignment";
const fieldLabel = "credential-field";

/** A word in a name that says the value beside it is a credential. */
const credentialWords: ReadonlySet<string> = new Set([
  "key",
  "keys",
  "token",
  "tokens",
  "secret",
  "secrets",
  "password",
  "passwd",
  "passphrase",
  "credential",
  "credentials",
  "pin",
  "otp",
  "account",
  // The header that carries a credential on every authenticated request, and its relatives.
  "authorization",
  "authorisation",
  "authenticate",
]);

/** Spellings that carry no separator to split on, so word splitting alone would miss them. */
const credentialNames: ReadonlySet<string> = new Set([
  "apikey",
  "apitoken",
  "accesskey",
  "secretkey",
  "privatekey",
  "authtoken",
]);

/**
 * Names that read as credential-bearing and are not. Mostly measurements, which is where the
 * table started, plus the few identifiers this system gives itself that happen to spell a
 * credential word: a public key is public, and a gate named secret-scan is a gate.
 *
 * Exempt by key and never by value: an integer throughput number is still a measurement, and
 * it was reading the value instead of the key that opened the hole this table closes.
 */
const metricNames: ReadonlySet<string> = new Set([
  "outputtokens",
  "inputtokens",
  "totaltokens",
  "prompttokens",
  "completiontokens",
  "cachedinputtokens",
  "reasoningtokens",
  "tokencount",
  "tokensused",
  "maxtokens",
  "maxoutputtokens",
  "tokenspersecond",
  "outputtokenspersecond",
  "firsttokenms",
  "costinputtokens",
  "costoutputtokens",
  "secretmatches",
  // The gate that looks for secrets. Its result is "passed" or "escalated", and redacting
  // that turned the record of a gate having run into evidence of nothing having run.
  "secretscan",
  "publickey",
  "publickeyspki",
  "keysource",
]);

/**
 * A name is credential-bearing when one of its words says so. Words, not substrings: "pin"
 * sits inside "mapping" and "spinCount", and a detector that redacted those would be routed
 * around within a day.
 */
export function isCredentialName(name: string): boolean {
  if (isMetricName(name)) {
    return false;
  }
  const words = wordsOf(name);
  return credentialNames.has(words.join("")) || words.some((word) => credentialWords.has(word));
}

/**
 * A measurement, exempt by key at every site. Separate from isCredentialName because the walk
 * needs to know a name is a metric even where nothing else about it is credential-bearing: a
 * metric under a credential-named container is still a metric.
 */
export function isMetricName(name: string): boolean {
  return metricNames.has(wordsOf(name).join(""));
}

/**
 * A name's words, read as a reader reads them. The fold matters because detection is keyed on
 * the name: a field spelled password with one Cyrillic letter in it is a password to everyone
 * who opens the record, and to nothing that compares code points. Folding first means the same
 * name is one name however it was typed, and the table only maps letters that render as the
 * Latin ones, so nothing else moves.
 */
function wordsOf(name: string): readonly string[] {
  return (
    asLatinLetters(name)
      // A marker this detector wrote is not part of the name it was written into. The marker
      // spells "credential", so a name that carried a redacted span read as credential-bearing
      // on the next pass and took its neighbouring value with it: scrubbing twice differed
      // from scrubbing once, and an export scan could refuse a bundle for the redaction that
      // protected it. Values already had this guard, in `carriesRedaction`; names did not.
      .replaceAll(/\[redacted:[a-z-]+\]/g, " ")
      .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
      .split(/[^A-Za-z0-9]+/)
      .filter((word) => word.length > 0)
      .map((word) => word.toLowerCase())
  );
}

/**
 * A value that already carries a redaction is not a secret: the sensitive span is the one
 * that was replaced. Matching anywhere rather than at the ends is what makes both passes
 * idempotent and stops the export scan refusing a bundle precisely because write-time
 * scrubbing worked.
 */
const carriesRedaction = /\[redacted:[a-z-]+\]/;
const jsonNumber = /^-?\d+(?:\.\d+)?$/;

/** A four-digit PIN is the shortest credential anyone issues, so it is the floor for all of them. */
const shortestCredential = 4;

type ValueVerdict = "not-credential" | "opaque" | "credential-shaped";

/**
 * What a value beside a credential-bearing name is worth doing about. Scrubbing acts on
 * anything but a measurement, since over-redacting costs nothing. A gate blocks a change, so
 * it only ever sees the shaped verdict: a gate that cries wolf on `key: gate.gateId` is a
 * gate people learn to work around, and the credential is scrubbed out of every record either
 * way. What the asymmetry loses is a warning, never the redaction.
 */
function classifyValue(value: string): ValueVerdict {
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
const assignmentPattern =
  /(?<=^|[\s,{[])["']?(\p{L}[\p{L}\p{N}_-]{0,63})["']?\s*[=:]\s*(?:(\[[^\]\n]*\])|"([^"]*)"|'([^']*)'|([^\s"',;{}[\])]+))/dgu;

interface SecretSpan {
  readonly label: string;
  readonly start: number;
  readonly end: number;
  /** False for a match too loose to block a change on, only to redact one. */
  readonly blocking: boolean;
}

function shapeSpans(text: string): readonly SecretSpan[] {
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

function assignmentSpans(text: string): readonly SecretSpan[] {
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
function joinedElements(bracketed: string): string {
  return bracketed
    .slice(1, -1)
    .split(",")
    .map((part) => part.trim().replace(/^["']/, "").replace(/["']$/, ""))
    .join("");
}

/**
 * Spans of a credential written in pieces and joined back together by the text itself.
 *
 * Keyed on neither the name nor the shape of any one piece, because that is the gap: two
 * fragments under names that say nothing are ordinary separately and a credential together.
 * What it is keyed on is that the text performs the join, and that the joined value matches a
 * shape that names itself. So a version tuple and a chunked payload produce nothing, and
 * `head + tail` producing an AKIA key produces the same finding writing it whole would.
 *
 * Every piece is claimed, not only the concatenation, so redacting leaves no half in the clear.
 */
function reassemblySpans(text: string): readonly SecretSpan[] {
  const spans: SecretSpan[] = [];
  for (const reassembly of reassembledStrings(text)) {
    for (const { label, source } of knownSecretPatterns) {
      if (!new RegExp(source, "i").test(reassembly.value)) {
        continue;
      }
      for (const span of reassembly.spans) {
        spans.push({ label, start: span.start, end: span.end, blocking: true });
      }
      break;
    }
  }
  return spans;
}

/** Every span the detector claims, longest first at a tie, with overlaps dropped. */
function secretSpans(text: string): readonly SecretSpan[] {
  const all = [...shapeSpans(text), ...reassemblySpans(text), ...assignmentSpans(text)].sort(
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

interface ScrubOutcome<Value> {
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
interface SecretFinding {
  /** What the marker left in the scrubbed value says. */
  readonly redactedAs: string;
  /** What a scan over the same content reports. */
  readonly reportedAs: string;
  /** False for a match too loose to block a change on, only to redact one. */
  readonly blocking: boolean;
}

function spanFinding(span: SecretSpan): SecretFinding {
  return { redactedAs: span.label, reportedAs: span.label, blocking: span.blocking };
}

function nameFinding(verdict: ValueVerdict): SecretFinding {
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

function scrubDispatched(text: string, findings: SecretFinding[]): string {
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
const scrubRounds = 8;

function scrubTextInto(text: string, findings: SecretFinding[]): string {
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

function scrubTextOnce(text: string, findings: SecretFinding[]): string {
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
function findingsIn(text: string): readonly SecretFinding[] {
  const parsed = parseJsonPayload(text);
  if (parsed === undefined) {
    return secretSpans(text).map(spanFinding);
  }
  const findings: SecretFinding[] = [];
  scrubValue(parsed, "plain", findings);
  return findings;
}

/** An object or an array, which is what a payload is. Anything else reads as text. */
function parseJsonPayload(text: string): JsonValue | undefined {
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

function scrubValue(value: JsonValue, context: NameContext, findings: SecretFinding[]): JsonValue {
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
