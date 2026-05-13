import * as fs from 'fs';
import * as path from 'path';

/**
 * Test-framework identifier the synthesizer dispatches on for prompt guidance
 * and on-disk placement. Detection is intentionally narrow: it answers "what
 * are the rules for placing a regression test in this repo?" and nothing
 * else. Anything finer (which test runner version, which fixture style, …)
 * lives in the prompt guidance string and is the LLM's responsibility to
 * apply.
 *
 * Python frameworks (SWE-bench corpus and Python repos):
 * - `django-runtests`: a Django source-checkout-style repo with
 *   `tests/runtests.py`. Test placement and discovery follow Django's dotted-
 *   module convention; flattening to the repo root breaks
 *   `runtests.py <module>.test_<name>` lookups.
 * - `pytest-with-runtests`: pylint-style: pytest is the runner, but the repo
 *   ships its own `tests/runtests.py`-shape entry point alongside a real
 *   `conftest.py`. Treated like `pytest-standard` for placement; the prompt
 *   guidance flags the dual-runner setup so the LLM does not regress to the
 *   custom entry point.
 * - `pytest-standard`: a `conftest.py` at the repo root or under `tests/`,
 *   no Django markers. The dominant SWE-bench shape (sympy, sphinx, pytest
 *   itself, pylint, requests, etc.).
 * - `unittest-discover`: a `tests/` directory with no `conftest.py` and no
 *   Django markers. Test runner is `python -m unittest`. Rare in the
 *   v7-critical-path multi-repo corpus.
 * - `pytest-fallback`: a Python repo with no specific marker. Default to
 *   pytest because it is the most permissive runner; an actual collection
 *   failure surfaces in the `--collect-only` preflight rather than
 *   masquerading as a passing regression test. Only reached after the JS
 *   detection branch has ruled out a Node/JS project.
 *
 * Node / JavaScript / TypeScript frameworks (any repo with a `package.json`):
 * - `js-ava`: ava declared in dependencies/devDependencies.
 * - `js-mocha`: mocha declared in dependencies/devDependencies.
 * - `js-jest`: jest declared in dependencies/devDependencies.
 * - `js-vitest`: vitest declared in dependencies/devDependencies.
 * - `js-node-test`: Node ≥ 20 built-in `node --test` runner inferred from
 *   `scripts.test`.
 * - `js-fallback`: `package.json` exists but no recognized framework. The
 *   synthesizer prompt asks the LLM to inspect the repo's existing test
 *   conventions and emit a self-contained command that runs the candidate
 *   test only.
 */
export type TestFramework =
  | 'django-runtests'
  | 'pytest-with-runtests'
  | 'pytest-standard'
  | 'unittest-discover'
  | 'pytest-fallback'
  | 'js-ava'
  | 'js-mocha'
  | 'js-jest'
  | 'js-vitest'
  | 'js-node-test'
  | 'js-fallback';

/**
 * Per-framework metadata the synthesizer consumes. The split between
 * placement decision (`preserveDirectoryStructure`) and prompt guidance
 * keeps the code-path branching deterministic while leaving the LLM-facing
 * surface as pure text.
 */
export interface FrameworkProfile {
  framework: TestFramework;
  /** Short label used in the synthesizer prompt header. */
  label: string;
  /**
   * When true, `writeCandidate` keeps the LLM's `testFilePath` directory
   * structure and only prefixes the basename. When false, the test file is
   * flattened to the repo root (the legacy default; required by candidates
   * like `psf__requests-1766`'s digest test that compute paths from
   * `__file__` and would shadow the local source from a deeper directory).
   */
  preserveDirectoryStructure: boolean;
  /** Multiline guidance block the synthesizer prompt embeds verbatim. */
  promptGuidance: string;
  /**
   * Whether the framework runs `pytest --collect-only` as a structural
   * preflight against the candidate before the base run. Django's runtests
   * harness has its own discovery path; running `--collect-only` against a
   * Django test would pass even when `runtests.py <module>` cannot import
   * it. The base run already exercises Django's discovery; no extra
   * preflight is needed.
   */
  pytestCollectPreflight: boolean;
}

