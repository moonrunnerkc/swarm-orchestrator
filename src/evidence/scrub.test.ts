import { describe, expect, it } from "vitest";
import { findBlockingSecrets, findKnownSecrets, scrubJson, scrubText } from "./scrub.ts";

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

  it("does not read its own redaction marker back as a credential", () => {
    // Otherwise export refuses to ship a bundle precisely because write-time scrubbing
    // worked, which is the one outcome the second scan must never produce.
    const scrubbed = scrubText("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz").value;

    expect(scrubbed).toContain("[redacted:");
    expect(findKnownSecrets(scrubbed)).toEqual([]);
    expect(findBlockingSecrets(scrubbed)).toEqual([]);
  });
});

describe("detection keyed on the name rather than the shape of the value", () => {
  it("redacts a numeric credential at write time, whatever shape the value takes", () => {
    for (const [text, expected] of [
      ["API_KEY=48291736", "API_KEY=[redacted:credential-assignment]"],
      ["PIN=482917", "PIN=[redacted:credential-assignment]"],
      ["otp: 847291", "otp: [redacted:credential-assignment]"],
      ["accountNumber=123456789012", "accountNumber=[redacted:credential-assignment]"],
    ] as const) {
      const outcome = scrubText(text);

      expect({ text, value: outcome.value }).toEqual({ text, value: expected });
      expect(findKnownSecrets(text)).toContain("credential-assignment");
    }
  });

  it("redacts a numeric credential carried as a JSON field, not only as text", () => {
    const outcome = scrubJson({
      command: "echo done",
      leaked: { API_KEY: 48291736, PIN: 482917, otp: "847291", accountNumber: "123456789012" },
    });
    const serialized = JSON.stringify(outcome.value);

    for (const digits of ["48291736", "482917", "847291", "123456789012"]) {
      expect({ digits, serialized }).toEqual({
        digits,
        serialized: expect.not.stringContaining(digits),
      });
    }
    expect(outcome.redactions).toContain("credential-field");
    expect(findKnownSecrets(serialized)).toEqual([]);
  });

  it("leaves a known metric key alone by name, whatever its value", () => {
    // The exemption is by key, not by value: an integer throughput number is still a metric,
    // and this is the case that made the previous detector let real PINs through.
    const serialized =
      '{"outputTokensPerSecond":129.90418363640293,"firstTokenMs":763.77,' +
      '"outputTokens":1482917,"maxTokens":1000000,"secretMatches":4821}';

    expect(scrubText(serialized)).toEqual({ value: serialized, redactions: [] });
    expect(scrubJson(JSON.parse(serialized) as Record<string, number>).redactions).toEqual([]);
    expect(findKnownSecrets(serialized)).toEqual([]);
  });

  it("leaves a bare numeric literal with no credential-shaped key alone", () => {
    const serialized = '{"durationMs":482917,"outputBytes":123456789012,"exitCode":0}';

    expect(scrubText(serialized)).toEqual({ value: serialized, redactions: [] });
    expect(findKnownSecrets(serialized)).toEqual([]);
  });

  it("is idempotent over a payload, so a blob digest survives a second pass", () => {
    const once = scrubJson({
      account: "accountNumber=123456789012",
      env: { API_KEY: 48291736 },
    }).value;
    const twice = scrubJson(once);

    expect(twice.value).toEqual(once);
    expect(twice.redactions).toEqual([]);
    expect(findKnownSecrets(JSON.stringify(once))).toEqual([]);
  });

  it("does not read a credential word buried inside an ordinary word", () => {
    for (const text of ['{"mapping":48291736}', '{"spinCount":123456}', '{"pinned":48291736}']) {
      expect({ text, ...scrubText(text) }).toEqual({ text, value: text, redactions: [] });
    }
  });

  it("redacts an opaque value under a credential key without offering it to a gate", () => {
    // Scrubbing is fail-safe, so over-matching costs nothing. Blocking is not, so the gate
    // only sees matches whose value is shaped like credential material.
    const outcome = scrubText("createElement(Text, { key: gate.gateId }, label)");

    expect(outcome.redactions).toEqual(["credential-assignment"]);
    expect(findKnownSecrets("key: gate.gateId }")).toContain("credential-assignment");
    expect(findBlockingSecrets("key: gate.gateId }")).toEqual([]);
  });
});
