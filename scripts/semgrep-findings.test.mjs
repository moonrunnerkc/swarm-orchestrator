import { describe, expect, it } from "vitest";
import {
  fingerprintOf,
  fixturePaths,
  readResults,
  summarize,
  tokenRuleSuffix,
  unscopedTokenFindings,
} from "./semgrep-findings.mjs";

function finding(checkId, path, line) {
  return { check_id: checkId, path, start: { line } };
}

const tokenId = "generic.secrets.security.detected-github-token.detected-github-token";

describe("what a semgrep run found", () => {
  it("reads the results out of the json a run wrote", () => {
    expect(readResults(JSON.stringify({ results: [finding("a", "x.ts", 1)] }))).toHaveLength(1);
    expect(readResults(JSON.stringify({ errors: [] }))).toEqual([]);
  });

  it("counts by rule, worst first, so a body says what the run was about", () => {
    expect(
      summarize([
        finding(tokenId, "a.ts", 1),
        finding(tokenId, "b.ts", 2),
        finding("other", "c.ts", 3),
      ]),
    ).toEqual([`2 ${tokenId}`, "1 other"]);
  });
});

describe("whether this is the same set as last week", () => {
  it("gives one fingerprint to the same findings reported in another order", () => {
    const one = [finding("a", "x.ts", 1), finding("b", "y.ts", 2)];
    const other = [finding("b", "y.ts", 2), finding("a", "x.ts", 1)];

    expect(fingerprintOf(one)).toBe(fingerprintOf(other));
  });

  it("gives a different one when a finding moved, because that is a different thing to read", () => {
    expect(fingerprintOf([finding("a", "x.ts", 1)])).not.toBe(
      fingerprintOf([finding("a", "x.ts", 9)]),
    );
  });

  it("gives a different one when a finding appears or goes away", () => {
    const before = fingerprintOf([finding("a", "x.ts", 1)]);

    expect(fingerprintOf([finding("a", "x.ts", 1), finding("b", "y.ts", 1)])).not.toBe(before);
    expect(fingerprintOf([])).not.toBe(before);
  });
});

describe("whether the token scoping still holds", () => {
  it("says nothing when the fixtures produced no token finding", () => {
    expect(unscopedTokenFindings([finding("other", "src/a.ts", 3)])).toEqual([]);
  });

  it("names the findings that survived, because a stale rule id is otherwise silent", () => {
    // The failure this exists for: a registry rule renamed, so --exclude-rule matches nothing,
    // the nineteen come back, and the only symptom is the weekly issue nobody reads.
    const survived = unscopedTokenFindings([
      finding(tokenId, "fuzz/corpus/scrub/github-token", 1),
      finding("other", "src/a.ts", 3),
    ]);

    expect(survived).toHaveLength(1);
    expect(survived[0].check_id).toContain(tokenRuleSuffix);
  });
});

describe("where credential-shaped strings are written on purpose", () => {
  it("names the three places, which is what the two runs are split on", () => {
    expect(fixturePaths).toEqual([
      "fuzz/corpus/scrub",
      "*.test.ts",
      "docs/evidence/*/shakedown/logs",
    ]);
  });

  it("names every path the workflow scopes, in both directions", async () => {
    // The split only holds if the two invocations name the same set: one excluding it, one
    // including it. A path added to one and not the other silently drops a rule or repeats it.
    const { readFile } = await import("node:fs/promises");
    const workflow = await readFile(
      new URL("../.github/workflows/weekly-scan.yml", import.meta.url),
      "utf8",
    );

    for (const path of fixturePaths) {
      expect(workflow).toContain(`--exclude '${path}'`);
      expect(workflow).toContain(`--include '${path}'`);
    }
  });
});
