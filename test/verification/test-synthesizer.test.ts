import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from '../../src/adapters/agent-adapter';
import {
  synthesizeRegressionTest,
  validateSynthesizedTestCandidate,
} from '../../src/verification';

class FakeAdapter implements AgentAdapter {
  readonly name = 'fake';
  private calls = 0;

  constructor(private readonly responses: string[]) {}

  get callCount(): number {
    return this.calls;
  }

  async spawn(_opts: AgentSpawnOptions): Promise<AgentResult> {
    const response = this.responses[this.calls] ?? this.responses[this.responses.length - 1] ?? '{}';
    this.calls += 1;
    return {
      stdout: response,
      stderr: '',
      exitCode: 0,
      durationMs: 1,
    };
  }
}

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'synth-test-'));
}

function candidate(source: string): string {
  return JSON.stringify({
    testFilePath: 'regression.test.js',
    testCommand: 'node {{TEST_FILE}}',
    testSource: source,
  });
}

describe('test synthesizer', () => {
  let dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    dirs = [];
  });

  it('rejects candidates without clear assertions before running them', () => {
    const rejection = validateSynthesizedTestCandidate({
      testFilePath: 'regression.test.js',
      testCommand: 'node {{TEST_FILE}}',
      testSource: 'console.log("no assertion");',
    });

    assert.match(rejection ?? '', /no clear assertion/);
  });

  it('regenerates when the first candidate has no assertions', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const adapter = new FakeAdapter([
      candidate('console.log("not a real test");'),
      candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Expose the broken behavior',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 2,
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'GENERATED');
    assert.strictEqual(adapter.callCount, 2);
    assert.strictEqual(result.attempts[0].validation, 'rejected');
    assert.match(result.attempts[0].rejectionReason ?? '', /no clear assertion/);
    assert.ok(result.testFilePath?.includes(path.join('.swarm', 'synthesized-tests')));
  });

  it('regenerates when a candidate passes against the base codebase', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const adapter = new FakeAdapter([
      candidate("const assert = require('assert');\nassert.strictEqual(1, 1);\n"),
      candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Generate a failing regression test',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 2,
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'GENERATED');
    assert.strictEqual(adapter.callCount, 2);
    assert.strictEqual(result.attempts[0].commandResult?.exitCode, 0);
    assert.match(result.attempts[0].rejectionReason ?? '', /passed against the base/);
    assert.notStrictEqual(result.attempts[1].commandResult?.exitCode, 0);
  });

  it('returns AMBIGUOUS_GOAL when every candidate passes against base', async () => {
    const repo = tmpRepo();
    dirs.push(repo);
    const adapter = new FakeAdapter([
      candidate("const assert = require('assert');\nassert.strictEqual(1, 1);\n"),
      candidate("const assert = require('assert');\nassert.strictEqual(2, 2);\n"),
      candidate("const assert = require('assert');\nassert.deepStrictEqual([1], [1]);\n"),
    ]);

    const result = await synthesizeRegressionTest({
      goalText: 'Ambiguous request',
      targetRepoPath: repo,
      adapter,
      maxAttempts: 3,
      timeoutMs: 30_000,
    });

    assert.strictEqual(result.status, 'AMBIGUOUS_GOAL');
    assert.strictEqual(adapter.callCount, 3);
    assert.strictEqual(result.testCommand, undefined);
  });
});
