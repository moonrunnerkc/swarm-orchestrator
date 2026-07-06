import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildDefaultMergeObligations } from '../../../src/audit/gate/positive-gate';
import { runMergeGate } from '../../../src/audit/gate/merge-gate';

function toolAvailable(cmd: string, args: readonly string[]): boolean {
  try {
    return spawnSync(cmd, args as string[], { encoding: 'utf8', timeout: 20_000 }).status === 0;
  } catch {
    return false;
  }
}

const PYTEST = toolAvailable('python3', ['-m', 'pytest', '--version']);
const GO = toolAvailable('go', ['version']);
const TIMEOUT_MS = 90_000;

function makePytestProject(pass: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-pytest-'));
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[project]\nname = "x"\nversion = "0.0.0"\n');
  fs.mkdirSync(path.join(dir, 'tests'));
  fs.writeFileSync(
    path.join(dir, 'tests', 'test_x.py'),
    pass ? 'def test_ok():\n    assert 1 + 1 == 2\n' : 'def test_bad():\n    assert 1 + 1 == 3\n',
  );
  return dir;
}

function makeGoModule(pass: boolean): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-go-'));
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/x\n\ngo 1.21\n');
  fs.writeFileSync(path.join(dir, 'x.go'), 'package x\n\nfunc Add(a, b int) int { return a + b }\n');
  fs.writeFileSync(
    path.join(dir, 'x_test.go'),
    pass
      ? 'package x\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) { if Add(1, 2) != 3 { t.Fatal("bad") } }\n'
      : 'package x\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) { if Add(1, 2) != 4 { t.Fatal("bad") } }\n',
  );
  return dir;
}

function cleanup(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('audit/gate positive gate default obligations (polyglot)', () => {
  it('generates python3 -m pytest and no build for a pytest project', () => {
    const obligations = buildDefaultMergeObligations('/nonexistent', null, 'pytest');
    assert.equal(obligations.length, 1);
    const test = obligations[0];
    assert.ok(test && test.type === 'test-must-pass' && test.command === 'python3 -m pytest');
  });

  it('generates go build and go test for a Go module', () => {
    const obligations = buildDefaultMergeObligations('/nonexistent', null, 'go-test');
    assert.equal(obligations.length, 2);
    assert.equal(obligations[0]?.type, 'build-must-pass');
    assert.ok(obligations[0] && 'command' in obligations[0] && obligations[0].command === 'go build ./...');
    assert.ok(obligations[1] && 'command' in obligations[1] && obligations[1].command === 'go test ./...');
  });
});

(PYTEST ? describe : describe.skip)('audit/gate positive gate over pytest (live)', function () {
  this.timeout(TIMEOUT_MS);

  it('auto-merges a green pytest project', () => {
    const dir = makePytestProject(true);
    try {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.viable, true);
      assert.equal(outcome.decision.verdict, 'auto-merge');
    } finally {
      cleanup(dir);
    }
  });

  it('routes a failing pytest project to HUMAN', () => {
    const dir = makePytestProject(false);
    try {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.decision.verdict, 'human');
      assert.ok(outcome.decision.reasons.some((r) => r.code === 'positive-control-failed'));
    } finally {
      cleanup(dir);
    }
  });
});

(GO ? describe : describe.skip)('audit/gate positive gate over Go (live)', function () {
  this.timeout(TIMEOUT_MS);

  it('auto-merges a green Go module (build + test)', () => {
    const dir = makeGoModule(true);
    try {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.viable, true);
      assert.equal(outcome.obligationCount, 2);
      assert.equal(outcome.decision.verdict, 'auto-merge');
    } finally {
      cleanup(dir);
    }
  });

  it('routes a failing Go module to HUMAN', () => {
    const dir = makeGoModule(false);
    try {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.decision.verdict, 'human');
      assert.ok(outcome.decision.reasons.some((r) => r.code === 'positive-control-failed'));
    } finally {
      cleanup(dir);
    }
  });
});
