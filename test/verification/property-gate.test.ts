import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverPropertyTargets,
  runPropertyGate,
  type PropertyCommandRunner,
} from '../../src/verification';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'property-gate-'));
}

function writeFile(root: string, rel: string, body: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body, 'utf8');
}

describe('property gate', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('discovers typed TypeScript functions from changed files', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/math.ts', [
      'export function divide(a: number, b: number): number {',
      '  return a / b;',
      '}',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/math.ts']);

    assert.deepStrictEqual(targets, [{
      language: 'typescript',
      filePath: 'src/math.ts',
      line: 1,
      functionName: 'divide',
      typed: true,
      advisoryOnly: false,
    }]);
  });

  it('marks untyped JavaScript as advisory-only', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/slug.js', [
      'function slugify(value) { return value.trim().toLowerCase(); }',
      'module.exports = { slugify };',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/slug.js']);

    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].language, 'javascript');
    assert.strictEqual(targets[0].line, 1);
    assert.strictEqual(targets[0].typed, false);
    assert.strictEqual(targets[0].advisoryOnly, true);
  });

  it('reports counterexamples from failed property runs', async () => {
    const root = tmpRepo();
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
      durationMs: 3,
      timedOut: false,
    });

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/math.ts'],
      commandRunner: runner,
    });

    assert.strictEqual(result.status, 'ADVISORY');
    assert.strictEqual(result.findings.length, 1);
    assert.strictEqual(result.findings[0].scope, 'line');
    assert.strictEqual(result.findings[0].line, 1);
    assert.strictEqual(result.findings[0].ruleId, 'property-counterexample');
    assert.match(result.findings[0].message, /\[0\] -> division by zero/);
    assert.ok(result.score < 1);
  });

  it('passes when generated property runs succeed', async () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/math.py', [
      'def add(a: int, b: int) -> int:',
      '    return a + b',
      '',
    ].join('\n'));

    const runner: PropertyCommandRunner = async (command, cwd, _timeoutMs) => ({
      command,
      cwd,
      exitCode: 0,
      stdout: '',
      stderr: '',
      durationMs: 2,
      timedOut: false,
    });

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/math.py'],
      commandRunner: runner,
    });

    assert.strictEqual(result.status, 'PASS');
    assert.strictEqual(result.findings.length, 0);
    assert.strictEqual(result.targets[0].typed, true);
    assert.strictEqual(result.targets[0].line, 1);
  });

  it('skips when no supported functions are found', async () => {
    const result = await runPropertyGate({
      targetRepoPath: process.cwd(),
      changedFiles: ['README.md'],
    });

    assert.strictEqual(result.status, 'SKIP');
    assert.strictEqual(result.score, 1);
  });
});
