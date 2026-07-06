import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { composeMergeDecision, type MergeControl } from '../../../src/audit/gate/merge-decision';
import {
  buildDefaultMergeObligations,
  runPositiveGate,
} from '../../../src/audit/gate/positive-gate';

// Real `node --test` suites (built into Node, no install, offline). A passing
// suite exits 0; a failing one exits non-zero, which verifyObligation reads as
// test-must-pass failing.
const PASS_TEST =
  "const { test } = require('node:test');\n" +
  "const assert = require('node:assert');\n" +
  "test('adds', () => { assert.equal(1 + 1, 2); });\n";
const FAIL_TEST =
  "const { test } = require('node:test');\n" +
  "const assert = require('node:assert');\n" +
  "test('adds', () => { assert.equal(1 + 1, 3); });\n";

interface WorkspaceSpec {
  readonly testBody: string;
  readonly buildScript?: string;
  readonly testScript?: string;
}

function makeWorkspace(spec: WorkspaceSpec): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positive-gate-'));
  const scripts: Record<string, string> = { test: spec.testScript ?? 'node --test' };
  if (spec.buildScript !== undefined) scripts.build = spec.buildScript;
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', scripts }));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(dir, 'app.test.js'), spec.testBody);
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

const GATE_TIMEOUT_MS = 60_000;

describe('audit/gate/positive-gate runPositiveGate', function () {
  this.timeout(GATE_TIMEOUT_MS);

  it('passes the test control on a green suite and adds no build control when none is declared', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const result = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      assert.equal(result.controls.length, 1);
      assert.equal(result.controls[0]?.kind, 'test');
      assert.equal(result.controls[0]?.status, 'pass');
    });
  });

  it('fails the test control on a red suite', () => {
    withWorkspace({ testBody: FAIL_TEST }, (dir) => {
      const result = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      const test = result.controls.find((c) => c.kind === 'test');
      assert.equal(test?.status, 'fail');
    });
  });

  it('runs a declared build script as a build control', () => {
    withWorkspace({ testBody: PASS_TEST, buildScript: 'node -e "process.exit(0)"' }, (dir) => {
      const result = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      const build = result.controls.find((c) => c.kind === 'build');
      assert.equal(build?.status, 'pass');
      assert.equal(result.obligations[0]?.type, 'build-must-pass');
    });
  });

  it('fails the build control when the build script exits non-zero', () => {
    withWorkspace({ testBody: PASS_TEST, buildScript: 'node -e "process.exit(1)"' }, (dir) => {
      const result = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      assert.equal(result.controls.find((c) => c.kind === 'build')?.status, 'fail');
    });
  });

  it('appends consumer obligations and evaluates them', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const result = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
        extraObligations: [
          { type: 'file-must-exist', path: 'app.test.js' },
          { type: 'file-must-exist', path: 'does-not-exist.js' },
        ],
      });
      const obligationControls = result.controls.filter((c) => c.kind === 'obligation');
      assert.equal(obligationControls.length, 2);
      assert.equal(obligationControls[0]?.status, 'pass');
      assert.equal(obligationControls[1]?.status, 'fail');
    });
  });

  it('adds an injected falsifier control and omits it when no probe is given', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const unavailable: MergeControl = {
        id: 'falsifier',
        kind: 'falsifier',
        status: 'unavailable',
        detail: 'no adapter configured',
      };
      const withProbe = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
        falsifierProbe: () => unavailable,
      });
      assert.ok(withProbe.controls.some((c) => c.kind === 'falsifier' && c.status === 'unavailable'));

      const withoutProbe = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      assert.ok(!withoutProbe.controls.some((c) => c.kind === 'falsifier'));
    });
  });
});

describe('audit/gate/positive-gate end-to-end with the composer', function () {
  this.timeout(GATE_TIMEOUT_MS);

  it('a fully-green Node workspace composes to AUTO-MERGE', () => {
    withWorkspace({ testBody: PASS_TEST }, (dir) => {
      const gate = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      const decision = composeMergeDecision({
        egViable: true,
        egViabilityReason: '',
        negativeGateClean: true,
        negativeGateDetail: '',
        controls: gate.controls,
      });
      assert.equal(decision.verdict, 'auto-merge');
    });
  });

  it('a cheat-clean PR whose post-merge suite fails composes to HUMAN', () => {
    withWorkspace({ testBody: FAIL_TEST }, (dir) => {
      const gate = runPositiveGate({
        workspacePath: dir,
        packageManager: 'npm',
        testRunner: 'node-test',
        commandTimeoutMs: GATE_TIMEOUT_MS,
      });
      const decision = composeMergeDecision({
        egViable: true,
        egViabilityReason: '',
        negativeGateClean: true,
        negativeGateDetail: '',
        controls: gate.controls,
      });
      assert.equal(decision.verdict, 'human');
      assert.deepEqual(
        decision.reasons.map((r) => r.code),
        ['positive-control-failed'],
      );
    });
  });

  it('generates a test obligation from the runner when no test script exists', () => {
    // A project whose runner is detected from a devDependency, not a script.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'positive-gate-noscript-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x' }));
      const obligations = buildDefaultMergeObligations(dir, 'npm', 'node-test');
      const test = obligations.find((o) => o.type === 'test-must-pass');
      assert.ok(test && 'command' in test && test.command === 'node --test');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
