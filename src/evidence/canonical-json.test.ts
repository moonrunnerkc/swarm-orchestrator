import { describe, expect, it } from "vitest";
import {
  asJsonValue,
  canonicalJson,
  digestFileName,
  digestOfBytes,
  digestOfJson,
  digestPattern,
  NonCanonicalValueError,
} from "./canonical-json.ts";

it("hashes raw bytes with the known SHA-256 vector without decoding malformed UTF-8", () => {
  expect(digestOfBytes(Uint8Array.of(97, 98, 99))).toBe(
    "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(digestOfBytes(Uint8Array.of(255))).not.toBe(digestOfBytes("\uFFFD"));
  expect(digestOfBytes(Buffer.from("é", "utf8"))).toBe(digestOfBytes("é"));
});

describe("canonicalJson", () => {
  it("orders keys so structurally equal payloads produce identical bytes", () => {
    const one = canonicalJson({ b: 1, a: { d: 4, c: 3 } });
    const other = canonicalJson({ a: { c: 3, d: 4 }, b: 1 });

    expect(one).toBe('{"a":{"c":3,"d":4},"b":1}');
    expect(one).toBe(other);
  });

  it("keeps array order, which is content, not formatting", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("treats an absent key and a present undefined key alike", () => {
    const withUndefined = { a: 1, b: undefined } as unknown as Record<string, never>;
    expect(canonicalJson(withUndefined)).toBe(canonicalJson({ a: 1 }));
  });

  it("refuses a value with no JSON form rather than silently writing null", () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(NonCanonicalValueError);
    expect(() => canonicalJson({ ratio: Number.POSITIVE_INFINITY })).toThrow(
      NonCanonicalValueError,
    );
  });
});

describe("digests", () => {
  it("addresses identical content identically and different content differently", () => {
    expect(digestOfJson({ a: 1 })).toBe(digestOfJson({ a: 1 }));
    expect(digestOfJson({ a: 1 })).not.toBe(digestOfJson({ a: 2 }));
  });

  it("is a sha256 of the canonical bytes", () => {
    expect(digestOfJson({ a: 1 })).toBe(digestOfBytes('{"a":1}'));
    expect(digestOfJson({ a: 1 })).toMatch(digestPattern);
  });

  it("names a blob file after the digest without its algorithm prefix", () => {
    expect(digestFileName(`sha256:${"ab".repeat(32)}`)).toBe(`${"ab".repeat(32)}.json`);
  });
});

describe("asJsonValue", () => {
  it("keeps recordable values and drops undefined properties", () => {
    expect(asJsonValue({ path: "src/a.ts", limit: undefined, nested: [1, true, null] })).toEqual({
      path: "src/a.ts",
      nested: [1, true, null],
    });
  });

  it("records unrepresentable values as their type rather than losing the field", () => {
    expect(asJsonValue({ callback: () => 1, size: 10n })).toEqual({
      callback: "[function]",
      size: "10",
    });
  });

  it("converts a non-finite number to text so the payload stays canonical", () => {
    expect(canonicalJson(asJsonValue({ ratio: Number.NaN }))).toBe('{"ratio":"NaN"}');
  });
});
