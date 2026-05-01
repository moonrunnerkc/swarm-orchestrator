import { strict as assert } from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  isFinding,
  normalizeSemgrepResults,
  runCheatDetector,
  runDifferentialGate,
  runMutationGate,
  runPropertyGate,
  type Finding,
  type MutationCommandRunner,
  type PropertyCommandRunner,
} from '../src/verification';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function writeFile(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: GIT_ENV,
  }).trim();
}

function assertFindings(layer: string, findings: Finding[]): void {
  assert.ok(findings.length > 0, `${layer} should emit at least one finding`);
  for (const finding of findings) {
    assert.ok(isFinding(finding), `${layer} finding should conform to the schema`);
  }
}

describe('finding schema', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('validates cheat detector findings from a fixture diff', async () => {
    const result = await runCheatDetector({
      repoPath: process.cwd(),
      goalText: 'Fix token handling',
      runSemgrep: false,
      diffText: [
        'diff --git a/src/token.ts b/src/token.ts',
        '--- a/src/token.ts',
        '+++ b/src/token.ts',
        '@@ -1 +1 @@',
        '+export function token() { return "expected-token"; }',
        'diff --git a/test/token.test.ts b/test/token.test.ts',
        '--- a/test/token.test.ts',
        '+++ b/test/token.test.ts',
        '@@ -1 +1 @@',
        '+assert.strictEqual(token(), "expected-token");',
        '',
      ].join('\n'),
    });

    assertFindings('cheat detector', result.findings);
    assert.ok(result.findings.some(finding => finding.scope === 'line'));
  });

  it('validates recorded Semgrep output with source line data', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'semgrep-findings-'));
    dirs.push(root);
    const findings = normalizeSemgrepResults(JSON.stringify({
      results: [{
        check_id: 'swarm.test-rule',
        path: path.join(root, 'src/app.ts'),
        start: { line: 7, col: 3 },
        end: { line: 8, col: 10 },
        extra: {
          severity: 'ERROR',
          message: 'Detected a recorded Semgrep fixture finding.',
        },
      }],
    }), root);

    assertFindings('semgrep normalizer', findings);
    assert.strictEqual(findings[0].scope, 'line');
    assert.strictEqual(findings[0].filePath, 'src/app.ts');
    assert.strictEqual(findings[0].line, 7);
  });

  it('validates property gate line-scoped findings from a fixture run', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'property-findings-'));
    dirs.push(root);
    writeFile(root, 'src/math.ts', [
      'export function reciprocal(value: number): number {',
      '  return 1 / value;',
      '}',
      '',
    ].join('\n'));
    const runner: PropertyCommandRunner = async (command, cwd, _timeoutMs) => ({
      command,
      cwd,
      exitCode: 1,
      stdout: '',
      stderr: 'Error: Counterexample: [0] -> division by zero',
      durationMs: 4,
      timedOut: false,
    });

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/math.ts'],
      commandRunner: runner,
    });

    assertFindings('property gate', result.findings);
    assert.strictEqual(result.findings[0].scope, 'line');
    assert.strictEqual(result.findings[0].line, 1);
  });

  it('validates mutation gate line-scoped findings from tool output', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-findings-'));
    dirs.push(root);
    const runner: MutationCommandRunner = async (command, cwd, _timeoutMs) => ({
      command,
      cwd,
      exitCode: 0,
      stdout: [
        'Survived mutant: src/a.ts:5:12',
        'Killed: 8',
        'Survived: 4',
        'Total mutants: 12',
      ].join('\n'),
      stderr: '',
      durationMs: 5,
      timedOut: false,
    });

    const result = await runMutationGate({
      targetRepoPath: root,
      changedFiles: ['src/a.ts'],
      commandRunner: runner,
    });

    assertFindings('mutation gate', result.findings);
    assert.strictEqual(result.findings[0].scope, 'line');
    assert.strictEqual(result.findings[0].line, 5);
  });

  it('validates differential gate findings from a failing patch run', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'differential-findings-'));
    dirs.push(root);
    git(root, ['init', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.com']);
    git(root, ['config', 'user.name', 'test']);
    writeFile(root, 'calc.js', 'exports.add = (a, b) => a - b;\n');
    writeFile(root, 'calc.test.js', [
      "const assert = require('assert');",
      "const { add } = require('./calc');",
      'assert.strictEqual(add(2, 3), 5);',
      '',
    ].join('\n'));
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'base']);
    const baseCommit = git(root, ['rev-parse', 'HEAD']);
    git(root, ['checkout', '-b', 'no-fix']);

    const result = await runDifferentialGate({
      repoPath: root,
      baseCommit,
      agentBranch: 'no-fix',
      testCommand: 'node calc.test.js',
      timeoutMs: 30_000,
    });

    assertFindings('differential gate', result.findings);
    assert.strictEqual(result.findings[0].scope, 'line');
    assert.strictEqual(result.findings[0].filePath, 'calc.test.js');
  });
});
