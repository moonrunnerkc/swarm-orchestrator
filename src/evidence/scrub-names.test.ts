import { describe, expect, it } from "vitest";
import { scrubJson } from "./scrub.ts";

describe("detection keyed on the name rather than the shape of the value", () => {
  it("redacts a numeric credential at write time, whatever shape the value takes", () => {
    for (const [text, expected] of [
      ["API_KEY=48291736", "API_KEY=[redacted:credential-assignment]"],
      ["PIN=482917", "PIN=[redacted:credential-assignment]"],
      ["otp: 847291", "otp: [redacted:credential-assignment]"],
      ["accountNumber=123456789012", "accountNumber=[redacted:credential-assignment]"],
    ] as const) {
      const outcome = scrubJson(text);

      expect({ text, value: outcome.value }).toEqual({ text, value: expected });
      expect(outcome.redactions).toContain("credential-assignment");
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
    expect(scrubJson(serialized).redactions).toEqual([]);
  });

  it("leaves a known metric key alone by name, whatever its value", () => {
    // The exemption is by key, not by value: an integer throughput number is still a metric,
    // and this is the case that made the previous detector let real PINs through.
    const serialized =
      '{"outputTokensPerSecond":129.90418363640293,"firstTokenMs":763.77,' +
      '"outputTokens":1482917,"maxTokens":1000000,"secretMatches":4821}';

    expect(scrubJson(serialized)).toEqual({ value: serialized, redactions: [] });
    expect(scrubJson(JSON.parse(serialized) as Record<string, number>).redactions).toEqual([]);
  });

  it("leaves a bare numeric literal with no credential-shaped key alone", () => {
    const serialized = '{"durationMs":482917,"outputBytes":123456789012,"exitCode":0}';

    expect(scrubJson(serialized)).toEqual({ value: serialized, redactions: [] });
  });

  it("is idempotent over a payload, so a blob digest survives a second pass", () => {
    const once = scrubJson({
      account: "accountNumber=123456789012",
      env: { API_KEY: 48291736 },
    }).value;
    const twice = scrubJson(once);

    expect(twice.value).toEqual(once);
    expect(twice.redactions).toEqual([]);
    expect(scrubJson(JSON.stringify(once)).redactions).toEqual([]);
  });

  it("does not read a credential word buried inside an ordinary word", () => {
    for (const text of ['{"mapping":48291736}', '{"spinCount":123456}', '{"pinned":48291736}']) {
      expect({ text, ...scrubJson(text) }).toEqual({ text, value: text, redactions: [] });
    }
  });

  it("redacts a credential under an HTTP auth header name, as text and as a field", () => {
    for (const name of ["Authorization", "proxy-authorization", "WWW-Authenticate"]) {
      const text = `${name}: 48291736`;

      expect({ name, ...scrubJson(text) }).toEqual({
        name,
        value: `${name}: [redacted:credential-assignment]`,
        redactions: ["credential-assignment"],
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
      expect({ items, again: scrubJson(blob).redactions }).toEqual({ items, again: [] });
      // A string holding a JSON document is walked rather than scanned as lines, so the marker
      // lands as a value and the result still parses. Splicing it in as text gave back
      // {"PIN":[redacted:...]}, which is not JSON.
      expect({ items, scrubbed: scrubJson(text).value }).toEqual({
        items,
        scrubbed: '{"PIN":"[redacted:credential-field]"}',
      });
      expect(() => JSON.parse(scrubJson(text).value as string) as unknown).not.toThrow();
    }
  });

  it("leaves an array of ordinary short values under a credential name alone", () => {
    const outcome = scrubJson({ keys: ["a", "b"], tokens: [1, 2, 3] });

    expect(outcome.value).toEqual({ keys: ["a", "b"], tokens: [1, 2, 3] });
    expect(outcome.redactions).toEqual([]);
  });

  it("leaves a version tuple alone, whichever way it is rendered", () => {
    // The control behind the residual: treating adjacent short values as one value is what a
    // reassembling detector would have to do, and this is what it would cost. Nothing here is
    // under a credential name, so nothing here is a credential.
    const value = { version: [13, 0, 1], parts: ["ab", "cd", "ef"] };

    expect(scrubJson(value)).toEqual({ value, redactions: [] });
    for (const rendering of [JSON.stringify(value), JSON.stringify(value, null, 2)]) {
      expect({ rendering, found: scrubJson(rendering).redactions }).toEqual({
        rendering,
        found: [],
      });
    }
  });

  it("keeps the metric exemption exact, nested or not, as a payload or as text", () => {
    const metrics = {
      outputTokensPerSecond: 129.9,
      maxTokens: 1000000,
      tokenCount: 48291736,
      reservedTokens: 600000,
    };
    const text = JSON.stringify({ credentials: metrics });

    expect(scrubJson({ credentials: metrics }).redactions).toEqual([]);
    expect(scrubJson({ credentials: metrics }).value).toEqual({ credentials: metrics });
    expect(scrubJson(text)).toEqual({ value: text, redactions: [] });
    const credential = { reservedApiToken: metrics.reservedTokens };
    expect(scrubJson(credential).value).toEqual({
      reservedApiToken: "[redacted:credential-field]",
    });
    expect(scrubJson(JSON.stringify(credential)).value).toBe(
      '{"reservedApiToken":"[redacted:credential-field]"}',
    );
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
      // The same payload pretty-printed into a string, name and value read by the walk.
      expect({ name, found: scrubJson(rendering).redactions }).toEqual({
        name,
        found: ["credential-field"],
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
      expect({ rendering, found: scrubJson(rendering).redactions }).toEqual({
        rendering,
        found: ["credential-field"],
      });
    }
  });

  it("keeps a list of measurements under a credential-word name intact while joining", () => {
    // The control on the join: the metric exemption is by key at every depth, so a page of
    // token counts is a page of measurements even where the walk is looking for pieces.
    const value = { tokens: [{ outputTokens: 1000 }, { outputTokens: 2000 }] };

    expect(scrubJson(value)).toEqual({ value, redactions: [] });
    expect(scrubJson(JSON.stringify(value)).redactions).toEqual([]);
  });

  it("redacts an opaque value under a credential key in source text", () => {
    // Scrubbing is fail-safe, so over-matching costs nothing.
    const outcome = scrubJson("createElement(Text, { key: gate.gateId }, label)");

    expect(outcome.redactions).toEqual(["credential-assignment"]);
  });

  it("reads malformed JSON as text, and still redacts what its lines assign", () => {
    const outcome = scrubJson('{"password": "hunter2", "truncated": ');

    expect(outcome.value).not.toContain("hunter2");
    expect(outcome.redactions).toEqual(["credential-assignment"]);
  });

  it("walks a JSON document carried in a string inside a payload", () => {
    const printed = JSON.stringify({ db: { password: "hunter2" } }, null, 2);
    const outcome = scrubJson({ command: "cat config.json", output: printed });

    expect(JSON.stringify(outcome.value)).not.toContain("hunter2");
    expect(scrubJson(outcome.value).redactions).toEqual([]);
  });
});
