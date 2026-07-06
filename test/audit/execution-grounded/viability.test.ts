import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assessViability, nodeEngineSatisfiable } from '../../../src/audit/execution-grounded/viability';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIX = path.join(REPO_ROOT, 'test', 'audit', 'execution-grounded', 'fixtures');

describe('execution-grounded / assessViability', () => {
  it('marks a Node project with a lockfile and a runner as viable', () => {
    const a = assessViability(path.join(FIX, 'pm-npm'));
    assert.equal(a.viable, true);
    assert.equal(a.reason, '');
    assert.equal(a.packageManager, 'npm');
    assert.equal(a.testRunner, 'jest');
  });

  it('is not viable when no test runner is recognizable', () => {
    const a = assessViability(path.join(FIX, 'runner-none'));
    assert.equal(a.viable, false);
    assert.match(a.reason, /no recognizable test runner/);
  });

  it('is not viable and names package.json when the dir is not a Node project', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viability-nonnode-'));
    try {
      fs.writeFileSync(path.join(dir, 'main.py'), 'print("hi")\n');
      const a = assessViability(dir);
      assert.equal(a.viable, false);
      assert.equal(a.hasPackageJson, false);
      assert.match(a.reason, /no package\.json/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is not viable when a Node project has no lockfile', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viability-nolock-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'x', devDependencies: { mocha: '^10' } }),
      );
      const a = assessViability(dir);
      assert.equal(a.viable, false);
      assert.match(a.reason, /no lockfile/);
      // The runner is still detected even though the lockfile is missing.
      assert.equal(a.testRunner, 'mocha');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('excludes a Node project pinned to an older major', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viability-oldnode-'));
    try {
      fs.writeFileSync(
        path.join(dir, 'package.json'),
        JSON.stringify({ name: 'x', devDependencies: { jest: '^29' }, engines: { node: '<16' } }),
      );
      fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
      const a = assessViability(dir);
      assert.equal(a.viable, false);
      assert.match(a.reason, /excludes node 22/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('execution-grounded / nodeEngineSatisfiable', () => {
  it('admits an absent engine', () => {
    assert.equal(nodeEngineSatisfiable(null), true);
    assert.equal(nodeEngineSatisfiable('  '), true);
  });

  it('admits a lower-bound range', () => {
    assert.equal(nodeEngineSatisfiable('>=18'), true);
    assert.equal(nodeEngineSatisfiable('>=22'), true);
  });

  it('rejects an upper bound at or below the pinned major', () => {
    assert.equal(nodeEngineSatisfiable('<16'), false);
    assert.equal(nodeEngineSatisfiable('<22'), false);
  });

  it('admits a bare pin only when it is the pinned major', () => {
    assert.equal(nodeEngineSatisfiable('18.x'), false);
    assert.equal(nodeEngineSatisfiable('22'), true);
  });
});