const PROMPT_NO_HARDCODED_VENV = [
  'IMPORTANT: do NOT hardcode `.venv/bin/python`, `.venv/bin/pytest`, or any',
  '`./venv/bin/...` literal in `testCommand`. The eval harness wraps PATH so',
  'bare `python`, `python3`, `pip`, and `pytest` resolve to the per-instance',
  'virtualenv. Hardcoded relative venv paths break in the gold worktree',
  '(temporary `/tmp/swarm-eval-worktree-*` checkout, no `.venv/` present).',
].join('\n');

const PROMPT_COLLECT_VALID = [
  'Your test must be syntactically valid Python that pytest can collect.',
  'No undefined imports. No missing fixtures. No top-level statements that',
  'raise at import time. The harness runs `pytest --collect-only` against',
  'your candidate before the base run; collection failures are rejected.',
].join('\n');

const DJANGO_GUIDANCE = [
  'TEST FRAMEWORK: Django dev-checkout (`tests/runtests.py`).',
  'Place your test under the existing `tests/<app_label>/` directory whose',
  'dotted module path Django can import. Example: a regression for a',
  '`file_storage` bug goes at `tests/file_storage/test_<name>.py` and is run',
  'with `python tests/runtests.py file_storage.test_<name>`. The harness',
  'preserves your `testFilePath` directory structure (only the basename is',
  'prefixed with `swarm-synth-attempt-N-`); choosing the wrong directory or',
  'flattening to repo root will cause `ModuleNotFoundError` on both base and',
  'gold runs.',
  '',
  'testCommand template: `python tests/runtests.py <app_label>.<module_basename_without_extension>`.',
  '',
  PROMPT_NO_HARDCODED_VENV,
].join('\n');

const PYTEST_STANDARD_GUIDANCE = [
  'TEST FRAMEWORK: pytest-standard.',
  'Place your test at the repo root (the harness flattens any directory you',
  'specify). Use bare imports from the package under test; do not assume the',
  'test sits inside a `tests/` package.',
  '',
  'testCommand template: `python -m pytest <test_file_basename> -v`.',
  '',
  PROMPT_COLLECT_VALID,
  '',
  PROMPT_NO_HARDCODED_VENV,
].join('\n');

const PYTEST_WITH_RUNTESTS_GUIDANCE = [
  'TEST FRAMEWORK: pytest-with-runtests (the repo ships both pytest and a',
  'custom `tests/runtests.py`-shaped entry point).',
  'Use plain pytest, NOT the custom entry point. Place your test at the repo',
  'root; the harness flattens any directory you specify. Use bare imports',
  'from the package under test.',
  '',
  'testCommand template: `python -m pytest <test_file_basename> -v`.',
  '',
  PROMPT_COLLECT_VALID,
  '',
  PROMPT_NO_HARDCODED_VENV,
].join('\n');

const UNITTEST_GUIDANCE = [
  'TEST FRAMEWORK: unittest-discover.',
  'Place your test at the repo root; the harness flattens any directory you',
  'specify. Subclass `unittest.TestCase` and use the standard `assertEqual`,',
  '`assertTrue`, etc. assertion API.',
  '',
  'testCommand template: `python -m unittest <test_module_name_without_extension>`.',
  '',
  PROMPT_NO_HARDCODED_VENV,
].join('\n');

const FALLBACK_GUIDANCE = [
  'TEST FRAMEWORK: pytest (fallback; framework detection did not match a',
  'specific shape, defaulting to pytest as the most permissive runner).',
  'Place your test at the repo root; the harness flattens any directory you',
  'specify. Prefer pytest-style bare `assert` and explicit imports.',
  '',
  'testCommand template: `python -m pytest <test_file_basename> -v`.',
  '',
  PROMPT_COLLECT_VALID,
  '',
  PROMPT_NO_HARDCODED_VENV,
].join('\n');

