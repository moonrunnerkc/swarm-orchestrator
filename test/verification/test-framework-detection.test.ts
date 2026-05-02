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

  it('falls back to pytest-fallback when no marker matches', () => {
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
