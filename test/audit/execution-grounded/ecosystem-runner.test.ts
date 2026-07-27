import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildTestCommand,
  ecosystemForRunner,
  goPackagesFor,
  isSupportedRunner,
  preflightRunner,
  resolveTestScope,
} from '../../../src/audit/execution-grounded/ecosystem-runner';
import { execBin } from '../../../src/audit/execution-grounded/exec-env';
import { executeTestRun } from '../../../src/audit/execution-grounded/test-restoration';

const GO_FIXTURE = path.resolve('test/fixtures/ecosystem/go-module');
const PY_FIXTURE = path.resolve('test/fixtures/ecosystem/python-project');

/** Whether a toolchain binary is runnable in this environment. A suite that
 *  cannot run must say so by name rather than silently pass. */
function toolchainAvailable(bin: string, args: string[]): boolean {
  const res = spawnSync(bin, args, { encoding: 'utf8', timeout: 30_000 });
  return res.status === 0;
}

const HAVE_GO = toolchainAvailable('go', ['version']);
const HAVE_PYTEST = toolchainAvailable('python3', ['-m', 'pytest', '--version']);

/** Copy a fixture tree into a scratch dir so a test can add a failing file. */
function scratchCopy(src: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eco-'));
  fs.cpSync(src, dir, { recursive: true });
  return dir;
}

