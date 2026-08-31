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
 * These assertions were committed describing what the tree did before the analysis existed,
 * and are inverted here by the change that closed them. The diff between the two commits is
 * the proof; the false-positive cases below were written at the same time and are unchanged,
 * which is what says the closure did not come from widening.
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

describe("a comparison that reduces to identity", () => {
  it("states nothing, so gutting a test moves the assertion numeric", () => {
    // expect(x).toBe(x) over a plain property read cannot fail whatever the code does, so it
    // is not an assertion and the ratchet sees the drop.
    expect(measureTestFile(identityInOneLine)).toMatchObject({ tests: 1, assertions: 0 });
  });

  it("states nothing across an assignment either, which is the shape a rename produces", () => {
    expect(measureTestFile(identityAcrossLines)).toMatchObject({ tests: 1, assertions: 0 });
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

describe("a credential reassembled from fragments", () => {
  it("is caught when it is written whole", () => {
    expect(findKnownSecrets(wholeInSource)).toContain("aws-access-key-id");
    expect(findBlockingSecrets(wholeInSource)).toContain("aws-access-key-id");
  });

  it("is caught when the same value is concatenated from two bindings", () => {
    // Neither fragment is credential-shaped and neither binding name says credential. What is
    // read instead is that the text itself performs the join, and what it joins to.
    expect(findKnownSecrets(reassembledInSource)).toContain("aws-access-key-id");
    expect(findBlockingSecrets(reassembledInSource)).toContain("aws-access-key-id");
  });

  it("is caught when the fragments sit under names that say nothing", () => {
    const parts = [
      "const left = 'ghp_';",
      "const right = 'A1b2C3d4E5f6G7h8I9j0KL';",
      "const t = left + right;",
    ].join("\n");

    expect(findKnownSecrets(parts)).toContain("github-token");
  });

  it("says nothing about a join that reassembles something ordinary", () => {
    // The false positive the closure has to avoid, and the reason this is keyed on the joined
    // shape rather than on adjacency: two short pieces beside each other are every version
    // tuple and every chunked payload in a real tree.
    const version = [
      "const major = '1';",
      "const minor = '4';",
      "const label = major + minor;",
    ].join("\n");

    expect(findKnownSecrets(version)).toEqual([]);
  });

  it("says nothing where one piece is not a literal, rather than guessing at it", () => {
    const runtime = ["const head = 'AKIAIOSFO';", "const upload = head + suffix;"].join("\n");

    expect(findKnownSecrets(runtime)).toEqual([]);
  });
});
