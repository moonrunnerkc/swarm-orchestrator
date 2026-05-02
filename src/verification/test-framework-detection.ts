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
 * - `pytest-fallback`: anything else. Default to pytest because it is the
 *   most permissive runner; an actual collection failure surfaces in the
 *   `--collect-only` preflight rather than masquerading as a passing
 *   regression test.
 */
export type TestFramework =
  | 'django-runtests'
  | 'pytest-with-runtests'
  | 'pytest-standard'
  | 'unittest-discover'
  | 'pytest-fallback';

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

/**
 * Inspect the repo on disk and return the framework profile the synthesizer
 * should use. Pure filesystem inspection — no network, no spawning, no LLM
 * calls. Detection priority is most-specific-first; the fallback to
 * `pytest-fallback` ensures a profile always returns even when no marker
 * matches, so the synthesizer never has to handle "no framework" specially.
 *
 * @param repoPath - Absolute path to the repo root being analyzed.
 * @returns The matching framework profile, with prompt guidance and
 *          placement rule the synthesizer consumes.
 */
export function detectTestFramework(repoPath: string): FrameworkProfile {
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
