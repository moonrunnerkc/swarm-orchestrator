import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleRunV8, __testing } from '../../../src/cli/v8/run-wrapper';

/**
 * Unit tests for `handleRunV8` plus its argv-splitting and contract-dir
 * discovery helpers. The test seam (`RunV8Deps`) lets us exercise the
 * orchestration logic without spawning the real compile/run handlers.
 */

const { splitArgv, findLatestContractDir, requireValue } = __testing;

describe('cli/v8/run-wrapper splitArgv', () => {
  it('extracts every recognized compile-relevant flag from argv', () => {
    const split = splitArgv([
      '--goal',
      'add a greet function',
      '--repo-root',
      '/tmp/repo',
      '--extractor',
      'anthropic',
      '--api-key',
      'sk-test',
      '--model',
      'claude-opus-4-7',
      '--temperature',
      '0.3',
      '--session',
      'session-x',
    ]);
    assert.equal(split.goal, 'add a greet function');
    assert.equal(split.repoRoot, '/tmp/repo');
    assert.equal(split.extractor, 'anthropic');
    assert.equal(split.apiKey, 'sk-test');
    assert.equal(split.model, 'claude-opus-4-7');
    assert.equal(split.temperature, 0.3);
    // --repo-root, --api-key, --model still pass through to the run step.
    assert.deepEqual(split.runPassthrough, [
      '--repo-root',
      '/tmp/repo',
      '--api-key',
      'sk-test',
      '--model',
      'claude-opus-4-7',
      '--session',
      'session-x',
    ]);
  });

  it('returns null fields for absent flags and routes unknown flags through to runPassthrough', () => {
    const split = splitArgv(['--no-deterministic', '--cost-cap', '5']);
    assert.equal(split.goal, null);
    assert.equal(split.repoRoot, null);
    assert.equal(split.extractor, null);
    assert.equal(split.apiKey, null);
    assert.equal(split.model, null);
    assert.equal(split.temperature, null);
    assert.deepEqual(split.compilePassthrough, []);
    assert.deepEqual(split.runPassthrough, ['--no-deterministic', '--cost-cap', '5']);
  });

  it('forwards every --local-* flag to both compile and run passes', () => {
    const split = splitArgv([
      '--goal',
      'do thing',
      '--extractor',
      'local',
      '--session',
      'local',
      '--local-backend',
      'ollama',
      '--local-base-url',
      'http://localhost:11434/v1',
      '--local-model-extractor',
      'qwen2.5-coder:14b',
      '--local-model-session',
      'qwen2.5-coder:32b',
      '--local-grammar',
      'auto',
    ]);
    assert.deepEqual(split.compilePassthrough, [
      '--local-backend',
      'ollama',
      '--local-base-url',
      'http://localhost:11434/v1',
      '--local-model-extractor',
      'qwen2.5-coder:14b',
      '--local-model-session',
      'qwen2.5-coder:32b',
      '--local-grammar',
      'auto',
    ]);
    assert.deepEqual(split.runPassthrough, [
      '--session',
      'local',
      '--local-backend',
      'ollama',
      '--local-base-url',
      'http://localhost:11434/v1',
      '--local-model-extractor',
      'qwen2.5-coder:14b',
      '--local-model-session',
      'qwen2.5-coder:32b',
      '--local-grammar',
      'auto',
    ]);
  });

  it('rejects --local-* flag without a value', () => {
    assert.throws(() => splitArgv(['--local-backend']), /requires a value/);
  });

  it('throws when --temperature is not a finite number', () => {
    assert.throws(() => splitArgv(['--temperature', 'not-a-number']), /invalid --temperature/);
  });

  it('requireValue rejects flags whose value is missing or starts with --', () => {
    assert.throws(() => requireValue(['--goal'], 1, '--goal'), /requires a value/);
    assert.throws(
      () => requireValue(['--goal', '--repo-root'], 1, '--goal'),
      /requires a value/,
    );
    assert.equal(requireValue(['--goal', 'real value'], 1, '--goal'), 'real value');
  });
});

describe('cli/v8/run-wrapper findLatestContractDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-wrapper-test-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the parent directory does not exist', () => {
    const missing = path.join(tmpDir, 'does-not-exist');
    assert.equal(findLatestContractDir(missing), null);
  });

  it('returns null when the parent directory is empty', () => {
    assert.equal(findLatestContractDir(tmpDir), null);
  });

  it('returns the only contract dir when there is exactly one', () => {
    const only = path.join(tmpDir, 'contract-1');
    fs.mkdirSync(only);
    assert.equal(findLatestContractDir(tmpDir), only);
  });

  it('returns the most recently mtimed contract dir when multiple exist', () => {
    const older = path.join(tmpDir, 'older');
    const newer = path.join(tmpDir, 'newer');
    fs.mkdirSync(older);
    fs.mkdirSync(newer);
    // Force older to have an older mtime regardless of fs resolution.
    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(older, past, past);
    assert.equal(findLatestContractDir(tmpDir), newer);
  });

  it('ignores non-directory entries', () => {
    fs.writeFileSync(path.join(tmpDir, 'stray-file.json'), '{}');
    const dir = path.join(tmpDir, 'real-contract');
    fs.mkdirSync(dir);
    assert.equal(findLatestContractDir(tmpDir), dir);
  });
});

