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
      parameters: [
        { name: 'a', rawType: 'number', strategy: 'fc.integer()' },
        { name: 'b', rawType: 'number', strategy: 'fc.integer()' },
      ],
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
    assert.deepStrictEqual(
      targets[0].parameters.map((p) => ({ name: p.name, rawType: p.rawType })),
      [{ name: 'value', rawType: '' }],
      'untyped JS parameter is captured but rawType stays empty',
    );
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

  it('derives a two-int strategy from (x: int, y: int)', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/two_ints.py', [
      'def add(x: int, y: int) -> int:',
      '    return x + y',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/two_ints.py']);

    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].unsupportedReason, undefined);
    assert.deepStrictEqual(targets[0].parameters, [
      { name: 'x', rawType: 'int', strategy: 'st.integers()' },
      { name: 'y', rawType: 'int', strategy: 'st.integers()' },
    ]);
  });

  it('derives a text+integer strategy from (name: str, count: int)', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/repeat.py', [
      'def repeat(name: str, count: int) -> str:',
      '    return name * count',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/repeat.py']);

    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].unsupportedReason, undefined);
    assert.deepStrictEqual(targets[0].parameters, [
      { name: 'name', rawType: 'str', strategy: 'st.text()' },
      { name: 'count', rawType: 'int', strategy: 'st.integers()' },
    ]);
  });

  it('derives a list-of-text strategy from (items: list[str])', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/joiner.py', [
      'def join_all(items: list[str]) -> str:',
      "    return ', '.join(items)",
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/joiner.py']);

    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].unsupportedReason, undefined);
    assert.deepStrictEqual(targets[0].parameters, [
      { name: 'items', rawType: 'list[str]', strategy: 'st.lists(st.text())' },
    ]);
  });

  it('handles arity-1 (x: int) without crashing on a hardcoded two-arg assumption', () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/single.py', [
      'def square(x: int) -> int:',
      '    return x * x',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/single.py']);

    assert.strictEqual(targets.length, 1);
    assert.strictEqual(targets[0].unsupportedReason, undefined);
    assert.strictEqual(targets[0].parameters.length, 1, 'arity must be 1, not the legacy hardcoded 2');
    assert.strictEqual(targets[0].parameters[0].strategy, 'st.integers()');
  });

  it('skips functions with unsupported types and emits a clear advisory note', async () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/custom.py', [
      'def take_thing(thing: SomeCustomType) -> None:',
      '    pass',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/custom.py']);

    assert.strictEqual(targets.length, 1);
    assert.match(
      targets[0].unsupportedReason ?? '',
      /unsupported type 'SomeCustomType'/,
      'unsupportedReason must name the offending type',
    );

    let runnerCalls = 0;
    const runner: PropertyCommandRunner = async (command, cwd, _timeoutMs) => {
      runnerCalls += 1;
      return { command, cwd, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
    };

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/custom.py'],
      commandRunner: runner,
    });

    assert.strictEqual(runnerCalls, 0,
      'unsupported-type targets must not invoke the runner; the harness would crash on import');
    assert.strictEqual(result.status, 'ADVISORY');
    assert.strictEqual(result.findings.length, 1);
    assert.strictEqual(result.findings[0].ruleId, 'property-skip-unsupported');
    assert.match(result.findings[0].message, /SomeCustomType/);
    // Skip findings do not count against the score.
    assert.strictEqual(result.score, 1);
  });

  it('handles untyped Python with an explicit no-type-hint advisory', async () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/untyped.py', [
      'def add(a, b):',
      '    return a + b',
      '',
    ].join('\n'));

    const targets = discoverPropertyTargets(root, ['src/untyped.py']);
    assert.strictEqual(targets.length, 1);
    assert.match(targets[0].unsupportedReason ?? '', /no type hint/);

    const result = await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/untyped.py'],
      commandRunner: async (command, cwd) => ({
        command, cwd, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false,
      }),
    });
    assert.strictEqual(result.findings[0]?.ruleId, 'property-skip-unsupported');
  });

  it('emits a Python harness with arity matching the function signature', async () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/three_args.py', [
      'def stitch(prefix: str, count: int, suffix: str) -> str:',
      '    return prefix * count + suffix',
      '',
    ].join('\n'));

    const observedCommands: string[] = [];
    await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/three_args.py'],
      commandRunner: async (command, cwd) => {
        observedCommands.push(command);
        return { command, cwd, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
      },
    });

    assert.strictEqual(observedCommands.length, 1);
    const harnessRel = observedCommands[0].replace(/^python\s+/, '');
    const harnessBody = fs.readFileSync(path.join(root, harnessRel), 'utf8');
    assert.match(harnessBody, /@given\(st\.text\(\), st\.integers\(\), st\.text\(\)\)/);
    assert.match(harnessBody, /def test_generated_property\(prefix, count, suffix\):/);
    assert.match(harnessBody, /stitch\(prefix, count, suffix\)/);
  });

  it('emits a TS harness with fast-check arbitraries matching the typed signature', async () => {
    const root = tmpRepo();
    dirs.push(root);
    writeFile(root, 'src/format.ts', [
      'export function format(label: string, items: string[]): string {',
      "  return label + ': ' + items.join(',');",
      '}',
      '',
    ].join('\n'));

    const observedCommands: string[] = [];
    await runPropertyGate({
      targetRepoPath: root,
      changedFiles: ['src/format.ts'],
      commandRunner: async (command, cwd) => {
        observedCommands.push(command);
        return { command, cwd, exitCode: 0, stdout: '', stderr: '', durationMs: 1, timedOut: false };
      },
    });

    assert.strictEqual(observedCommands.length, 1);
    const harnessRel = observedCommands[0].replace(/^npx\s+tsx\s+/, '');
    const harnessBody = fs.readFileSync(path.join(root, harnessRel), 'utf8');
    assert.match(harnessBody, /fc\.property\(fc\.string\(\), fc\.array\(fc\.string\(\)\)/);
    assert.match(harnessBody, /\(label, items\) =>/);
    assert.match(harnessBody, /fn\(label, items\)/);
  });
});
