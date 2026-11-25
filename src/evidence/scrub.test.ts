import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scrubJson } from "./scrub.ts";

describe("write-time scrubbing", () => {
  it("redacts known credential shapes and names which pattern fired", () => {
    const outcome = scrubJson("export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE");

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

    const outcome = scrubJson(`here it is:\n${pem}\ndone`);

    expect(outcome.value).toBe("here it is:\n[redacted:private-key-block]\ndone");
  });

  it("leaves ordinary text alone", () => {
    const text = "npm test failed: 3 of 47 tests did not pass in src/gates/runner.test.ts";
    expect(scrubJson(text)).toEqual({ value: text, redactions: [] });
  });

  it("is idempotent, so a digest taken after scrubbing survives a second pass", () => {
    // nosemgrep: generic.secrets.security.detected-github-token.detected-github-token - a fixture for the scrubber, which is what it is scrubbing.
    const once = scrubJson("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz").value;
    expect(scrubJson(once).value).toBe(once);
  });

  it("leaves a numeric metric alone even when its name contains a credential word", () => {
    // A recorded throughput number is a metric, never a credential, as a field or as text.
    const serialized = '{"outputTokensPerSecond":129.90418363640293,"firstTokenMs":763.77}';

    expect(scrubJson(JSON.parse(serialized)).redactions).toEqual([]);
    expect(scrubJson(serialized)).toEqual({ value: serialized, redactions: [] });
  });

  it("still redacts a credential assigned right after a numberish name", () => {
    const outcome = scrubJson("API_KEY=a1b2c3d4e5f6");

    expect(outcome.value).toBe("API_KEY=[redacted:credential-assignment]");
  });

  it("finds nothing in already scrubbed output, serialized or not", () => {
    const scrubbed = scrubJson({ note: "key: AIzaSyA1234567890abcdefghijklmnopqrstuvw" });
    expect(scrubJson(scrubbed.value).redactions).toEqual([]);
    expect(scrubJson(JSON.stringify(scrubbed.value)).redactions).toEqual([]);
    expect(scrubJson("AIzaSyA1234567890abcdefghijklmnopqrstuvw").redactions).toContain(
      "google-api-key",
    );
  });

  it("does not read its own redaction marker back as a credential", () => {
    // Otherwise a second pass rewrites what the first protected, and the blob's digest moves.
    // nosemgrep: generic.secrets.security.detected-github-token.detected-github-token - a fixture for the scrubber, which is what it is scrubbing.
    const scrubbed = scrubJson("token=ghp_0123456789abcdefghijklmnopqrstuvwxyz").value;

    expect(scrubbed).toContain("[redacted:");
    expect(scrubJson(scrubbed).redactions).toEqual([]);
  });
});

/**
 * Scrubbing settles: a second pass over scrubbed output finds nothing and changes nothing, so a
 * blob's digest is stable. Every artifact below was found by a fuzz harness asserting the
 * property, and none is a shape anybody would have thought to write down.
 */
describe("scrubbing reaches a fixpoint in one call", () => {
  const artifacts = readdirSync(join(import.meta.dirname, "fixtures/scrub-findings"))
    // Only this boundary's artifacts. Other harnesses keep theirs in the same directory, and
    // a diff or an lcov report is not a scrub regression case.
    .filter((entry) => entry.startsWith("scrub-") && entry.endsWith(".input"))
    .sort();

  it("has the artifacts that found the drift", () => {
    expect(artifacts.length).toBeGreaterThanOrEqual(5);
  });

  for (const artifact of artifacts) {
    it(`leaves nothing for a second pass to find in ${artifact}`, () => {
      const text = readFileSync(
        join(import.meta.dirname, "fixtures/scrub-findings", artifact),
        "utf8",
      );
      const once = scrubJson(text);

      expect({ artifact, again: scrubJson(once.value) }).toEqual({
        artifact,
        again: { value: once.value, redactions: [] },
      });
    });
  }

  it("settles on generated inputs too, not only the ones already found", () => {
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
          const once = scrubJson(text);
          expect({ text, again: scrubJson(once.value) }).toEqual({
            text,
            again: { value: once.value, redactions: [] },
          });
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
