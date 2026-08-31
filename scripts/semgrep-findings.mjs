/**
 * Reads what a semgrep run found and answers the two questions the weekly scan asks about it:
 * how many findings there are, and whether this is the same set as last week.
 *
 * The second is the point. An issue that arrives every Monday saying exactly what last
 * Monday's said is one people learn to close unread, which is the failure mode this project
 * names about gates. So the finding set gets a fingerprint, the issue carries it, and a run
 * whose fingerprint already sits on an open issue files nothing.
 *
 * It also checks that the token rule was actually scoped off the fixtures it was scoped off,
 * because the alternative is silent: a rule id that no longer matches excludes nothing, the
 * nineteen findings come back, and the only symptom is the weekly issue that was already
 * being ignored.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** The rule whose findings are the scrubber's own test material wherever they sit below. */
export const tokenRuleSuffix = "detected-github-token";

/**
 * Where credential-shaped strings are written on purpose. A secret scanner reading these finds
 * secrets, correctly, and every one of them is a fixture. Scoped by path rather than silenced
 * by rule, so the same rule still fires anywhere else in the tree.
 */
export const fixturePaths = [
  "fuzz/corpus/scrub",
  "*.test.ts",
  "docs/evidence/*/shakedown/logs",
];

/** One finding, reduced to what makes it the same finding as last week's. */
function identityOf(result) {
  const line = result?.start?.line ?? 0;
  return `${result?.check_id ?? "?"}:${result?.path ?? "?"}:${line}`;
}

export function readResults(text) {
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.results) ? parsed.results : [];
}

/**
 * The set of findings, in a form two runs a week apart compare equal on. Sorted, because the
 * order semgrep reports in is not part of what was found, and line numbers included, because a
 * finding that moved to another line is a different thing to look at.
 */
export function fingerprintOf(results) {
  const identities = [...new Set(results.map(identityOf))].sort();
  return createHash("sha256").update(identities.join("\n")).digest("hex").slice(0, 12);
}

/** Findings the token scoping should have removed and did not. */
export function unscopedTokenFindings(results) {
  return results.filter((result) => String(result?.check_id ?? "").endsWith(tokenRuleSuffix));
}

export function summarize(results) {
  const byRule = new Map();
  for (const result of results) {
    const id = String(result?.check_id ?? "?");
    byRule.set(id, (byRule.get(id) ?? 0) + 1);
  }
  return [...byRule.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .map(([id, count]) => `${count} ${id}`);
}

async function main() {
  const [, , ...files] = process.argv;
  const results = [];
  for (const file of files) {
    results.push(...readResults(await readFile(file, "utf8")));
  }

  const unscoped = unscopedTokenFindings(results);
  const fingerprint = fingerprintOf(results);

  process.stdout.write(`count=${results.length}\n`);
  process.stdout.write(`fingerprint=${fingerprint}\n`);
  for (const line of summarize(results)) {
    process.stdout.write(`  ${line}\n`);
  }

  if (unscoped.length > 0) {
    // Loud rather than silent. The scoping is by rule id, and a registry rule can be renamed;
    // when that happens this is the only thing that says so.
    process.stdout.write(
      `::error::${unscoped.length} ${tokenRuleSuffix} finding(s) survived the scoping, so the ` +
        "rule id in .github/workflows/weekly-scan.yml no longer matches the rule. Correct it " +
        `against the ids in this run: ${[...new Set(unscoped.map((one) => one.check_id))].join(", ")}\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] === import.meta.filename) {
  await main();
}
