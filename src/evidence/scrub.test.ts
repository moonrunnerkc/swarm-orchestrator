import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBlockingSecrets, findKnownSecrets, scrubText } from "./scrub.ts";
import { scrubJson } from "./scrub-json.ts";

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
    // nosemgrep: generic.secrets.security.detected-github-token.detected-github-token - a fixture for the scrubber, which is what it is scrubbing.
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
    // nosemgrep: generic.secrets.security.detected-github-token.detected-github-token - a fixture for the scrubber, which is what it is scrubbing.
    const scrubbed = scrubText("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz").value;

    expect(scrubbed).toContain("[redacted:");
    expect(findKnownSecrets(scrubbed)).toEqual([]);
    expect(findBlockingSecrets(scrubbed)).toEqual([]);
  });
});

/**
 * Invariant 9 says one detector serves the write-time scrub, the export-time scan and the
 * gate, "so the three cannot drift apart". They did. These pin the property rather than any
 * one input, because every case below was found by the fuzz harness asserting the property
 * and none of them was a shape anybody would have thought to write down.
 */
describe("the write-time scrub and the export scan agree", () => {
  const artifacts = readdirSync(join(import.meta.dirname, "fixtures/scrub-findings"))
    // Only this boundary's artifacts. Other harnesses keep theirs in the same directory, and
    // a diff or an lcov report is not a scrub regression case.
    .filter((entry) => entry.startsWith("scrub-") && entry.endsWith(".input"))
    .sort();

  it("has the artifacts that found the drift", () => {
    expect(artifacts.length).toBeGreaterThanOrEqual(5);
  });

  for (const artifact of artifacts) {
    it(`leaves nothing for the export scan to find in ${artifact}`, () => {
      const text = readFileSync(
        join(import.meta.dirname, "fixtures/scrub-findings", artifact),
        "utf8",
      );
      const once = scrubText(text);

      // The property, stated as the invariant states it: whatever write-time scrubbing
      // leaves behind is exactly what the export scan is about to read, so the scan finding
      // anything in scrubbed output is the two sites disagreeing about the same bytes.
      expect({ artifact, residual: findKnownSecrets(once.value) }).toEqual({
        artifact,
        residual: [],
      });
      // And scrubbing settles, so an export scan cannot refuse a bundle for the redaction
      // that protected it.
      expect({ artifact, again: scrubText(once.value).value }).toEqual({
        artifact,
        again: once.value,
      });
    });
  }

  it("agrees on generated inputs too, not only the ones already found", () => {
    const names = ["password", "api_key", "client_secret", "api/_key", "secret-scan", "count"];
    const values = ["", "pw", "hunter2", "passed", "0123456789abcdefghij", "482917", "9911"];
    const shapes = [
      (n: string, v: string) => JSON.stringify({ [n]: v }),
      (n: string, v: string) => JSON.stringify({ outer: { inner: { [n]: v } } }),
      (n: string, v: string) => `${n} = "${v}"`,
      (n: string, v: string) => `+ {"a":{"${n}":"${v}"}}`,
    ];

    for (const name of names) {
      for (const value of values) {
        for (const shape of shapes) {
          const text = shape(name, value);
          const once = scrubText(text);
          expect({ text, residual: findKnownSecrets(once.value) }).toEqual({
            text,
            residual: [],
          });
          expect({ text, again: scrubText(once.value).value }).toEqual({ text, again: once.value });
          // The gate is the scan minus the matches too loose to block on, never more.
          for (const blocking of findBlockingSecrets(text)) {
            expect({ text, blocking, known: findKnownSecrets(text) }).toEqual({
              text,
              blocking,
              known: expect.arrayContaining([blocking]),
            });
          }
        }
      }
    }
  });
});

describe("a value under a credential name is judged by the name, not by its length", () => {
  it("redacts a short password, which eight characters used to let through", () => {
    for (const secret of ["pw12", "s3cr3t", "hunter2", "hunter22"]) {
      expect({ secret, outcome: scrubJson({ password: secret }) }).toEqual({
        secret,
        outcome: {
          value: { password: "[redacted:credential-field]" },
          redactions: ["credential-field"],
        },
      });
    }
  });

  it("still refuses to block a change over a value that is merely opaque", () => {
    // Scrubbing is fail-safe and blocking is not, so shape decides the gate and nothing else.
    expect(findBlockingSecrets(`password = "hunter2"`)).toEqual([]);
    expect(findKnownSecrets(`password = "hunter2"`)).toEqual(["credential-assignment"]);
  });

  it("leaves a value too short to carry a credential alone", () => {
    expect(scrubJson({ keys: ["a", "b"], password: "pw" })).toEqual({
      value: { keys: ["a", "b"], password: "pw" },
      redactions: [],
    });
  });

  it("keeps a gate result readable, since a redacted gate result is evidence of nothing", () => {
    const gates = { "secret-scan": "passed", tests: "escalated" };

    expect(scrubJson({ gates })).toEqual({ value: { gates }, redactions: [] });
  });
});
