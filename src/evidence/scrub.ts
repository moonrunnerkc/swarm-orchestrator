import type { JsonValue } from "./canonical-json.ts";

interface SecretPattern {
  readonly label: string;
  /** Held as source rather than a RegExp so every use gets a fresh lastIndex. */
  readonly source: string;
}

/**
 * Known credential shapes, scrubbed at write time before anything reaches the ledger or
 * the blob store (invariant 9). Name the guarantee honestly wherever it is described:
 * this is known-pattern scrubbing, not secret removal. A credential in a shape nobody
 * listed here survives, so the sandbox denylist stays the primary defense.
 */
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
  {
    label: "credential-assignment",
    source:
      "(?<=(?:^|[\\s,{])[\"']?[A-Za-z0-9_]{0,32}(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]{0,32}[\"']?\\s*[=:]\\s*[\"']?)[^\\s\"',}]{8,}",
  },
];

interface ScrubOutcome<Value> {
  readonly value: Value;
  /** Pattern labels that fired, in the order they were applied. Recorded, never the match. */
  readonly redactions: readonly string[];
}

export function scrubText(text: string): ScrubOutcome<string> {
  const redactions: string[] = [];
  let scrubbed = text;

  for (const { label, source } of knownSecretPatterns) {
    const pattern = new RegExp(source, "gi");
    scrubbed = scrubbed.replace(pattern, () => {
      redactions.push(label);
      return `[redacted:${label}]`;
    });
  }

  return { value: scrubbed, redactions };
}

/** Applies the same pass to every string in a payload, keys included. */
export function scrubJson(value: JsonValue): ScrubOutcome<JsonValue> {
  const redactions: string[] = [];
  return { value: scrubValue(value, redactions), redactions };
}

/**
 * The export-time second scan. Scrubbing already ran at write time; this exists because
 * once a blob directory is copied or backed up, write-time alone is too late to fix.
 */
export function findKnownSecrets(text: string): readonly string[] {
  const found: string[] = [];
  for (const { label, source } of knownSecretPatterns) {
    if (new RegExp(source, "i").test(text)) {
      found.push(label);
    }
  }
  return found;
}

function scrubValue(value: JsonValue, redactions: string[]): JsonValue {
  if (typeof value === "string") {
    const outcome = scrubText(value);
    redactions.push(...outcome.redactions);
    return outcome.value;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, redactions));
  }

  const scrubbed: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as { readonly [key: string]: JsonValue })) {
    const scrubbedKey = scrubText(key);
    redactions.push(...scrubbedKey.redactions);
    scrubbed[scrubbedKey.value] = scrubValue(item, redactions);
  }
  return scrubbed;
}
