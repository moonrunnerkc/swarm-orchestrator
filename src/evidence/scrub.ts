import type { JsonValue } from "./canonical-json.ts";

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
 * Measurements whose names contain a credential word. Exempt by key and never by value: an
 * integer throughput number is still a measurement, and it was reading the value instead of
 * the key that opened the hole this table closes.
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

function wordsOf(name: string): readonly string[] {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.toLowerCase());
}

/**
 * A value that already carries a redaction is not a secret: the sensitive span is the one
 * that was replaced. Matching anywhere rather than at the ends is what makes both passes
 * idempotent and stops the export scan refusing a bundle precisely because write-time
 * scrubbing worked.
 */
const carriesRedaction = /\[redacted:[a-z-]+\]/;
const jsonNumber = /^-?\d+(?:\.\d+)?$/;

type ValueVerdict = "not-credential" | "opaque" | "credential-shaped";

/**
 * What a value beside a credential-bearing name is worth doing about. Scrubbing acts on
 * anything but a measurement, since over-redacting costs nothing. A gate blocks a change, so
 * it only ever sees the shaped verdict: a gate that cries wolf on `key: gate.gateId` is a
 * gate people learn to work around, and the credential is scrubbed out of every record either
 * way. What the asymmetry loses is a warning, never the redaction.
 */
function classifyValue(value: string): ValueVerdict {
  if (carriesRedaction.test(value)) {
    return "not-credential";
  }
  if (jsonNumber.test(value)) {
    // A decimal or a negative is a measurement. A run of digits is a PIN, an OTP, or an
    // account number, and those are the credentials that carry no letters to be recognized by.
    const digits = value.replace("-", "");
    if (value.includes(".") || value.startsWith("-")) {
      return "not-credential";
    }
    return digits.length >= 4 && digits.length <= 19 ? "credential-shaped" : "not-credential";
  }
  if (value.length < 8) {
    return "not-credential";
  }
  if (/[0-9]/.test(value) && /[A-Za-z]/.test(value) && value.length >= 12) {
    return "credential-shaped";
  }
  return /[+/=]/.test(value) && value.length >= 20 ? "credential-shaped" : "opaque";
}

/**
 * `name = value` and `name: value`, quoted or not, which covers a shell export, a dotenv
 * line, a source literal, and a serialized JSON field with one reader. The bracketed
 * alternative comes first because a bare value would otherwise eat the opening bracket and
 * stop at the first comma, which is how `PIN: [4, 8, 2]` read as the value `[4`.
 */
const assignmentPattern =
  /(?:^|[\s,{[])["']?([A-Za-z][A-Za-z0-9_-]{0,63})["']?\s*[=:]\s*(?:(\[[^\]\n]*\])|"([^"]*)"|'([^']*)'|([^\s"',;})]+))/dg;

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

/** Every span the detector claims, longest first at a tie, with overlaps dropped. */
function secretSpans(text: string): readonly SecretSpan[] {
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

interface ScrubOutcome<Value> {
  readonly value: Value;
  /** Pattern labels that fired, in the order they were applied. Recorded, never the match. */
  readonly redactions: readonly string[];
}

export function scrubText(text: string): ScrubOutcome<string> {
  const spans = secretSpans(text);
  if (spans.length === 0) {
    return { value: text, redactions: [] };
  }

  const parts: string[] = [];
  const redactions: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    parts.push(text.slice(cursor, span.start), `[redacted:${span.label}]`);
    redactions.push(span.label);
    cursor = span.end;
  }
  parts.push(text.slice(cursor));

  return { value: parts.join(""), redactions };
}

/**
 * The export-time second scan. Scrubbing already ran at write time; this exists because
 * once a blob directory is copied or backed up, write-time alone is too late to fix.
 */
export function findKnownSecrets(text: string): readonly string[] {
  return [...new Set(secretSpans(text).map((span) => span.label))];
}

/**
 * What the secret-scan gate blocks on: the same detector, minus the matches whose value is
 * too ordinary to stop a change over.
 */
export function findBlockingSecrets(text: string): readonly string[] {
  return [
    ...new Set(
      secretSpans(text)
        .filter((span) => span.blocking)
        .map((span) => span.label),
    ),
  ];
}

/**
 * The same pass over every string in a payload, keys included, plus the key rule: a value
 * sitting under a credential-bearing name is redacted whatever its JSON type, which is what
 * a text scan over an already-parsed payload cannot see.
 *
 * One traversal, so this and the two text-reading sites cannot drift on the same input: the
 * name rule, the array rule, and the metric exemption are each written once and reached from
 * both directions.
 */
export function scrubJson(value: JsonValue): ScrubOutcome<JsonValue> {
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
    return scrubString(value, context, redactions);
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return redactsAsCredential(String(value), context) ? redacted(fieldLabel, redactions) : value;
  }
  if (Array.isArray(value)) {
    return scrubArray(value, context, redactions);
  }

  const scrubbed: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue })) {
    const scrubbedKey = scrubText(key);
    redactions.push(...scrubbedKey.redactions);
    scrubbed[scrubbedKey.value] = scrubValue(item, contextUnder(key, context), redactions);
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

function scrubString(value: string, context: NameContext, redactions: string[]): JsonValue {
  const outcome = scrubText(value);
  if (outcome.redactions.length > 0) {
    redactions.push(...outcome.redactions);
    return outcome.value;
  }
  return redactsAsCredential(value, context) ? redacted(fieldLabel, redactions) : value;
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
  redactions: string[],
): JsonValue {
  if (context === "named") {
    const joined = joinedPrimitives(items);
    if (joined !== null && classifyValue(joined) !== "not-credential") {
      return redacted(fieldLabel, redactions);
    }
  }
  return items.map((item) =>
    scrubValue(item, context === "plain" ? "plain" : "nested", redactions),
  );
}

/** Null when any element is a container, which is not one value written in pieces. */
function joinedPrimitives(items: readonly JsonValue[]): string | null {
  const parts: string[] = [];
  for (const item of items) {
    if (item !== null && typeof item === "object") {
      return null;
    }
    parts.push(String(item));
  }
  return parts.join("");
}

function redactsAsCredential(value: string, context: NameContext): boolean {
  const verdict = classifyValue(value);
  if (context === "named") {
    return verdict !== "not-credential";
  }
  return context === "nested" && verdict === "credential-shaped";
}

function redacted(label: string, redactions: string[]): string {
  redactions.push(label);
  return `[redacted:${label}]`;
}
