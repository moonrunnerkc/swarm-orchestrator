import { asLatinLetters } from "./latin-lookalikes.ts";

/**
 * One detector, three callers: the write-time scrub, the export-time second scan, and the
 * secret-scan gate (invariant 9). They shared a regex before and drifted anyway, because the
 * relaxation that stopped a throughput metric being read as a credential also let every
 * numeric-only credential through. Detection keys on the name now, so a PIN, an OTP, and an
 * account number are caught whatever shape their value takes, and a metric stays exempt
 * because of its key rather than because its value looked harmless.
 *
 * Name the guarantee honestly wherever it is described: this is known-pattern scrubbing, not
 * secret removal. A credential under a name nobody listed here survives, so the guard
 * denylist stays the primary defense.
 */

export interface SecretPattern {
  readonly label: string;
  /** Held as source rather than a RegExp so every use gets a fresh lastIndex. */
  readonly source: string;
}

/** Shapes that name themselves. A value like this is credential material wherever it sits. */
export const knownSecretPatterns: readonly SecretPattern[] = [
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

export const assignmentLabel = "credential-assignment";
export const fieldLabel = "credential-field";

/** A word in a name that says the value beside it is a credential. */
export const credentialWords: ReadonlySet<string> = new Set([
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
export const credentialNames: ReadonlySet<string> = new Set([
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
export const metricNames: ReadonlySet<string> = new Set([
  "outputtokens",
  "inputtokens",
  "totaltokens",
  "prompttokens",
  "completiontokens",
  "cachedinputtokens",
  "reasoningtokens",
  "reservedtokens",
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
export function wordsOf(name: string): readonly string[] {
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
