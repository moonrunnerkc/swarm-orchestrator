import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectTestFramework,
  getFrameworkProfile,
} from '../../src/verification';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'framework-detection-'));
}

function writeFile(root: string, rel: string, body = ''): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('test-framework-detection', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('detects django-runtests when tests/runtests.py is present', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'tests/runtests.py', '# django test runner');
    writeFile(repo, 'django/__init__.py');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'django-runtests');
    assert.equal(profile.preserveDirectoryStructure, true,
      'Django runtests must preserve directory structure for dotted-module discovery');
    assert.equal(profile.pytestCollectPreflight, false,
      'Django uses its own discovery; the pytest preflight is not the right gate here');
    assert.match(profile.promptGuidance, /Django/);
    assert.match(profile.promptGuidance, /tests\/runtests\.py/);
  });

  it('detects pytest-with-runtests when pylintrc + conftest.py are both present', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'pylintrc', '# pylint config');
    writeFile(repo, 'tests/conftest.py', '# pytest fixtures');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'pytest-with-runtests');
    assert.equal(profile.preserveDirectoryStructure, false);
    assert.equal(profile.pytestCollectPreflight, true);
    assert.match(profile.promptGuidance, /pytest/i);
    assert.match(profile.promptGuidance, /custom .*runtests|runtests.*custom/i,
      'guidance must warn the LLM not to regress to the custom entry point');
  });

  it('detects pytest-standard when only conftest.py is present', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'tests/conftest.py', '# pytest fixtures');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'pytest-standard');
    assert.equal(profile.preserveDirectoryStructure, false);
    assert.equal(profile.pytestCollectPreflight, true);
    assert.match(profile.promptGuidance, /pytest/);
  });

  it('detects pytest-standard when conftest.py is at the repo root', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'conftest.py', '# pytest fixtures');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'pytest-standard');
  });

  it('detects unittest-discover when tests/ exists with no conftest.py and no Django markers', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'tests/test_basic.py', 'import unittest\n');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'unittest-discover');
    assert.equal(profile.preserveDirectoryStructure, false);
    assert.equal(profile.pytestCollectPreflight, false,
      'unittest-discover does not use pytest; the preflight would always fail');
    assert.match(profile.promptGuidance, /unittest\.TestCase/);
  });

  it('falls back to pytest-fallback when no marker matches and there is no package.json', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    // Empty repo (or only README) — no tests/, no conftest.py, no markers.
    writeFile(repo, 'README.md', 'just a readme');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'pytest-fallback');
    assert.equal(profile.preserveDirectoryStructure, false);
    assert.equal(profile.pytestCollectPreflight, true);
    assert.match(profile.promptGuidance, /fallback/);
  });

  it('detects js-ava when package.json declares ava in devDependencies', () => {
    // Mirrors sindresorhus/ow shape: ESM TypeScript project with ava under
    // `test/` (singular). The pre-fix detector misclassified this as
    // `pytest-fallback` because `test/` (singular) does not match the
    // `tests/` (plural) unittest heuristic, and no Python marker fired —
    // the synthesizer then prompted the LLM to write pytest tests for a
    // Node-only project.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({
        name: 'ow',
        type: 'module',
        scripts: { test: "xo && NODE_OPTIONS='--import=tsx/esm' c8 ava" },
        devDependencies: { ava: '^6.0.0', tsx: '^4.0.0' },
      }),
    );
    writeFile(repo, 'test/index.ts', '');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-ava');
    assert.equal(profile.preserveDirectoryStructure, true,
      'JS profiles must preserve LLM-specified placement so candidates can land in the project\'s test directory');
    assert.equal(profile.pytestCollectPreflight, false,
      'pytest --collect-only would always fail on JS candidates and reject every attempt');
    assert.match(profile.promptGuidance, /ava/i);
    assert.match(profile.promptGuidance, /NODE_OPTIONS/i,
      'guidance must mention NODE_OPTIONS so the LLM mirrors tsx/esm loaders');
  });

  it('detects js-jest when package.json declares jest', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
    );

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-jest');
    assert.equal(profile.pytestCollectPreflight, false);
    assert.match(profile.promptGuidance, /jest/i);
    assert.match(profile.promptGuidance, /--runTestsByPath/,
      'jest guidance must instruct --runTestsByPath so the path is honored literally');
  });

  it('detects js-vitest when package.json declares vitest', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({ devDependencies: { vitest: '^1.0.0' } }),
    );

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-vitest');
    assert.match(profile.promptGuidance, /vitest run/,
      'vitest guidance must include `vitest run` so watch mode is disabled');
  });

  it('detects js-mocha when package.json declares mocha', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({ devDependencies: { mocha: '^10.0.0' } }),
    );

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-mocha');
    assert.match(profile.promptGuidance, /mocha/i);
  });

  it('detects js-node-test when scripts.test invokes node --test', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({
        scripts: { test: 'node --test test/**/*.test.js' },
      }),
    );

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-node-test');
    assert.match(profile.promptGuidance, /node:test/);
  });

  it('detects js-node-test when scripts.test references node:test', () => {
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({
        scripts: { test: "node --import './loader.js' --test-reporter=spec --test" },
      }),
    );

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-node-test');
  });

  it('falls back to js-fallback when package.json has no framework markers', () => {
    // A package.json with no test framework dep and no node --test script
    // is still a Node project. Routing it through pytest-fallback would
    // produce broken Python tests; the JS-fallback profile keeps the LLM
    // in Node-land and asks it to inspect the repo.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'package.json', JSON.stringify({ name: 'thing' }));

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-fallback');
    assert.equal(profile.pytestCollectPreflight, false);
    assert.match(profile.promptGuidance, /node/i);
  });

  it('routes JS detection ahead of Python directory heuristics', () => {
    // Regression for the misclassification that motivated the JS branch.
    // A Node repo declaring jest plus a top-level `tests/` directory must
    // not fall to `unittest-discover` (the Python heuristic that fires on
    // bare `tests/`). The package.json language gate runs first.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(
      repo,
      'package.json',
      JSON.stringify({ devDependencies: { jest: '^29.0.0' } }),
    );
    writeFile(repo, 'tests/example.test.js', '');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'js-jest');
  });

  it('routes JS detection ahead of pytest-fallback even with no Python markers', () => {
    // Without the language gate, an empty Node repo (just package.json)
    // would fall through to `pytest-fallback`. The 2026-05 ow run
    // exhibited exactly this failure: TypeScript project, no Python on
    // host, every synthesis attempt rejected as `collection-error`,
    // AMBIGUOUS_GOAL before any worker step.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'package.json', JSON.stringify({ name: 'thing' }));

    const profile = detectTestFramework(repo);

    assert.notEqual(profile.framework, 'pytest-fallback');
    assert.match(profile.framework, /^js-/);
  });

  it('treats malformed package.json as no signal and falls through to Python', () => {
    // A corrupt package.json must not crash detection. The repo is then
    // treated as if package.json did not exist; the Python branch decides.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'package.json', '{ this is not json');

    const profile = detectTestFramework(repo);

    assert.match(profile.framework, /^(pytest-fallback|unittest-discover|pytest-standard)$/);
  });

  it('every JS framework profile disables pytestCollectPreflight', () => {
    // The preflight runs `python3 -m pytest --collect-only` on the
    // candidate. A JS candidate is never valid Python; the preflight
    // would reject every attempt before the base run got a chance.
    const jsFrameworks = [
      'js-ava',
      'js-mocha',
      'js-jest',
      'js-vitest',
      'js-node-test',
      'js-fallback',
    ] as const;
    for (const framework of jsFrameworks) {
      const profile = getFrameworkProfile(framework);
      assert.equal(profile.pytestCollectPreflight, false,
        `${framework} must not run the pytest preflight`);
    }
  });

  it('every JS framework profile preserves directory structure', () => {
    // ow tests live in `test/`, jest tests often live in `__tests__/`,
    // and node:test repos may put tests alongside source. The LLM is
    // best-positioned to pick the path that matches the project's
    // convention; flattening to repo root would force a wrong location.
    const jsFrameworks = [
      'js-ava',
      'js-mocha',
      'js-jest',
      'js-vitest',
      'js-node-test',
      'js-fallback',
    ] as const;
    for (const framework of jsFrameworks) {
      const profile = getFrameworkProfile(framework);
      assert.equal(profile.preserveDirectoryStructure, true,
        `${framework} must preserve LLM-specified directory placement`);
    }
  });

  it('django-runtests takes priority over pytest-standard when both markers exist', () => {
    // Some Django repos ship a conftest.py for tests they run under pytest
    // alongside the canonical runtests.py harness. The synthesizer should
    // pick the Django-specific profile because that is what fp/fn measures
    // through; running pytest --collect-only against a Django test that
    // depends on Django's settings bootstrap would either fail spuriously
    // or pass spuriously, neither of which is the gate we want.
    const repo = tmpRepo();
    dirs.push(repo);
    writeFile(repo, 'tests/runtests.py', '# django test runner');
    writeFile(repo, 'tests/conftest.py', '# pytest fixtures');

    const profile = detectTestFramework(repo);

    assert.equal(profile.framework, 'django-runtests');
  });

  it('every framework profile injects the no-hardcoded-venv guidance', () => {
    // The Mode 2 sanitizer is defense-in-depth; the prompt is the primary
    // mitigation. If a future profile forgets the guidance, the LLM will
    // start producing `.venv/bin/python` again and the WARN logs will fire
    // on every record.
    const frameworks = [
      'django-runtests',
      'pytest-with-runtests',
      'pytest-standard',
      'unittest-discover',
      'pytest-fallback',
    ] as const;
    for (const framework of frameworks) {
      const profile = getFrameworkProfile(framework);
      assert.match(profile.promptGuidance, /do NOT hardcode.*\.venv/i,
        `framework ${framework} must inject the no-hardcoded-venv guidance`);
    }
  });
});
