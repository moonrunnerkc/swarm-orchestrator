import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  detectPackageManager,
  detectTestRunner,
  provisionWorkspace,
} from '../../../src/audit/execution-grounded/sandbox';

// Live-network integration tests clone real repos, so they are gated behind
// SWARM_EG_INTEGRATION=1 to keep the default `npm test` deterministic and
// offline. They are exercised during the evidence run.
const INTEGRATION = process.env.SWARM_EG_INTEGRATION === '1';

// Compiled to dist/test/audit/execution-grounded/sandbox.test.js, so four
// levels up is the repo root and the fixtures live in the source tree.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIX = path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures');

describe('execution-grounded / sandbox detection', () => {
  describe('detectPackageManager', () => {
    it('detects npm from package-lock.json', () => {
      assert.equal(detectPackageManager(path.join(FIX, 'pm-npm')), 'npm');
    });
    it('detects yarn from yarn.lock', () => {
      assert.equal(detectPackageManager(path.join(FIX, 'pm-yarn')), 'yarn');
    });
    it('detects pnpm from pnpm-lock.yaml', () => {
      assert.equal(detectPackageManager(path.join(FIX, 'pm-pnpm')), 'pnpm');
    });
    it('detects bun from bun.lockb', () => {
      assert.equal(detectPackageManager(path.join(FIX, 'pm-bun')), 'bun');
    });
    it('prefers pnpm over npm when both lockfiles are present', () => {
      assert.equal(detectPackageManager(path.join(FIX, 'pm-mixed')), 'pnpm');
    });
    it('defaults to npm when no lockfile is present', () => {
      assert.equal(detectPackageManager(FIX), 'npm');
    });
  });

  describe('detectTestRunner', () => {
    it('detects jest from a devDependency', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'pm-npm')), 'jest');
    });
    it('detects vitest from a devDependency', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'pm-yarn')), 'vitest');
    });
    it('detects mocha from a devDependency', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'pm-pnpm')), 'mocha');
    });
    it('detects ava from a devDependency', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'pm-bun')), 'ava');
    });
    it('detects jest when only ts-jest is present', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-jest-via-tsjest')), 'jest');
    });
    it('detects node-test from a `node --test` script', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-node-test')), 'node-test');
    });
    it('detects a runner named only in the test script', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-script-only')), 'vitest');
    });
    it('detects jest from jest-expo', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-jest-expo')), 'jest');
    });
    it('detects jest from a jest.config file', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-jest-config')), 'jest');
    });
    it('detects jest from the package.json jest key', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-jest-pkgkey')), 'jest');
    });
    it('detects vitest from a vitest.config file', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-vitest-configfile')), 'vitest');
    });
    it('returns null when no runner is recognizable', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'runner-none')), null);
    });
    it('returns null when there is no package.json', () => {
      assert.equal(detectTestRunner(path.join(FIX, 'pm-mixed', 'does-not-exist')), null);
    });
  });

  (INTEGRATION ? describe : describe.skip)('provisionWorkspace (live)', function () {
    this.timeout(120_000);
    it('shallow-clones a repo at a specific commit and cleans up', () => {
      const ws = provisionWorkspace({
        repo: 'octocat/Hello-World',
        commit: '7fd1a60b01f91b314f59955a4e4d4e80d8edf11d',
        baseDir: path.join(os.tmpdir(), 'eg-it'),
        skipInstall: true,
      });
      try {
        assert.ok(fs.existsSync(ws.workspacePath), 'workspace path exists');
        assert.ok(fs.existsSync(path.join(ws.workspacePath, 'README')), 'checked-out tree present');
      } finally {
        ws.cleanup();
      }
      assert.equal(fs.existsSync(ws.workspacePath), false, 'cleanup removed the workspace');
    });
  });
});
