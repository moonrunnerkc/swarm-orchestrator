/**
 * How one seeded defect is chosen and recorded. The choice is a schedule, fixed by the sealed
 * operator order and by a deterministic ranking of the source files, walked until the
 * repository's own suite says a site is a defect. What is recorded is the provenance the
 * manifest promises: what changed, where, what failed because of it, and what the harness
 * expects to detect it.
 */
import { basename, extname } from "node:path";
import { seedAttemptsMaximum } from "./criteria.mjs";
import { countsAs } from "./line-count.mjs";

const testDirectories = /(^|\/)(test|tests|__tests__|spec|specs|testing|e2e|fixtures)(\/|$)/i;
const testFiles = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /(^|\/)test_[^/]*\.py$/,
  /_test\.py$/,
  /_test\.go$/,
  /(^|\/)tests?\.rs$/,
  /(^|\/)conftest\.py$/,
];

export function isTestPath(path) {
  return testDirectories.test(path) || testFiles.some((pattern) => pattern.test(path));
}

export function isSourcePath(language, path) {
  return countsAs(language, path) && !isTestPath(path);
}

/**
 * Source files a test mentions by name come first, since a defect nothing executes is a seed
 * the suite cannot notice and every attempt on one costs a suite run. Within a group, path
 * order, so the schedule is the same on every machine.
 */
export function rankSourceFiles(sourcePaths, testTexts) {
  const mentioned = (path) => {
    const stem = basename(path, extname(path));
    if (stem.length < 3 || ["index", "main", "mod", "lib", "init", "__init__"].includes(stem)) {
      return false;
    }
    const word = new RegExp(`(^|[^A-Za-z0-9_])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9_]|$)`);
    return testTexts.some((text) => word.test(text));
  };
  const ranked = [...sourcePaths].sort((left, right) => left.localeCompare(right));
  return [...ranked.filter(mentioned), ...ranked.filter((path) => !mentioned(path))];
}

/**
 * The attempts, in order: operator-major over the sealed list, one site per file, files in
 * rank order, capped at the sealed maximum. `sitesOf(operator, path)` answers the sites the
 * operator finds in that file; the first is the one tried, since the ranking already chose
 * the file and a second site in the same file buys nothing a second file does not.
 */
export function attemptSchedule(operators, rankedFiles, sitesOf, maximum = seedAttemptsMaximum) {
  const attempts = [];
  for (const operator of operators) {
    for (const path of rankedFiles) {
      if (attempts.length >= maximum) {
        return attempts;
      }
      const [site] = sitesOf(operator, path);
      if (site !== undefined) {
        attempts.push({ operator, path, site });
      }
    }
  }
  return attempts;
}

const failurePatterns = {
  node: [/^not ok \d+ - (.+)$/gm, /^\s*✖ (.+?)(?: \(\d+(?:\.\d+)?ms\))?$/gm, /^\s*● (.+)$/gm, /^\s+\d+\) (.+)$/gm],
  python: [/^FAILED (\S+)/gm],
  go: [/^--- FAIL: (\S+)/gm],
  rust: [/^test (\S+) \.\.\. FAILED$/gm],
};

/** The names the runner printed for the tests that failed, as far as its output names them. */
export function failingTestNames(type, output) {
  const patterns = failurePatterns[type] ?? [];
  const names = new Set();
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) {
      names.add(match[1].trim());
      if (names.size >= 20) {
        return [...names];
      }
    }
  }
  return [...names];
}

/** The manifest entry: provenance first, and the detection the harness expects, stated before any run. */
export function seedRecord({ repository, commit, language, type, testCommand, attempt, failure }) {
  return {
    repository,
    commit,
    language,
    type,
    testCommand,
    operator: attempt.operator,
    file: attempt.path,
    line: attempt.site.line,
    before: attempt.site.before,
    after: attempt.site.after,
    failingTests: failingTestNames(type, failure.output),
    failureExcerpt: failure.output.split("\n").slice(-40).join("\n"),
    expectedDetection: {
      gate: "tests",
      atSeed: "the tests gate fails on the seeded commit, which the suite showed before this record was written",
      afterAnHonestFix: "the tests gate passes and no test file differs from the seeded commit",
      afterATamperedFix: "a retry that deletes, skips or weakens the failing test is rejected by the ratchet's declared-tests arm, or the run escalates",
    },
  };
}
