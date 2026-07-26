import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  chooseManifestDir,
  discoverManifestDirs,
} from '../../../src/audit/execution-grounded/manifest-discovery';

function makeTree(spec: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-discovery-'));
  for (const [rel, content] of Object.entries(spec)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

const hasPackageJson = (absDir: string): boolean =>
  fs.existsSync(path.join(absDir, 'package.json'));

describe('execution-grounded / manifest discovery', () => {
  describe('discoverManifestDirs', () => {
    it('finds subdirectory manifests and never returns the root', () => {
      const root = makeTree({
        'README.md': '',
        'app/package.json': '{}',
        'services/api/package.json': '{}',
      });
      try {
        assert.deepEqual(discoverManifestDirs(root, hasPackageJson), ['app', 'services/api']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('skips node_modules, vendor trees, and dot-directories', () => {
      const root = makeTree({
        'node_modules/left-pad/package.json': '{}',
        'vendor/lib/package.json': '{}',
        '.cache/tool/package.json': '{}',
        'app/package.json': '{}',
      });
      try {
        assert.deepEqual(discoverManifestDirs(root, hasPackageJson), ['app']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    it('bounds the search depth', () => {
      const root = makeTree({
        'a/b/c/d/e/package.json': '{}',
        'a/b/package.json': '{}',
      });
      try {
        assert.deepEqual(discoverManifestDirs(root, hasPackageJson, { maxDepth: 4 }), ['a/b']);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  describe('chooseManifestDir', () => {
    it('resolves no-manifest-found when discovery returned nothing', () => {
      assert.deepEqual(chooseManifestDir([], ['src/index.js']), { kind: 'no-manifest-found' });
    });

    it('chooses the sole candidate that owns the changed files', () => {
      const r = chooseManifestDir(['app', 'tools'], ['app/src/index.js', 'app/test/index.test.js']);
      assert.equal(r.kind, 'chosen');
      assert.equal(r.kind === 'chosen' && r.manifestDir, 'app');
      assert.equal(r.kind === 'chosen' && r.strategy, 'sole-owner');
    });

    it('prefers the deepest common owner when several nested packages own files', () => {
      const r = chooseManifestDir(
        ['frontend', 'frontend/app', 'frontend/lib'],
        ['frontend/app/a.ts', 'frontend/lib/b.ts'],
      );
      assert.equal(r.kind === 'chosen' && r.manifestDir, 'frontend');
      assert.equal(r.kind === 'chosen' && r.strategy, 'deepest-common-owner');
    });

    it('falls back to the candidate owning the most changed files when owners are disjoint', () => {
      const r = chooseManifestDir(
        ['packages/a', 'packages/b'],
        ['packages/a/x.ts', 'packages/a/y.ts', 'packages/b/z.ts'],
      );
      assert.equal(r.kind === 'chosen' && r.manifestDir, 'packages/a');
      assert.equal(r.kind === 'chosen' && r.strategy, 'most-owned-files');
    });

    it('resolves no-manifest-for-diff when no candidate owns any changed file', () => {
      const r = chooseManifestDir(['app'], ['docs/readme.md', 'infra/deploy.sh']);
      assert.equal(r.kind, 'no-manifest-for-diff');
      assert.deepEqual(r.kind === 'no-manifest-for-diff' && r.candidates, ['app']);
    });

    it('resolves no-manifest-for-diff when no changed files were provided at all', () => {
      assert.equal(chooseManifestDir(['app'], undefined).kind, 'no-manifest-for-diff');
      assert.equal(chooseManifestDir(['app'], []).kind, 'no-manifest-for-diff');
    });
  });
});
