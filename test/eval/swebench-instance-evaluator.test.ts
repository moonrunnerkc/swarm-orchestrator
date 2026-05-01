import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  appendJsonlRecord,
  evaluateInstancePropertyGate,
  evaluateInstanceSynthesizer,
} from '../../scripts/eval/swebench-instance-evaluator';
import {
  PropertyCommandRunner,
  TestSynthesisResult,
} from '../../src/verification';

const fakeSynth = (status: TestSynthesisResult['status'], extras: Partial<TestSynthesisResult> = {}): TestSynthesisResult => ({
  status,
  reason: extras.reason ?? 'fake',
  attempts: extras.attempts ?? [],
  ...(extras.testFilePath ? { testFilePath: extras.testFilePath } : {}),
  ...(extras.testCommand ? { testCommand: extras.testCommand } : {}),
});

const fakePassRunner = async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => ({
  exitCode: 0,
  stdout: 'PASS',
  stderr: '',
});
const fakeFailRunner = async (): Promise<{ exitCode: number; stdout: string; stderr: string }> => ({
  exitCode: 1,
  stdout: '',
  stderr: 'FAIL',
});

const noopWorktree = async <T>(_repo: string, _ref: string, fn: (p: string) => Promise<T>): Promise<T> => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-test-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe('swebench instance evaluator', () => {
  describe('evaluateInstanceSynthesizer', () => {
    it('records GENERATED status when synthesis succeeds; flags fp when test passes against base', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const testFile = path.join(repoPath, 'regression.test.js');
      fs.writeFileSync(testFile, 'expect(1).toBe(1);');
      try {
        const record = await evaluateInstanceSynthesizer({
          instanceId: 'fake-1',
          problemStatement: 'broken function returns wrong value',
          repoPath,
          synthesizeFn: async () => fakeSynth('GENERATED', {
            testFilePath: testFile,
            testCommand: 'node ./regression.test.js',
            attempts: [{
              attemptNumber: 1,
              adapterExitCode: 0,
              validation: 'accepted',
              candidate: { testFilePath: testFile, testCommand: 'node ./regression.test.js', testSource: 'expect(1).toBe(2);' },
            }],
          }),
          runCommand: fakePassRunner,
          withWorktreeFn: noopWorktree,
        });

        assert.equal(record.instanceId, 'fake-1');
        assert.equal(record.status, 'GENERATED');
        assert.equal(record.basePass, true);
        assert.equal(record.fp, true, 'test passing against base means false positive');
        assert.equal(record.testSource, 'expect(1).toBe(2);');
        assert.ok(record.wallClockMs >= 0);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('records fn=true when synthesis fails to GENERATE', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      try {
        const record = await evaluateInstanceSynthesizer({
          instanceId: 'fake-2',
          problemStatement: 'unclear goal',
          repoPath,
          synthesizeFn: async () => fakeSynth('AMBIGUOUS_GOAL'),
          runCommand: fakePassRunner,
          withWorktreeFn: noopWorktree,
        });

        assert.equal(record.status, 'AMBIGUOUS_GOAL');
        assert.equal(record.basePass, null);
        assert.equal(record.goldPass, null);
        assert.equal(record.fn, true);
        assert.equal(record.fp, false);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('flags fn when synthesized test fails against goldPatchRef', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const testFile = path.join(repoPath, 'regression.test.js');
      fs.writeFileSync(testFile, 'expect(true).toBe(true);');
      try {
        let calls = 0;
        const record = await evaluateInstanceSynthesizer({
          instanceId: 'fake-3',
          problemStatement: 'goal',
          repoPath,
          goldPatchRef: 'gold-eval',
          synthesizeFn: async () => fakeSynth('GENERATED', {
            testFilePath: testFile,
            testCommand: 'node ./regression.test.js',
          }),
          runCommand: async () => {
            calls += 1;
            // base run fails (good), gold run also fails (bad)
            return { exitCode: 1, stdout: '', stderr: 'fail' };
          },
          withWorktreeFn: noopWorktree,
        });

        assert.equal(record.basePass, false);
        assert.equal(record.goldPass, false);
        assert.equal(record.fp, false);
        assert.equal(record.fn, true);
        assert.equal(calls, 2, 'should run command twice (base + gold)');
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('rewrites a hardcoded cd <repoPath> in testCommand to point at the worktree on the gold run', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const testFile = path.join(repoPath, 'regression.test.js');
      fs.writeFileSync(testFile, '// candidate');
      // testCommand contains an absolute cd into repoPath. Without rewrite,
      // the gold-run cwd is overridden by the cd and the test runs against
      // base, masking goldPass measurement (the real failure mode in the
      // 2026-04-30 smoke for django__django-10999 / 11099).
      const testCommand = `cd ${repoPath} && node ./regression.test.js`;
      const observedCommands: Array<{ command: string; cwd: string }> = [];
      try {
        const record = await evaluateInstanceSynthesizer({
          instanceId: 'fake-cd',
          problemStatement: 'goal',
          repoPath,
          goldPatchRef: 'gold-eval',
          synthesizeFn: async () => fakeSynth('GENERATED', {
            testFilePath: testFile,
            testCommand,
          }),
          runCommand: async (command: string, cwd: string) => {
            observedCommands.push({ command, cwd });
            return { exitCode: 1, stdout: '', stderr: 'fail' };
          },
          withWorktreeFn: noopWorktree,
        });

        assert.equal(observedCommands.length, 2, 'base + gold runs');
        assert.equal(observedCommands[0]?.command, testCommand, 'base run uses original testCommand');
        const goldCommand = observedCommands[1]?.command ?? '';
        assert.ok(
          !goldCommand.includes(repoPath) || goldCommand.split(repoPath).length === 1,
          `gold-run command must not still reference base repoPath. command=${goldCommand}`,
        );
        assert.ok(goldCommand.startsWith('cd '), 'gold command preserves leading cd');
        assert.equal(record.fn, true);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('wraps base and gold testCommand with venvBin PATH when supplied', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const testFile = path.join(repoPath, 'regression.test.js');
      fs.writeFileSync(testFile, '// candidate');
      const observedCommands: string[] = [];
      try {
        await evaluateInstanceSynthesizer({
          instanceId: 'fake-venv',
          problemStatement: 'goal',
          repoPath,
          goldPatchRef: 'gold-eval',
          venvBin: '/srv/p1-venvs/example/.venv/bin',
          synthesizeFn: async () => fakeSynth('GENERATED', {
            testFilePath: testFile,
            testCommand: 'python -m pytest regression.test.py',
          }),
          runCommand: async (command: string) => {
            observedCommands.push(command);
            return { exitCode: 1, stdout: '', stderr: 'fail' };
          },
          withWorktreeFn: noopWorktree,
        });

        assert.equal(observedCommands.length, 2);
        for (const cmd of observedCommands) {
          assert.ok(
            cmd.startsWith('export PATH=/srv/p1-venvs/example/.venv/bin:$PATH;'),
            `expected PATH wrap on ${cmd}`,
          );
        }
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('returns ERROR record without throwing when synthesizer raises', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      try {
        const record = await evaluateInstanceSynthesizer({
          instanceId: 'fake-err',
          problemStatement: 'goal',
          repoPath,
          synthesizeFn: async () => {
            throw new Error('adapter died');
          },
          runCommand: fakePassRunner,
          withWorktreeFn: noopWorktree,
        });

        assert.equal(record.status, 'ERROR');
        assert.equal(record.error, 'adapter died');
        assert.equal(record.fn, true);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });
  });

  describe('evaluateInstancePropertyGate', () => {
    it('SKIPs when gold patch touches no files', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      try {
        const record = await evaluateInstancePropertyGate({
          instanceId: 'fake-skip',
          repoPath,
          goldPatchText: '',
          baseCommit: 'HEAD',
          withWorktreeFn: noopWorktree,
          applyPatchFn: () => {},
        });

        assert.equal(record.status, 'SKIP');
        assert.deepEqual(record.modifiedFunctions, []);
        assert.deepEqual(record.counterexamples, []);
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('runs property gate against the gold-applied worktree and records counterexamples', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const goldPatch = [
        'diff --git a/src/util.ts b/src/util.ts',
        '--- a/src/util.ts',
        '+++ b/src/util.ts',
        '@@ -1,1 +1,3 @@',
        '+export function add(a: number, b: number): number {',
        '+  return a + b;',
        '+}',
        '',
      ].join('\n');

      const captured: string[] = [];
      const gateRunner: PropertyCommandRunner = async (command, cwd, _timeout) => {
        captured.push(command);
        // Pretend the harness produced a counterexample.
        return {
          command,
          cwd,
          exitCode: 1,
          stdout: 'Counterexample: [1, "x"] -> TypeError',
          stderr: '',
          durationMs: 5,
          timedOut: false,
        };
      };

      try {
        const applyCalls: Array<{ patch: string }> = [];
        const record = await evaluateInstancePropertyGate({
          instanceId: 'fake-prop',
          repoPath,
          goldPatchText: goldPatch,
          baseCommit: 'HEAD',
          commandRunner: gateRunner,
          withWorktreeFn: async (_repo, _ref, fn) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-wt-'));
            fs.mkdirSync(path.join(dir, 'src'));
            try {
              return await fn(dir);
            } finally {
              fs.rmSync(dir, { recursive: true, force: true });
            }
          },
          applyPatchFn: (worktreePath, patch) => {
            applyCalls.push({ patch });
            // Materialize the gold patch's added file so discoverPropertyTargets can find it.
            const file = path.join(worktreePath, 'src', 'util.ts');
            fs.writeFileSync(file, 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
          },
        });

        assert.equal(record.instanceId, 'fake-prop');
        assert.equal(applyCalls.length, 1, 'gold patch should be applied once');
        assert.equal(record.modifiedFunctions[0]?.functionName, 'add');
        assert.equal(record.modifiedFunctions[0]?.line, 1);
        assert.equal(record.modifiedFunctions[0]?.typed, true);
        assert.equal(record.counterexamples.length, 1);
        assert.match(record.counterexamples[0]?.message ?? '', /TypeError/);
        assert.ok(captured[0]?.includes('add'), 'harness command should reference function name');
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('wraps the property-gate command runner with venvBin PATH when supplied', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      const goldPatch = [
        'diff --git a/src/util.ts b/src/util.ts',
        '--- a/src/util.ts',
        '+++ b/src/util.ts',
        '@@ -1,1 +1,3 @@',
        '+export function add(a: number, b: number): number {',
        '+  return a + b;',
        '+}',
        '',
      ].join('\n');

      const seenCommands: string[] = [];
      const gateRunner: PropertyCommandRunner = async (command, cwd) => {
        seenCommands.push(command);
        return {
          command,
          cwd,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 1,
          timedOut: false,
        };
      };

      try {
        await evaluateInstancePropertyGate({
          instanceId: 'fake-prop-venv',
          repoPath,
          goldPatchText: goldPatch,
          baseCommit: 'HEAD',
          venvBin: '/srv/p1-venvs/example/.venv/bin',
          commandRunner: gateRunner,
          withWorktreeFn: async (_repo, _ref, fn) => {
            const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-wt-'));
            fs.mkdirSync(path.join(dir, 'src'));
            try {
              return await fn(dir);
            } finally {
              fs.rmSync(dir, { recursive: true, force: true });
            }
          },
          applyPatchFn: (worktreePath) => {
            const file = path.join(worktreePath, 'src', 'util.ts');
            fs.writeFileSync(file, 'export function add(a: number, b: number): number {\n  return a + b;\n}\n');
          },
        });

        assert.ok(seenCommands.length > 0, 'gate runner must be invoked');
        for (const cmd of seenCommands) {
          assert.ok(
            cmd.startsWith('export PATH=/srv/p1-venvs/example/.venv/bin:$PATH;'),
            `expected PATH wrap on ${cmd}`,
          );
        }
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });

    it('returns ERROR record without throwing when worktree setup fails', async () => {
      const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'evalhook-repo-'));
      try {
        const record = await evaluateInstancePropertyGate({
          instanceId: 'fake-err',
          repoPath,
          goldPatchText: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -0,0 +1 @@\n+y\n',
          baseCommit: 'HEAD',
          withWorktreeFn: async () => {
            throw new Error('worktree create failed');
          },
        });

        assert.equal(record.status, 'ERROR');
        assert.equal(record.error, 'worktree create failed');
      } finally {
        fs.rmSync(repoPath, { recursive: true, force: true });
      }
    });
  });

  describe('appendJsonlRecord', () => {
    it('appends one record per line; preserves prior content', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-test-'));
      const file = path.join(dir, 'sub', 'records.jsonl');
      try {
        appendJsonlRecord(file, { a: 1 });
        appendJsonlRecord(file, { a: 2, nested: { ok: true } });
        const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
        assert.equal(lines.length, 2);
        assert.deepEqual(JSON.parse(lines[0]!), { a: 1 });
        assert.deepEqual(JSON.parse(lines[1]!), { a: 2, nested: { ok: true } });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
