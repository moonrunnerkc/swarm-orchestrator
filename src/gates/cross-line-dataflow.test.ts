import { describe, expect, it } from "vitest";
import { findBlockingSecrets, findKnownSecrets } from "../evidence/scrub.ts";
import { measureTestFile } from "./measures.ts";

/**
 * Fixtures for the two gaps a shared cross-line analysis has to close, committed before the
 * analysis exists so that closure is provable rather than asserted.
 *
 * Both defeat a per-line reader for the same reason: the thing that makes them what they are
 * is spread over more than one line, and each line on its own is ordinary. Both are named in
 * docs/build-guide.md section 7.1.
 *
 * These assertions describe what the tree does today. They are meant to be inverted by the
 * change that closes them, and a diff that inverts them is the proof.
 */

const identityAcrossLines = [
  "it('checks the field', () => {",
  "  const seen = subject;",
  "  expect(seen.total).toBe(seen.total);",
  "});",
].join("\n");

const identityInOneLine = [
  "it('checks the field', () => {",
  "  expect(subject.total).toBe(subject.total);",
  "});",
].join("\n");

const memoized = [
  "it('returns the same instance twice', () => {",
  "  expect(cache.get('k')).toBe(cache.get('k'));",
  "});",
].join("\n");

describe("gap: a comparison that reduces to identity", () => {
  it("counts as an assertion today, so gutting a test moves no ratchet numeric", () => {
    // expect(x).toBe(x) over a plain property read cannot fail whatever the code does. The
    // tautology rule only knows literal against identical literal, so this counts.
    expect(measureTestFile(identityInOneLine)).toMatchObject({ tests: 1, assertions: 1 });
  });

  it("counts as one across an assignment too, which is the shape a rename produces", () => {
    expect(measureTestFile(identityAcrossLines)).toMatchObject({ tests: 1, assertions: 1 });
  });

  it("is not the same shape as a memoization test, which has to keep counting", () => {
    // The false positive any closure has to avoid: comparing two calls is a real assertion
    // about identity, and it looks the same to a purely textual reader.
    expect(measureTestFile(memoized)).toMatchObject({ tests: 1, assertions: 1 });
  });
});

// No credential word anywhere in the chain: the name-keyed half of the detector catches a
// destination called `uploadKey`, so the gap is the case where nothing is named that way.
const reassembledInSource = [
  "const head = 'AKIAIOSFO';",
  "const tail = 'DNN7EXAMPLE';",
  "export const upload = head + tail;",
].join("\n");

const wholeInSource = "export const upload = 'AKIAIOSFODNN7EXAMPLE';";

describe("gap: a credential reassembled from fragments", () => {
  it("is caught when it is written whole", () => {
    expect(findKnownSecrets(wholeInSource)).toContain("aws-access-key-id");
    expect(findBlockingSecrets(wholeInSource)).toContain("aws-access-key-id");
  });

  it("is not caught today when the same value is concatenated from two bindings", () => {
    // Neither fragment is credential-shaped and neither binding name says credential, so the
    // name-keyed detector and the shape patterns both pass over it.
    expect(findKnownSecrets(reassembledInSource)).toEqual([]);
    expect(findBlockingSecrets(reassembledInSource)).toEqual([]);
  });

  it("is not caught when the fragments sit under names that say nothing", () => {
    const parts = [
      "const left = 'ghp_';",
      "const right = 'A1b2C3d4E5f6G7h8I9j0KL';",
      "const t = left + right;",
    ].join("\n");

    expect(findKnownSecrets(parts)).toEqual([]);
  });
});
