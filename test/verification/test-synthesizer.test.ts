import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from '../../src/adapters/agent-adapter';
import { DEFAULT_TIMEOUT_MS, synthesizeRegressionTest } from '../../src/verification';

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
    // Candidates land at repo root with the swarm-synth-attempt prefix so
    // their __file__ resolves to the worktree root, not a subdirectory the
    // candidate's import workarounds can't reach. See docs/p1-real-data-findings.md.
    assert.ok(result.testFilePath?.startsWith(repo));
    assert.ok(path.basename(result.testFilePath ?? '').startsWith('swarm-synth-attempt-'));
    assert.strictEqual(path.dirname(result.testFilePath ?? ''), repo);
  });

  it('forwards the configured timeoutMs to the adapter spawn', async () => {
    // The 2026-05-02 multi-repo Layer 1 sweep had four `Process killed
    // after 120s of no output` rejections (sphinx, pylint, one Django)
    // because the synthesizer's default timeout was 120_000 — shorter
    // than Claude Code's own 600_000 stall budget. The adapter receives
    // the synthesizer's timeoutMs as its `timeout` field; this test
    // pins that contract so a future regression cannot silently shrink
    // it again.
    const observed: Array<{ timeout: number | undefined }> = [];
    class TimeoutObservingAdapter implements AgentAdapter {
      readonly name = 'observing';
      async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
        observed.push({ timeout: opts.timeout });
        return {
          stdout: candidate("const assert = require('assert');\nassert.strictEqual(1, 2);\n"),
          stderr: '',
          exitCode: 0,
          durationMs: 1,
        };
      }
    }
    const repo = tmpRepo();
    dirs.push(repo);

    await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter: new TimeoutObservingAdapter(),
      maxAttempts: 1,
    });
    assert.equal(observed[0]?.timeout, DEFAULT_TIMEOUT_MS,
      'default timeout must equal DEFAULT_TIMEOUT_MS so hard prompts do not stall-fail');
    assert.equal(DEFAULT_TIMEOUT_MS, 600_000,
      'DEFAULT_TIMEOUT_MS must match claude-code-adapter STALL_TIMEOUT_MS (600_000)');

    observed.length = 0;
    await synthesizeRegressionTest({
      goalText: 'goal',
      targetRepoPath: repo,
      adapter: new TimeoutObservingAdapter(),
      maxAttempts: 1,
      timeoutMs: 45_000,
    });
    assert.equal(observed[0]?.timeout, 45_000,
      'explicit timeoutMs must override the default');
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