describe('cli/v8/run-wrapper handleRunV8', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'run-wrapper-handle-')));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns exit code 1 when --goal is missing', async () => {
    let compileCalled = false;
    let runCalled = false;
    const exit = await handleRunV8([], {
      handleCompile: async () => {
        compileCalled = true;
        return 0;
      },
      handleRun: async () => {
        runCalled = true;
        return 0;
      },
    });
    assert.equal(exit, 1);
    assert.equal(compileCalled, false, 'compile must not run without --goal');
    assert.equal(runCalled, false, 'run must not run without --goal');
  });

  it('forwards compile failure exit code without invoking run', async () => {
    let runCalled = false;
    const exit = await handleRunV8(['--goal', 'do something', '--repo-root', tmpDir], {
      handleCompile: async () => 7,
      handleRun: async () => {
        runCalled = true;
        return 0;
      },
    });
    assert.equal(exit, 7);
    assert.equal(runCalled, false, 'run must not be called after compile failure');
  });

  it('returns 1 when compile succeeds but no contract directory is produced', async () => {
    const exit = await handleRunV8(['--goal', 'do something', '--repo-root', tmpDir], {
      handleCompile: async () => 0,
      handleRun: async () => 0,
    });
    assert.equal(exit, 1);
  });

  it('routes the discovered contract dir into the run step and returns its exit code', async () => {
    const compileArgsCaptured: string[] = [];
    let runArgvCaptured: string[] = [];
    let runHandlerCalled = false;
    const exit = await handleRunV8(
      [
        '--goal',
        'add greet',
        '--repo-root',
        tmpDir,
        '--extractor',
        'anthropic',
        '--no-deterministic',
      ],
      {
        handleCompile: async (argv) => {
          compileArgsCaptured.push(...argv);
          // Simulate the compile-handler writing a contract dir.
          const contractsParent = path.join(tmpDir, '.swarm', 'contracts');
          fs.mkdirSync(contractsParent, { recursive: true });
          fs.mkdirSync(path.join(contractsParent, 'contract-abc'));
          return 0;
        },
        handleRun: async (argv) => {
          runArgvCaptured = argv;
          runHandlerCalled = true;
          return 2;
        },
      },
    );

    assert.equal(exit, 2, 'wrapper must return run-handler exit code');
    assert.ok(compileArgsCaptured.includes('add greet'));
    assert.ok(compileArgsCaptured.includes('--extractor'));
    assert.ok(compileArgsCaptured.includes('anthropic'));
    assert.ok(runHandlerCalled, 'run handler must have been called');
    assert.equal(runArgvCaptured[0], path.join(tmpDir, '.swarm', 'contracts', 'contract-abc'));
    assert.ok(runArgvCaptured.includes('--no-deterministic'), 'unknown flag passed through');
  });

  it('forwards --local-* flags into the compile-handler argv', async () => {
    const compileArgsCaptured: string[] = [];
    const exit = await handleRunV8(
      [
        '--goal',
        'add greet',
        '--repo-root',
        tmpDir,
        '--extractor',
        'local',
        '--local-backend',
        'ollama',
        '--local-base-url',
        'http://localhost:11434/v1',
        '--local-model-extractor',
        'qwen2.5-coder:14b',
      ],
      {
        handleCompile: async (argv) => {
          compileArgsCaptured.push(...argv);
          const contractsParent = path.join(tmpDir, '.swarm', 'contracts');
          fs.mkdirSync(contractsParent, { recursive: true });
          fs.mkdirSync(path.join(contractsParent, 'contract-local'));
          return 0;
        },
        handleRun: async () => 0,
      },
    );
    assert.equal(exit, 0);
    assert.ok(compileArgsCaptured.includes('--local-backend'));
    assert.ok(compileArgsCaptured.includes('ollama'));
    assert.ok(compileArgsCaptured.includes('--local-base-url'));
    assert.ok(compileArgsCaptured.includes('http://localhost:11434/v1'));
    assert.ok(compileArgsCaptured.includes('--local-model-extractor'));
    assert.ok(compileArgsCaptured.includes('qwen2.5-coder:14b'));
  });
});
