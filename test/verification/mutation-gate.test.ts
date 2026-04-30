import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildMutationCommand,
  detectMutationLanguages,
  evaluateMutationScore,
  loadMutationThresholds,
  parseMutationOutput,
  runMutationGate,
  type MutationCommandRunner,
} from '../../src/verification';

describe('mutation gate', () => {
  it('groups changed files by supported mutation testing language', () => {
    const targets = detectMutationLanguages([
      'src/index.ts',
      'src/index.d.ts',
      'src/widget.jsx',
      'service/app.py',
      'src/main/java/com/acme/App.java',
      'README.md',
    ]);

    assert.deepStrictEqual(targets, [
      { language: 'javascript-typescript', files: ['src/index.ts', 'src/widget.jsx'] },
      { language: 'python', files: ['service/app.py'] },
      { language: 'java', files: ['src/main/java/com/acme/App.java'] },
    ]);
  });

  it('classifies mutation scores with default thresholds', () => {
    assert.strictEqual(evaluateMutationScore(0.55), 'FAIL');
    assert.strictEqual(evaluateMutationScore(0.65), 'WARNING');
    assert.strictEqual(evaluateMutationScore(0.85), 'PASS');
  });

  it('parses common mutation tool output', () => {
    const result = parseMutationOutput([
      'Mutation score: 85.00%',
      'Killed: 17',
      'Survived: 3',
      'Total mutants: 20',
    ].join('\n'));

    assert.strictEqual(result.totalMutants, 20);
    assert.strictEqual(result.killedMutants, 17);
    assert.strictEqual(result.survivedMutants, 3);
    assert.strictEqual(result.mutationScore, 0.85);
  });

  it('loads mutation thresholds from .swarm/gates.yaml', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-config-'));
    try {
      fs.mkdirSync(path.join(root, '.swarm'), { recursive: true });
      fs.writeFileSync(path.join(root, '.swarm', 'gates.yaml'), [
        'verification:',
        '  mutation:',
        '    failBelow: 0.7',
        '    warnBelow: 0.9',
        '',
      ].join('\n'), 'utf8');

      assert.deepStrictEqual(loadMutationThresholds(root), {
        failBelow: 0.7,
        warnBelow: 0.9,
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('builds a Stryker command scoped to changed JS and TS files', () => {
    const command = buildMutationCommand('/repo', {
      language: 'javascript-typescript',
      files: ['src/a.ts', 'src/b.js'],
    });

    assert.match(command, /^npx stryker run/);
    assert.match(command, /--mutate/);
    assert.match(command, /src\/a\.ts/);
    assert.match(command, /src\/b\.js/);
  });

  it('aggregates mutation tool results and applies thresholds', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-run-'));
    const runner: MutationCommandRunner = async (command, cwd, _timeoutMs) => ({
      command,
      cwd,
      exitCode: 0,
      stdout: [
        'Killed: 13',
        'Survived: 7',
        'Total mutants: 20',
      ].join('\n'),
      stderr: '',
      durationMs: 5,
      timedOut: false,
    });

    try {
      const result = await runMutationGate({
        targetRepoPath: root,
        changedFiles: ['src/a.ts'],
        commandRunner: runner,
      });

      assert.strictEqual(result.status, 'WARNING');
      assert.strictEqual(result.totalMutants, 20);
      assert.strictEqual(result.killedMutants, 13);
      assert.strictEqual(result.survivedMutants, 7);
      assert.strictEqual(result.mutationScore, 0.65);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips when no changed files have a supported language', async () => {
    const result = await runMutationGate({
      targetRepoPath: process.cwd(),
      changedFiles: ['README.md'],
    });

    assert.strictEqual(result.status, 'SKIP');
    assert.strictEqual(result.results.length, 0);
  });
});