// Shared guidance for every JS/TS profile: the LLM must mirror the project's
// existing test infrastructure rather than inventing a parallel one. ow's
// `NODE_OPTIONS='--import=tsx/esm'` is the canonical example — a candidate
// that omits the loader cannot import `.ts` test files at all. The prompt
// directs the LLM to read package.json `scripts.test` so the testCommand
// inherits any required loader / env / runtime hooks the project already
// uses. Hardcoded `.venv/...` literals are a Python-only failure mode and
// do not appear here.
const JS_COMMON_GUIDANCE = [
  'Inspect the repo before emitting `testCommand`. Read `package.json`',
  '(its `scripts.test` and `type` fields) and at least one existing test',
  'file from the project so your candidate matches the project\'s loader,',
  'extension, and module-system conventions.',
  '',
  'Specifically:',
  '- If `scripts.test` sets `NODE_OPTIONS` (e.g. `--import=tsx/esm` for',
  '  TypeScript), set the same `NODE_OPTIONS` in your `testCommand` —',
  '  otherwise `.ts` test files cannot import.',
  '- Match the existing test files\' extension (`.ts` vs `.js`) and module',
  '  syntax (ESM `import` vs CJS `require`) verbatim.',
  '- Use `npx <runner>` rather than the project\'s `npm test` script so',
  '  your candidate runs only the new file, not the entire suite.',
  '- Prefer placing the test alongside the existing tests (e.g. the repo\'s',
  '  `test/` or `__tests__/` directory) — the harness preserves your',
  '  `testFilePath` directory structure.',
].join('\n');

