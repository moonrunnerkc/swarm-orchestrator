import { describe, expect, it } from "vitest";
import { findKnownSecrets, scrubJson, scrubText } from "./scrub.ts";

describe("write-time scrubbing", () => {
  it("redacts known credential shapes and names which pattern fired", () => {
    const outcome = scrubText("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");

    expect(outcome.value).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(outcome.value).toContain("[redacted:");
    expect(outcome.redactions).toContain("aws-access-key-id");
  });

  it("redacts inside a nested payload, keys included", () => {
    const outcome = scrubJson({
      command: "curl -H 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345' https://api",
      env: { OPENAI_API_KEY: "sk-proj-0123456789abcdefghij" },
    });

    expect(JSON.stringify(outcome.value)).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(JSON.stringify(outcome.value)).not.toContain("sk-proj-0123456789abcdefghij");
    expect(outcome.redactions.length).toBeGreaterThan(0);
  });

  it("redacts a private key block whole rather than line by line", () => {
    const pem = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");

    const outcome = scrubText(`here it is:\n${pem}\ndone`);

    expect(outcome.value).toBe("here it is:\n[redacted:private-key-block]\ndone");
  });

  it("leaves ordinary text alone", () => {
    const text = "npm test failed: 3 of 47 tests did not pass in src/gates/runner.test.ts";
    expect(scrubText(text)).toEqual({ value: text, redactions: [] });
  });

  it("is idempotent, so a digest taken after scrubbing survives a second pass", () => {
    const once = scrubText("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz").value;
    expect(scrubText(once).value).toBe(once);
  });

  it("leaves a numeric metric alone even when its name contains a credential word", () => {
    // The export gate scans serialized JSON bytes, where a recorded throughput number
    // lands as outputTokensPerSecond":129.90418363640293. A bare number is a metric,
    // never a credential, and matching it blocked every live bundle export.
    const serialized = '{"outputTokensPerSecond":129.90418363640293,"firstTokenMs":763.77}';

    expect(findKnownSecrets(serialized)).toEqual([]);
    expect(scrubText(serialized)).toEqual({ value: serialized, redactions: [] });
  });

  it("still redacts a credential assigned right after a numberish name", () => {
    const outcome = scrubText("API_KEY=a1b2c3d4e5f6");

    expect(outcome.value).toBe("API_KEY=[redacted:credential-assignment]");
  });

  it("finds nothing in already scrubbed output, which is what the export gate checks", () => {
    const scrubbed = scrubJson({ note: "key: AIzaSyA1234567890abcdefghijklmnopqrstuvw" });
    expect(findKnownSecrets(JSON.stringify(scrubbed.value))).toEqual([]);
    expect(findKnownSecrets("AIzaSyA1234567890abcdefghijklmnopqrstuvw")).toContain(
      "google-api-key",
    );
  });
});