describe('execution-grounded ecosystem runner', () => {
  describe('binary resolution', () => {
    const saved = process.env.SWARM_EG_NODE_BIN;
    afterEach(() => {
      if (saved === undefined) delete process.env.SWARM_EG_NODE_BIN;
      else process.env.SWARM_EG_NODE_BIN = saved;
    });

    it('pins node-family binaries to the pinned bin dir', () => {
      process.env.SWARM_EG_NODE_BIN = '/pinned/node/bin';
      assert.equal(execBin('node'), path.join('/pinned/node/bin', 'node'));
      assert.equal(execBin('npx'), path.join('/pinned/node/bin', 'npx'));
      assert.equal(execBin('corepack'), path.join('/pinned/node/bin', 'corepack'));
    });

    it('leaves non-node toolchain binaries on the ambient PATH', () => {
      // Joining `go` onto the Node bin dir yields a path that does not exist, so
      // the spawn dies with ENOENT and the caller records an execution error for
      // a run that never had a chance to start.
      process.env.SWARM_EG_NODE_BIN = '/pinned/node/bin';
      assert.equal(execBin('go'), 'go');
      assert.equal(execBin('python3'), 'python3');
    });
  });

  describe('runner classification', () => {
    it('maps each runner to its ecosystem', () => {
      assert.equal(ecosystemForRunner('go-test'), 'go');
      assert.equal(ecosystemForRunner('pytest'), 'python');
      assert.equal(ecosystemForRunner('jest'), 'node');
      assert.equal(ecosystemForRunner('vitest'), 'node');
    });

    it('supports jest, vitest, mocha, pytest and go-test, and nothing else', () => {
      for (const r of ['jest', 'vitest', 'mocha', 'pytest', 'go-test'] as const) {
        assert.equal(isSupportedRunner(r), true, r);
      }
      assert.equal(isSupportedRunner('ava'), false);
      assert.equal(isSupportedRunner('node-test'), false);
    });

    it('scopes go test to the package, not the file', () => {
      assert.deepEqual(goPackagesFor(['cmd/mdsmith/mergedriver_test.go']), ['./cmd/mdsmith']);
      assert.deepEqual(goPackagesFor(['a/x_test.go', 'a/y_test.go', 'b/z_test.go']), ['./a', './b']);
      assert.deepEqual(goPackagesFor(['root_test.go']), ['.']);
    });

    it('defeats the go test cache so a repeat control re-executes', () => {
      const cmd = buildTestCommand('go-test', ['pkg/thing_test.go']);
      assert.equal(cmd.command, 'go');
      assert.ok(cmd.args.includes('-count=1'));
    });
  });

  describe('scope resolution', () => {
    it('leaves node at the workspace root with workspace-relative paths', () => {
      const r = resolveTestScope('jest', '/ws', ['packages/a/src/x.test.ts']);
      assert.ok(r.ok);
      assert.equal(r.scope.cwd, '/ws');
      assert.deepEqual(r.scope.targets, ['packages/a/src/x.test.ts']);
    });

    it('resolves a go module that sits in a subdirectory of the clone', () => {
      const ws = scratchCopy(GO_FIXTURE);
      const nested = path.join(ws, 'services', 'api');
      fs.mkdirSync(nested, { recursive: true });
      fs.cpSync(path.join(ws, 'go.mod'), path.join(nested, 'go.mod'));
      fs.cpSync(path.join(ws, 'mathutil'), path.join(nested, 'mathutil'), { recursive: true });
      const r = resolveTestScope('go-test', ws, ['services/api/mathutil/mathutil_test.go']);
      assert.ok(r.ok);
      assert.equal(r.scope.cwd, nested);
      assert.deepEqual(r.scope.targets, ['mathutil/mathutil_test.go']);
      fs.rmSync(ws, { recursive: true, force: true });
    });

    it('names module-root-unresolved when no go.mod exists above the test file', () => {
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-eco-'));
      fs.mkdirSync(path.join(ws, 'pkg'), { recursive: true });
      const r = resolveTestScope('go-test', ws, ['pkg/thing_test.go']);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'module-root-unresolved');
      fs.rmSync(ws, { recursive: true, force: true });
    });

    it('resolves a python project root from its pyproject.toml', () => {
      const r = resolveTestScope('pytest', PY_FIXTURE, ['calcutil/test_calcutil.py']);
      assert.ok(r.ok);
      assert.equal(r.scope.cwd, PY_FIXTURE);
      assert.deepEqual(r.scope.targets, ['calcutil/test_calcutil.py']);
    });

    it('names no-test-target when no files are given', () => {
      const r = resolveTestScope('go-test', GO_FIXTURE, []);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.reason, 'no-test-target');
    });
  });

  describe('preflight', () => {
    it('reports toolchain-missing rather than letting the spawn die', () => {
      const pre = preflightRunner('go-test', GO_FIXTURE, { PATH: '/nonexistent-bin-dir' });
      assert.equal(pre.ok, false);
      if (!pre.ok) {
        assert.equal(pre.reason, 'toolchain-missing');
        assert.match(pre.detail, /'go' was not found/);
      }
    });

    it('reports workspace-missing for a directory that does not exist', () => {
      const pre = preflightRunner('go-test', '/no/such/workspace', { PATH: process.env.PATH });
      assert.equal(pre.ok, false);
      if (!pre.ok) assert.equal(pre.reason, 'workspace-missing');
    });

    it('reports runner-unsupported for a runner with no locked invocation', () => {
      const pre = preflightRunner('ava', GO_FIXTURE, { PATH: process.env.PATH });
      assert.equal(pre.ok, false);
      if (!pre.ok) assert.equal(pre.reason, 'runner-unsupported');
    });
  });

  describe('go suites actually execute', function () {
    this.timeout(180_000);

    it('reports executed-with-pass for a passing go package', function () {
      if (!HAVE_GO) return this.skip();
      const res = executeTestRun({
        runner: 'go-test',
        files: ['mathutil/mathutil_test.go'],
        cwd: GO_FIXTURE,
        timeoutMs: 120_000,
      });
      assert.equal(res.outcome, 'executed-with-pass', res.rawOutput);
      assert.equal(res.passed, true);
      assert.equal(res.spawnFailed, false);
      // The suite really ran: go printed its own per-test result line.
      assert.match(res.rawOutput, /--- PASS: TestAddPasses/);
    });

    it('reports executed-with-fail and the failing identity for a failing go package', function () {
      if (!HAVE_GO) return this.skip();
      const ws = scratchCopy(GO_FIXTURE);
      fs.cpSync(
        path.join(ws, 'mathutil', 'broken_test.go.tmpl'),
        path.join(ws, 'mathutil', 'broken_test.go'),
      );
      const res = executeTestRun({
        runner: 'go-test',
        files: ['mathutil/broken_test.go'],
        cwd: ws,
        timeoutMs: 120_000,
      });
      assert.equal(res.outcome, 'executed-with-fail', res.rawOutput);
      assert.equal(res.passed, false);
      assert.equal(res.spawnFailed, false);
      assert.deepEqual(res.failingTests, ['TestAddFails']);
      fs.rmSync(ws, { recursive: true, force: true });
    });

    it('still executes when SWARM_EG_NODE_BIN pins a node-only toolchain', function () {
      if (!HAVE_GO) return this.skip();
      // The regression this guards: execBin used to join every binary onto the
      // pinned Node bin dir, so `go` resolved to a path that does not exist and
      // every Go restoration control died at spawn.
      const saved = process.env.SWARM_EG_NODE_BIN;
      process.env.SWARM_EG_NODE_BIN = path.dirname(process.execPath);
      try {
        const res = executeTestRun({
          runner: 'go-test',
          files: ['mathutil/mathutil_test.go'],
          cwd: GO_FIXTURE,
          timeoutMs: 120_000,
        });
        assert.equal(res.outcome, 'executed-with-pass', res.rawOutput);
      } finally {
        if (saved === undefined) delete process.env.SWARM_EG_NODE_BIN;
        else process.env.SWARM_EG_NODE_BIN = saved;
      }
    });
  });

  describe('python suites actually execute', function () {
    this.timeout(180_000);

    it('reports executed-with-pass for a passing pytest file', function () {
      if (!HAVE_PYTEST) return this.skip();
      const res = executeTestRun({
        runner: 'pytest',
        files: ['calcutil/test_calcutil.py'],
        cwd: PY_FIXTURE,
        timeoutMs: 120_000,
      });
      assert.equal(res.outcome, 'executed-with-pass', res.rawOutput);
      assert.match(res.rawOutput, /test_add_passes PASSED/);
    });

    it('reports executed-with-fail and the failing nodeid for a failing pytest file', function () {
      if (!HAVE_PYTEST) return this.skip();
      const ws = scratchCopy(PY_FIXTURE);
      fs.cpSync(
        path.join(ws, 'calcutil', 'test_broken.py.tmpl'),
        path.join(ws, 'calcutil', 'test_broken.py'),
      );
      const res = executeTestRun({
        runner: 'pytest',
        files: ['calcutil/test_broken.py'],
        cwd: ws,
        timeoutMs: 120_000,
      });
      assert.equal(res.outcome, 'executed-with-fail', res.rawOutput);
      assert.deepEqual(res.failingTests, ['calcutil/test_broken.py::test_add_fails']);
      fs.rmSync(ws, { recursive: true, force: true });
    });
  });

  describe('the not-executed invariant', () => {
    it('never returns an unclassified non-execution', () => {
      // Every path that does not run a suite must name why. A result that is
      // neither an executed pass nor an executed fail and carries no reason
      // cannot distinguish "not provable" from "never looked".
      const cases = [
        executeTestRun({ runner: 'go-test', files: [], cwd: GO_FIXTURE, timeoutMs: 1000 }),
        executeTestRun({
          runner: 'go-test',
          files: ['pkg/x_test.go'],
          cwd: '/no/such/workspace',
          timeoutMs: 1000,
        }),
        executeTestRun({
          runner: 'ava',
          files: ['x.test.js'],
          cwd: GO_FIXTURE,
          timeoutMs: 1000,
        }),
      ];
      for (const res of cases) {
        assert.equal(res.outcome, 'not-executed');
        assert.ok(res.notExecutedReason !== undefined, 'missing notExecutedReason');
        assert.ok(
          typeof res.notExecutedDetail === 'string' && res.notExecutedDetail.length > 0,
          'missing notExecutedDetail',
        );
        assert.equal(res.passed, false);
        assert.deepEqual(res.failingTests, []);
      }
    });
  });
});
