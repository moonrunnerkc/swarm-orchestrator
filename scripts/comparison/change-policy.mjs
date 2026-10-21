/**
 * The one allowed-change policy of the comparison: what both arms are told they may change, and
 * what every delivered patch, the upstream reference included, is held to at scoring.
 *
 * The first ordinary comparison on minimatch (docs/evidence/2026-10-20/ordinary-comparison)
 * froze the whole `test/` directory for Swarm because the hidden test would later be placed
 * there, told OpenCode nothing of the kind, and validated the reference with its test changes
 * included. Swarm asked to add `test/partial.js` for coverage and was refused; the project's
 * 100% coverage rule then failed both arms for branches no test reached. The policy here
 * replaces that: an agent may write implementation code and regression tests; it may not
 * delete or weaken what the project already checks, or change how the checks run.
 *
 * Hidden evaluation material stays in the sealed mirror until scoring, whatever this policy
 * says about the directory it will be written to. A hidden file an arm happened to write at the
 * same path is displaced by the overlay at scoring and the record says so (checks.mjs).
 */

/**
 * Files that configure how a project's tests and coverage run. Protected for both arms, as paths:
 * Swarm's contract makes them immutable, the task text tells OpenCode the same, and the patch
 * policy rejects either arm's change to them. Named one by one because the product's contract
 * takes paths, not patterns.
 */
export const runnerConfigurationPaths = [
  ".taprc",
  ".taprc.json",
  ".taprc.yaml",
  ".taprc.yml",
  ".nycrc",
  ".nycrc.json",
  ".nycrc.yaml",
  ".nycrc.yml",
  ".c8rc",
  ".c8rc.json",
  ".mocharc.js",
  ".mocharc.cjs",
  ".mocharc.mjs",
  ".mocharc.json",
  ".mocharc.yaml",
  ".mocharc.yml",
  "jest.config.js",
  "jest.config.cjs",
  "jest.config.mjs",
  "jest.config.ts",
  "jest.config.json",
  "vitest.config.js",
  "vitest.config.mjs",
  "vitest.config.ts",
  "vitest.workspace.js",
  "vitest.workspace.mjs",
  "vitest.workspace.ts",
  "ava.config.js",
  "ava.config.cjs",
  "ava.config.mjs",
  "karma.conf.js",
  "karma.conf.cjs",
];

/** The package.json keys that run or configure the project's tests; a change to any is a changed check. */
export const protectedManifestKeys = [
  "scripts.test",
  "scripts.pretest",
  "scripts.posttest",
  "tap",
  "nyc",
  "c8",
  "jest",
  "mocha",
  "ava",
  "vitest",
];

/** Where the visible check lives: the directory both arms are told not to touch. */
export const visibleCheckDirectory = (task) => task.visible.path.split("/").slice(0, -1).join("/");

/**
 * Every path protected for a task: the visible check's directory, what the task itself declares
 * immutable, and the runner configuration files. The same list reaches Swarm's contract and the
 * patch policy; the task text names them for both arms.
 */
export function protectedPaths(task) {
  return [
    ...new Set([visibleCheckDirectory(task), ...task.immutable, ...runnerConfigurationPaths]),
  ];
}

/** The policy as both arms read it, after the task text. */
export function policyLines(task) {
  const immutable = [visibleCheckDirectory(task), ...task.immutable].map((path) => `${path}/`);
  return [
    "Allowed changes: implementation code, and regression tests for the change (new test files, or new cases added to existing test files, in the project's own test directory and style).",
    `Do not modify anything under ${immutable.join(" or ")}.`,
    "Do not change how the project's checks run: leave the test and coverage configuration files (.taprc*, .nycrc*, .c8rc*, .mocharc*, jest.config.*, vitest.config.*, ava.config.*, karma.conf.*) and the test, pretest and posttest scripts and runner sections of package.json as they are.",
    "Do not delete or weaken existing tests: keep every existing assertion (it may move to another test file), add no skip, only or todo markers, and add no coverage-ignore pragmas. A change that does any of these is rejected at evaluation whatever else passes.",
  ];
}

