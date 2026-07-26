import { strict as assert } from 'assert';
import { subdirManifestCandidates } from '../../../scripts/real-prs/lib/subdir-manifest-screen';
import { screenPr, type OctokitContents } from '../../../scripts/real-prs/eg-viability-screen';

describe('subdirManifestCandidates', () => {
  it('finds node, go, and pytest-capable python manifests below the root', () => {
    const candidates = subdirManifestCandidates([
      'README.md',
      'app/package.json',
      'app/src/index.ts',
      'backend/go.mod',
      'py/pyproject.toml',
      'py/tests/test_x.py',
    ]);
    assert.deepEqual(candidates, [
      { dir: 'app', ecosystem: 'node' },
      { dir: 'backend', ecosystem: 'go' },
      { dir: 'py', ecosystem: 'python' },
    ]);
  });

  it('skips node_modules, vendor trees, and dot-directories', () => {
    const candidates = subdirManifestCandidates([
      'node_modules/x/package.json',
      'app/node_modules/y/package.json',
      'vendor/z/go.mod',
      '.tooling/package.json',
      'app/package.json',
    ]);
    assert.deepEqual(candidates, [{ dir: 'app', ecosystem: 'node' }]);
  });

  it('excludes a python project with no pytest signal and manifests deeper than the depth bound', () => {
    const candidates = subdirManifestCandidates([
      'py/requirements.txt',
      'a/b/c/d/e/package.json',
    ]);
    assert.deepEqual(candidates, []);
  });

  it('orders candidates shallowest-first, then lexicographically', () => {
    const candidates = subdirManifestCandidates([
      'packages/deep/one/package.json',
      'zapp/package.json',
      'app/package.json',
    ]);
    assert.deepEqual(
      candidates.map((c) => c.dir),
      ['app', 'zapp', 'packages/deep/one'],
    );
  });
});

/** A fake contents/tree client serving from an in-memory file map. */
function fakeOctokit(files: Record<string, string>): OctokitContents {
  return {
    repos: {
      getContent: async ({ path: p }: { path: string }) => {
        if (p === '') {
          const top = new Map<string, 'file' | 'dir'>();
          for (const full of Object.keys(files)) {
            const slash = full.indexOf('/');
            if (slash < 0) top.set(full, 'file');
            else top.set(full.slice(0, slash), 'dir');
          }
          return { data: [...top.entries()].map(([name, type]) => ({ name, type })) };
        }
        if (!(p in files)) throw Object.assign(new Error('not found'), { status: 404 });
        return { data: { content: Buffer.from(files[p]!).toString('base64'), encoding: 'base64' } };
      },
    },
    git: {
      getTree: async () => ({
        data: { tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) },
      }),
    },
  } as OctokitContents;
}

const LABEL = { id: 'x', repo: 'owner/name', headSha: 'deadbeef', outcome: 'unknown' };

describe('screenPr with subdirectory manifests', () => {
  it('screens a subdir Node manifest viable when it has a lockfile and runner', async () => {
    const rec = await screenPr(
      fakeOctokit({
        'README.md': '',
        'app/package.json': JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^1' } }),
        'app/package-lock.json': '{}',
        'app/src/index.ts': '',
      }),
      LABEL,
    );
    assert.equal(rec.viable, true);
    assert.equal(rec.manifestDir, 'app');
    assert.equal(rec.ecosystem, 'node');
    assert.equal(rec.testRunner, 'vitest');
  });

  it('screens a subdir Go module viable', async () => {
    const rec = await screenPr(fakeOctokit({ 'README.md': '', 'svc/go.mod': 'module m' }), LABEL);
    assert.equal(rec.viable, true);
    assert.equal(rec.manifestDir, 'svc');
    assert.equal(rec.ecosystem, 'go');
  });

  it('stays not-viable, naming what each candidate lacks, when no subdir screens viable', async () => {
    const rec = await screenPr(
      fakeOctokit({
        'README.md': '',
        'app/package.json': JSON.stringify({ scripts: {} }),
        'app/src/index.ts': '',
      }),
      LABEL,
    );
    assert.equal(rec.viable, false);
    assert.match(rec.reason, /subdir manifests not viable/);
    assert.match(rec.reason, /app \(no lockfile, no recognizable test runner\)/);
  });

  it('keeps the pre-discovery record when the repo has no manifest anywhere', async () => {
    const rec = await screenPr(fakeOctokit({ 'README.md': '', 'scripts/run.sh': '' }), LABEL);
    assert.equal(rec.viable, false);
    assert.match(rec.reason, /no package\.json/);
    assert.equal(rec.manifestDir, undefined);
  });

  it('screens a root manifest exactly as before, with no manifestDir', async () => {
    const rec = await screenPr(
      fakeOctokit({
        'package.json': JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '^29' } }),
        'package-lock.json': '{}',
      }),
      LABEL,
    );
    assert.equal(rec.viable, true);
    assert.equal(rec.manifestDir, undefined);
    assert.equal(rec.testRunner, 'jest');
  });
});