const JS_AVA_GUIDANCE = [
  'TEST FRAMEWORK: ava.',
  '',
  'testCommand template: `npx ava <testFilePath>` — with whatever',
  '`NODE_OPTIONS` / loader the repo\'s own `scripts.test` uses.',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const JS_MOCHA_GUIDANCE = [
  'TEST FRAMEWORK: mocha.',
  '',
  'testCommand template: `npx mocha <testFilePath>` — with the runtime',
  'flags the repo\'s own test script uses (e.g. `--loader=ts-node/esm`).',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const JS_JEST_GUIDANCE = [
  'TEST FRAMEWORK: jest.',
  '',
  'testCommand template: `npx jest --runTestsByPath <testFilePath>`. Use',
  '`--runTestsByPath` so the literal path is honored rather than treated',
  'as a test-name regex.',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const JS_VITEST_GUIDANCE = [
  'TEST FRAMEWORK: vitest.',
  '',
  'testCommand template: `npx vitest run <testFilePath>` — the `run`',
  'subcommand is required to disable watch mode in non-interactive use.',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const JS_NODE_TEST_GUIDANCE = [
  'TEST FRAMEWORK: Node.js built-in `node:test` runner (Node ≥ 20).',
  '',
  'testCommand template: `node --test <testFilePath>` — with any',
  '`NODE_OPTIONS` the repo\'s own test script uses (e.g.',
  '`--import=tsx/esm` for `.ts` files).',
  '',
  'Import via `import { test } from \'node:test\'` and assert via',
  '`node:assert/strict`. Do not import a third-party runner.',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const JS_FALLBACK_GUIDANCE = [
  'TEST FRAMEWORK: Node.js project (no specific test framework detected).',
  '',
  'Decide on a runner by inspecting the repo. If `package.json` declares',
  'jest, vitest, mocha, or ava in `dependencies`/`devDependencies`, use',
  'that. Otherwise prefer Node\'s built-in `node:test` runner so the',
  'candidate runs with no extra install step.',
  '',
  JS_COMMON_GUIDANCE,
].join('\n');

const PROFILES: Readonly<Record<TestFramework, FrameworkProfile>> = Object.freeze({
  'django-runtests': {
    framework: 'django-runtests',
    label: 'Django dev-checkout',
    preserveDirectoryStructure: true,
    promptGuidance: DJANGO_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'pytest-with-runtests': {
    framework: 'pytest-with-runtests',
    label: 'pytest with custom runtests entry point',
    preserveDirectoryStructure: false,
    promptGuidance: PYTEST_WITH_RUNTESTS_GUIDANCE,
    pytestCollectPreflight: true,
  },
  'pytest-standard': {
    framework: 'pytest-standard',
    label: 'pytest',
    preserveDirectoryStructure: false,
    promptGuidance: PYTEST_STANDARD_GUIDANCE,
    pytestCollectPreflight: true,
  },
  'unittest-discover': {
    framework: 'unittest-discover',
    label: 'unittest',
    preserveDirectoryStructure: false,
    promptGuidance: UNITTEST_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'pytest-fallback': {
    framework: 'pytest-fallback',
    label: 'pytest (fallback)',
    preserveDirectoryStructure: false,
    promptGuidance: FALLBACK_GUIDANCE,
    pytestCollectPreflight: true,
  },
  'js-ava': {
    framework: 'js-ava',
    label: 'ava',
    preserveDirectoryStructure: true,
    promptGuidance: JS_AVA_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'js-mocha': {
    framework: 'js-mocha',
    label: 'mocha',
    preserveDirectoryStructure: true,
    promptGuidance: JS_MOCHA_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'js-jest': {
    framework: 'js-jest',
    label: 'jest',
    preserveDirectoryStructure: true,
    promptGuidance: JS_JEST_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'js-vitest': {
    framework: 'js-vitest',
    label: 'vitest',
    preserveDirectoryStructure: true,
    promptGuidance: JS_VITEST_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'js-node-test': {
    framework: 'js-node-test',
    label: 'node --test',
    preserveDirectoryStructure: true,
    promptGuidance: JS_NODE_TEST_GUIDANCE,
    pytestCollectPreflight: false,
  },
  'js-fallback': {
    framework: 'js-fallback',
    label: 'node (fallback)',
    preserveDirectoryStructure: true,
    promptGuidance: JS_FALLBACK_GUIDANCE,
    pytestCollectPreflight: false,
  },
});

function isFile(repoPath: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(repoPath, rel)).isFile();
  } catch {
    return false;
  }
}

function isDir(repoPath: string, rel: string): boolean {
  try {
    return fs.statSync(path.join(repoPath, rel)).isDirectory();
  } catch {
    return false;
  }
}

/** Parsed shape of the fields {@link readPackageJson} extracts from package.json. */
interface ParsedPackageJson {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/**
 * Read `package.json` at the repo root and return the subset of fields the
 * JS framework detection consumes. Returns `null` when the file is absent
 * or unparseable — both cases indicate "not a Node project for our
 * purposes" and route detection through the Python branch.
 *
 * Pure I/O helper; no network, no spawning. Swallowing JSON.parse errors
 * is intentional: a malformed package.json should not crash detection,
 * because the eventual fallback profile still produces a usable prompt.
 *
 * @param repoPath - Absolute path to the repo root being inspected.
 * @returns Parsed scripts/dependencies/devDependencies or null.
 */
function readPackageJson(repoPath: string): ParsedPackageJson | null {
  const packageJsonPath = path.join(repoPath, 'package.json');
  if (!isFile(repoPath, 'package.json')) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ParsedPackageJson;
  } catch {
    return null;
  }
}

/**
 * Pick the JS test framework from a parsed package.json. Detection priority
 * is "explicit dependency first, then test-script inference" — mirrors the
 * detection in `src/contract/compiler.ts` so the contract compiler and the
 * synthesizer route the same repo to the same framework. Order among
 * dependency-declared runners (jest > vitest > mocha > ava) is the order
 * we see them in practice; a repo declaring two is rare and the first
 * match wins deterministically.
 *
 * Returns `null` when nothing matches; callers then resolve to the
 * `js-fallback` profile, which still routes through the JS branch and
 * keeps the candidate file under a Node-compatible runner.
 *
 * @param pkg - Parsed package.json fields.
 * @returns The matching JS framework identifier, or null when undecided.
 */
function pickJsFramework(
  pkg: ParsedPackageJson,
): Extract<TestFramework, `js-${string}`> | null {
  const deps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };
  // Order: jest > vitest > mocha > ava is "most likely to be the canonical
  // runner if multiply declared." A repo declaring both jest and ava
  // almost always uses jest as the primary; ava-as-secondary appears in
  // tooling repos that vendor a sample harness. The first-match rule keeps
  // detection deterministic without modeling "which one ran most recently".
  if ('jest' in deps) return 'js-jest';
  if ('vitest' in deps) return 'js-vitest';
  if ('mocha' in deps) return 'js-mocha';
  if ('ava' in deps) return 'js-ava';
  // Node's built-in runner. Match `node --test`, `node:test`, and the
  // `--test` shorthand that piggybacks on a test file glob. Mirrors the
  // regex in `src/contract/compiler.ts:detectNodeTestFramework`.
  const testScript = pkg.scripts?.test ?? '';
  if (/\bnode\b[^|;&]*--test\b/.test(testScript)) return 'js-node-test';
  if (/\bnode:test\b/.test(testScript)) return 'js-node-test';
  return null;
}

/**
 * Inspect the repo on disk and return the framework profile the synthesizer
 * should use. Pure filesystem inspection — no network, no spawning, no LLM
 * calls.
 *
 * Routing rule: `package.json` at the repo root is the language signal. A
 * repo with `package.json` is a Node/JS/TS project and routes through the
 * JS branch (jest > vitest > mocha > ava > node-test > js-fallback). A
 * repo without `package.json` routes through the Python branch (the
 * existing django > pytest > unittest > pytest-fallback chain).
 *
 * Without this language gate, JS repos with a `tests/` directory used to
 * be classified as `unittest-discover` (Python heuristic), and JS repos
 * without any `tests/` directory fell through to `pytest-fallback` — the
 * synthesizer then prompted the LLM to write a Python pytest file on a
 * Node project. The 2026-05 ow comparison run exhibited the latter mode:
 * a TypeScript repo received Python prompt guidance and pytest preflight,
 * the host had no pytest installed, every attempt was rejected as a
 * `collection-error`, and synthesis ultimately failed AMBIGUOUS_GOAL
 * before a single worker step ran.
 *
 * The fallback inside each branch is intentionally permissive — the prompt
 * guidance directs the LLM to inspect the repo and mirror its conventions,
 * which is more robust than silently picking the wrong framework.
 *
 * @param repoPath - Absolute path to the repo root being analyzed.
 * @returns The matching framework profile, with prompt guidance and
 *          placement rule the synthesizer consumes.
 */
export function detectTestFramework(repoPath: string): FrameworkProfile {
  // Language gate: `package.json` at the root means Node/JS/TS. The
  // language is more discriminating than any directory layout heuristic —
  // a JS repo with a `tests/` directory is still a JS repo and must not
  // be routed to `unittest-discover`.
  const pkg = readPackageJson(repoPath);
  if (pkg !== null) {
    const framework = pickJsFramework(pkg);
    return PROFILES[framework ?? 'js-fallback'];
  }

  // Django-runtests: presence of `tests/runtests.py` at the repo root is
  // the discriminating feature for a Django source-checkout. The Django
  // source repo (the only Django shape in the SWE-bench corpus) ships
  // this file as its canonical test entry point. We do NOT key on
  // `manage.py` because the Django source repo does not have one at
  // root; user Django apps do but are out of corpus scope.
  if (isFile(repoPath, 'tests/runtests.py')) {
    return PROFILES['django-runtests'];
  }
  // pytest-with-runtests: pylint-shape. A `pylintrc` (or `pyproject.toml`
  // declaring `[tool.pylint]`) plus a real conftest.py marks pylint's
  // pytest-with-side-channel layout. We accept either pylintrc or its
  // older `.pylintrc` alias because both appear in the SWE-bench
  // pylint snapshots.
  const pylintMarker = isFile(repoPath, 'pylintrc') || isFile(repoPath, '.pylintrc');
  if (pylintMarker && (isFile(repoPath, 'tests/conftest.py') || isFile(repoPath, 'conftest.py'))) {
    return PROFILES['pytest-with-runtests'];
  }
  // pytest-standard: conftest.py at root or under tests/.
  if (isFile(repoPath, 'conftest.py') || isFile(repoPath, 'tests/conftest.py')) {
    return PROFILES['pytest-standard'];
  }
  // unittest-discover: a tests/ directory with no conftest.py and no
  // Django markers (already eliminated above). Heuristic; works for the
  // older corpus shapes that predate conftest adoption.
  if (isDir(repoPath, 'tests') && !isFile(repoPath, 'tests/conftest.py')) {
    return PROFILES['unittest-discover'];
  }
  return PROFILES['pytest-fallback'];
}

/**
 * Lookup a framework profile by its identifier. Useful for tests that want
 * to assert on a specific profile's metadata without re-running detection.
 *
 * @param framework - Framework identifier.
 * @returns The matching profile.
 */
export function getFrameworkProfile(framework: TestFramework): FrameworkProfile {
  return PROFILES[framework];
}
