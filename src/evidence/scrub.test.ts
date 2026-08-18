import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("redacts a credential under an HTTP auth header name at all three sites", () => {
    for (const name of ["Authorization", "proxy-authorization", "WWW-Authenticate"]) {
      const text = `${name}: 48291736`;

      expect({ name, ...scrubText(text) }).toEqual({
        name,
        value: `${name}: [redacted:credential-assignment]`,
        redactions: ["credential-assignment"],
      });
      expect({ name, found: findKnownSecrets(text) }).toEqual({
        name,
        found: ["credential-assignment"],
      });
      expect({ name, blocking: findBlockingSecrets(text) }).toEqual({
        name,
        blocking: ["credential-assignment"],
      });
      expect(JSON.stringify(scrubJson({ [name]: 48291736 }).value)).not.toContain("48291736");
    }
  });

  it("reaches a numeric credential one object below the name that describes it", () => {
    const outcome = scrubJson({ PIN: { value: 482917 }, apiKey: { current: "a1b2c3d4e5f6" } });
    const serialized = JSON.stringify(outcome.value);

    expect(serialized).not.toContain("482917");
    expect(serialized).not.toContain("a1b2c3d4e5f6");
    expect(outcome.redactions).toContain("credential-field");
  });

  it("does not blank a container's ordinary contents just for sitting under the name", () => {
    // The nested rule is the shaped one: `secrets: { ... }` is a container, and redacting
    // every string in it throws away evidence that is not the credential.
    const outcome = scrubJson({ credentials: { provider: "anthropic", createdAt: "2026-08-14" } });

    expect(outcome.value).toEqual({
      credentials: { provider: "anthropic", createdAt: "2026-08-14" },
    });
    expect(outcome.redactions).toEqual([]);
  });

  it("judges a credential-named array as the one value it is written in pieces of", () => {
    for (const items of [[48291736], [4, 8, 2, 9, 1, 7], ["4829", "1736"]]) {
      const written = scrubJson({ PIN: items });
      const blob = JSON.stringify(written.value);
      const text = `{"PIN":[${items.map((item) => JSON.stringify(item)).join(",")}]}`;

      expect({ items, blob }).toEqual({ items, blob: '{"PIN":"[redacted:credential-field]"}' });
      expect({ items, again: findKnownSecrets(blob) }).toEqual({ items, again: [] });
      // The text scan reaches the same verdict on the same bytes, which is what stops the
      // export scan and the gate disagreeing with what was written.
      expect({ items, found: findKnownSecrets(text) }).toEqual({
        items,
        found: ["credential-assignment"],
      });
      // scrubText walks JSON rather than scanning it as lines, so the marker lands as a
      // value and the result still parses. Splicing it in as text gave back
      // {"PIN":[redacted:...]}, which is not JSON: scrubbing a payload destroyed the thing
      // that made it readable, and every reader downstream inherited that.
      expect({ items, scrubbed: scrubText(text).value }).toEqual({
        items,
        scrubbed: '{"PIN":"[redacted:credential-field]"}',
      });
      expect(() => JSON.parse(scrubText(text).value) as unknown).not.toThrow();
    }
  });

  it("leaves an array of ordinary short values under a credential name alone", () => {
    const outcome = scrubJson({ keys: ["a", "b"], tokens: [1, 2, 3] });

    expect(outcome.value).toEqual({ keys: ["a", "b"], tokens: [1, 2, 3] });
    expect(outcome.redactions).toEqual([]);
  });

  it("leaves a version tuple alone at every site, whichever way it is rendered", () => {
    // The control behind the residual: treating adjacent short values as one value is what a
    // reassembling detector would have to do, and this is what it would cost. Nothing here is
    // under a credential name, so nothing here is a credential.
    const value = { version: [13, 0, 1], parts: ["ab", "cd", "ef"] };

    expect(scrubJson(value)).toEqual({ value, redactions: [] });
    for (const rendering of [JSON.stringify(value), JSON.stringify(value, null, 2)]) {
      expect({ rendering, found: findKnownSecrets(rendering) }).toEqual({ rendering, found: [] });
    }
  });

  it("keeps the metric exemption exact at all three sites, nested or not", () => {
    const metrics = { outputTokensPerSecond: 129.9, maxTokens: 1000000, tokenCount: 48291736 };
    const text = JSON.stringify({ credentials: metrics });

    expect(scrubJson({ credentials: metrics }).redactions).toEqual([]);
    expect(scrubJson({ credentials: metrics }).value).toEqual({ credentials: metrics });
    expect(scrubText(text)).toEqual({ value: text, redactions: [] });
    expect(findKnownSecrets(text)).toEqual([]);
    expect(findBlockingSecrets(text)).toEqual([]);
  });

  it("reads a credential name as a reader reads it, whatever the letters are", () => {
    // Detection keys on the name, so a name that renders as a credential word and is not one
    // carried the value past all three sites. Cyrillic a, Greek omicron, a fullwidth k, and a
    // zero-width space: each of them prints as the name beside it.
    const spellings = [
      `p\u0430ssword`,
      `t\u03BFken`,
      `api\uFF4Bey`,
      `secr\u200Bet`,
      `\u0410PI_KEY`,
    ];

    for (const name of spellings) {
      // A numeric credential, which is the case a name-keyed detector exists for: nothing about
      // the value says anything, so the name is the whole of the evidence.
      const value = { [name]: 4_829_173_648_291_736 };
      const rendering = JSON.stringify(value, null, 2);

      expect({ name, redactions: scrubJson(value).redactions }).toEqual({
        name,
        redactions: ["credential-field"],
      });
      expect({ name, found: findKnownSecrets(rendering) }).toEqual({
        name,
        found: ["credential-assignment"],
      });
      expect({ name, blocking: findBlockingSecrets(rendering) }).toEqual({
        name,
        blocking: ["credential-assignment"],
      });
    }
  });

  it("joins an array under a credential name however its pieces are nested", () => {
    // One digit per element and one digit per single-field object are the same credential
    // written down two ways. The name is what says it is one; the wrapper is style.
    const wrapped = { PIN: [{ n: 4 }, { n: 8 }, { n: 2 }, { n: 9 }, { n: 1 }, { n: 7 }] };
    const nested = {
      PIN: [
        [4, 8],
        [2, 9],
        [1, 7],
      ],
    };

    for (const value of [wrapped, nested]) {
      const rendering = JSON.stringify(value);

      expect(JSON.stringify(scrubJson(value).value)).not.toMatch(/4.{0,6}8.{0,6}2/);
      expect({ rendering, redactions: scrubJson(value).redactions }).toEqual({
        rendering,
        redactions: ["credential-field"],
      });
      expect({ rendering, found: findKnownSecrets(rendering) }).toEqual({
        rendering,
        found: ["credential-assignment"],
      });
    }
  });

  it("keeps a list of measurements under a credential-word name intact while joining", () => {
    // The control on the join: the metric exemption is by key at every depth, so a page of
    // token counts is a page of measurements even where the walk is looking for pieces.
    const value = { tokens: [{ outputTokens: 1000 }, { outputTokens: 2000 }] };

    expect(scrubJson(value)).toEqual({ value, redactions: [] });
    expect(findKnownSecrets(JSON.stringify(value))).toEqual([]);
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

/**
 * Invariant 9 says one detector serves the write-time scrub, the export-time scan and the
 * gate, "so the three cannot drift apart". They did. These pin the property rather than any
 * one input, because every case below was found by the fuzz harness asserting the property
 * and none of them was a shape anybody would have thought to write down.
 */
describe("the write-time scrub and the export scan agree", () => {
  const artifacts = readdirSync(join(import.meta.dirname, "../../fuzz/findings"))
    // Only this boundary's artifacts. Other harnesses keep theirs in the same directory, and
    // a diff or an lcov report is not a scrub regression case.
    .filter((entry) => entry.startsWith("scrub-") && entry.endsWith(".input"))
    .sort();

  it("has the artifacts that found the drift", () => {
    expect(artifacts.length).toBeGreaterThanOrEqual(5);
  });

  for (const artifact of artifacts) {
    it(`leaves nothing for the export scan to find in ${artifact}`, () => {
      const text = readFileSync(join(import.meta.dirname, "../../fuzz/findings", artifact), "utf8");
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
