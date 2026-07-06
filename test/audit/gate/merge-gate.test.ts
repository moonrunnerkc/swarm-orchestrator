import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runMergeGate } from '../../../src/audit/gate/merge-gate';

const PASS_TEST =
  "const { test } = require('node:test');\n" +
  "const assert = require('node:assert');\n" +
  "test('ok', () => { assert.equal(1, 1); });\n";
const FAIL_TEST =
  "const { test } = require('node:test');\n" +
  "const assert = require('node:assert');\n" +
  "test('bad', () => { assert.equal(1, 2); });\n";

interface WorkspaceSpec {
  readonly node?: boolean; // when false, produce a non-Node dir
  readonly testBody?: string;
  readonly mergeObligationsYaml?: string;
}

function makeWorkspace(spec: WorkspaceSpec): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-gate-'));
  if (spec.node === false) {
    fs.writeFileSync(path.join(dir, 'main.go'), 'package main\n');
    return dir;
  }
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', scripts: { test: 'node --test' } }),
  );
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'app.test.js'), spec.testBody ?? PASS_TEST);
  if (spec.mergeObligationsYaml !== undefined) {
    fs.mkdirSync(path.join(dir, '.swarm'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.swarm', 'merge-obligations.yaml'), spec.mergeObligationsYaml);
  }
  return dir;
}

function withWorkspace(spec: WorkspaceSpec, body: (dir: string) => void): void {
  const dir = makeWorkspace(spec);
  try {
    body(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const TIMEOUT_MS = 60_000;

describe('audit/gate/merge-gate runMergeGate', function () {
  this.timeout(TIMEOUT_MS);

  it('auto-merges a green viable tree with a clean negative gate', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.viable, true);
      assert.equal(outcome.decision.verdict, 'auto-merge');
    });
  });

  it('routes a non-Node tree to HUMAN with not-execution-groundable', () => {
    withWorkspace({ node: false }, (dir) => {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
      });
      assert.equal(outcome.viable, false);
      assert.equal(outcome.decision.verdict, 'human');
      assert.deepEqual(
        outcome.decision.reasons.map((r) => r.code),
        ['not-execution-groundable'],
      );
      // No controls ran on a non-viable tree.
      assert.equal(outcome.obligationCount, 0);
    });
  });

  it('routes a failing suite to HUMAN with positive-control-failed', () => {
    withWorkspace({ testBody: FAIL_TEST }, (dir) => {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.decision.verdict, 'human');
      assert.ok(outcome.decision.reasons.some((r) => r.code === 'positive-control-failed'));
    });
  });

  it('routes a blocked negative gate to HUMAN even with a green positive gate', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: false,
        negativeGateDetail: 'no-op-fix-proven fired',
        commandTimeoutMs: TIMEOUT_MS,
      });
      assert.equal(outcome.decision.verdict, 'human');
      assert.ok(outcome.decision.reasons.some((r) => r.code === 'negative-gate-blocked'));
    });
  });

  it('applies a valid consumer obligation from merge-obligations.yaml', () => {
    const yamlBody = ['obligations:', '  - type: file-must-exist', '    path: app.test.js', ''].join(
      '\n',
    );
    withWorkspace({ testBody: PASS_TEST, mergeObligationsYaml: yamlBody }, (dir) => {
      const outcome = runMergeGate({
        workspacePath: dir,
        negativeGateClean: true,
        negativeGateDetail: '',
        commandTimeoutMs: TIMEOUT_MS,
      });
      // default test obligation + the consumer file-must-exist = 2.
      assert.equal(outcome.obligationCount, 2);
      assert.equal(outcome.decision.verdict, 'auto-merge');
    });
  });

  it('fails closed on a malformed merge-obligations.yaml via an unavailable control', () => {
    withWorkspace(
      { testBody: PASS_TEST, mergeObligationsYaml: 'obligations: not-a-list\n' },
      (dir) => {
        const outcome = runMergeGate({
          workspacePath: dir,
          negativeGateClean: true,
          negativeGateDetail: '',
          commandTimeoutMs: TIMEOUT_MS,
        });
        assert.equal(outcome.configErrors.length, 1);
        assert.equal(outcome.decision.verdict, 'human');
        assert.ok(outcome.decision.reasons.some((r) => r.code === 'positive-control-unavailable'));
      },
    );
  });
});