/** A file in the project's tests, by the conventions this comparison's projects use. */
export function isTestFile(path) {
  return (
    /(^|\/)(test|tests|spec|specs|__tests__)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

/**
 * The assertion calls on a line: the project's assertion objects (`t`, `assert`, `expect`,
 * `should`) called by method, and the bare `expect(` and `assert(` forms. `t.plan`, `t.test`
 * and the like are structure, not assertions, and are left out by name.
 */
const structureMethods = new Set([
  "plan",
  "test",
  "describe",
  "it",
  "before",
  "after",
  "beforeEach",
  "afterEach",
  "end",
  "comment",
  "skip",
  "todo",
  "only",
  "teardown",
  "setTimeout",
  "cleanSnapshot",
  "formatSnapshot",
]);

/**
 * The assertion objects as the projects name them: tap's test handle in its usual spellings
 * (`t`, and `ct`, `st`, `tt` for a subtest), node's and chai's `assert`, jest's `expect`, chai's
 * `should`, and referee's `assert` and `refute`.
 */
const assertionObjects = /\b(t|ct|st|tt|assert|refute|expect|should)\s*\.\s*([A-Za-z_]\w*)\s*\(/g;

export function countAssertions(line) {
  let count = 0;
  for (const match of line.matchAll(assertionObjects)) {
    if (!structureMethods.has(match[2])) count += 1;
  }
  count += (line.match(/(?<![\w.])(expect|assert|refute)\s*\(/g) ?? []).length;
  return count;
}

/** Markers that make a test case not run or make only some run. */
const skipMarkers =
  /\.(skip|only|todo)\s*\(|\b(xit|xdescribe|xtest|xcontext)\s*\(|\bthis\.skip\s*\(|\b(skip|todo|only)\s*:\s*(true|['"`])/;

/** Pragmas that take lines out of a coverage measurement. */
const coverageExclusions =
  /\b(c8|v8|istanbul)\s+ignore\b|node:coverage\s+(disable|ignore)|coverage-ignore|\/\*\s*ignore coverage/i;

/** One file of a unified diff: where it was and is, how it changed, and its changed lines. */
export function parsePatch(patch) {
  const files = [];
  let current = null;
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      current = {
        path: header[2],
        oldPath: header[1],
        status: "modified",
        added: [],
        removed: [],
      };
      files.push(current);
      continue;
    }
    if (current === null) continue;
    if (/^new file mode /.test(line)) current.status = "added";
    else if (/^deleted file mode /.test(line)) current.status = "deleted";
    else if (/^rename from /.test(line)) current.status = "renamed";
    else if (
      /^\+\+\+ |^--- |^index |^similarity |^rename to |^old mode |^new mode |^Binary /.test(line)
    ) {
    } else if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files;
}

const valueAt = (object, path) =>
  path.split(".").reduce((value, key) => (value == null ? undefined : value[key]), object);

const protects = (root, path) => path === root || path.startsWith(`${root}/`);

/**
 * The verdict of the policy over one patch. `readAfter(path)` reads a file of the tree with the
 * patch applied (null where absent); only package.json is read, to compare its protected keys
 * with the base's, which `readBase(path)` reads from the sealed mirror. Everything else is read
 * from the patch itself. Each violation names its rule and its file, so an arm's loss under this
 * policy is attributable and so a reference that depends on a forbidden change is visible.
 */
export async function changePolicyVerdict(patch, task, { readBase, readAfter }) {
  const files = parsePatch(patch);
  const violations = [];
  const protectedList = protectedPaths(task);
  let addedAssertions = 0;
  let removedAssertions = 0;
  const testFilesAdded = [];
  const testFilesTouched = [];
  for (const file of files) {
    for (const path of new Set([file.path, file.oldPath])) {
      const hit = protectedList.find((root) => protects(root, path));
      if (hit !== undefined)
        violations.push({
          rule: "protected-path",
          path,
          detail: `${path} is under the protected path ${hit}`,
        });
    }
    const exclusion = file.added.find((line) => coverageExclusions.test(line));
    if (exclusion !== undefined)
      violations.push({
        rule: "coverage-exclusion",
        path: file.path,
        detail: `adds a coverage exclusion: ${exclusion.trim()}`,
      });
    if (!isTestFile(file.path) && !isTestFile(file.oldPath)) continue;
    testFilesTouched.push(file.path);
    if (file.status === "added") testFilesAdded.push(file.path);
    const skip = file.added.find((line) => skipMarkers.test(line));
    if (skip !== undefined)
      violations.push({
        rule: "skip-marker",
        path: file.path,
        detail: `adds a skip, only or todo marker: ${skip.trim()}`,
      });
    for (const line of file.added) addedAssertions += countAssertions(line);
    for (const line of file.removed) removedAssertions += countAssertions(line);
  }
  if (removedAssertions > addedAssertions)
    violations.push({
      rule: "assertions-removed",
      path: null,
      detail: `${removedAssertions} assertion(s) removed from test files and ${addedAssertions} added: existing assertions are not kept`,
    });
  const manifest = files.find(
    (file) => file.path === "package.json" || file.oldPath === "package.json",
  );
  if (manifest !== undefined) {
    const before = parseJson(await readBase("package.json"));
    const after = parseJson(await readAfter("package.json"));
    for (const key of protectedManifestKeys) {
      const was = JSON.stringify(valueAt(before, key) ?? null);
      const is = JSON.stringify(valueAt(after, key) ?? null);
      if (was !== is)
        violations.push({
          rule: "check-configuration",
          path: "package.json",
          detail: `package.json ${key} changed from ${was} to ${is}`,
        });
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    addedAssertions,
    removedAssertions,
    testFilesAdded,
    testFilesTouched,
  };
}

function parseJson(text) {
  if (text === null || text === undefined) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** One line for a record or a table: the verdict and every violation by rule and file. */
export function describePolicy(verdict) {
  if (verdict.ok)
    return `allowed-change policy satisfied (${verdict.addedAssertions} assertion(s) added in ${verdict.testFilesTouched.length} test file(s), ${verdict.removedAssertions} removed)`;
  return `allowed-change policy violated: ${verdict.violations.map((one) => `${one.rule}${one.path ? ` (${one.path})` : ""}: ${one.detail}`).join("; ")}`;
}
