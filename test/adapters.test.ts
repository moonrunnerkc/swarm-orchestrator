import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AgentAdapter, AgentResult, AgentSpawnOptions, buildRestrictedEnv } from '../src/adapters/agent-adapter';
import { CopilotAdapter, hasFatalStderrError, parseCopilotRequestCount, scrubCopilotHostileTokens } from '../src/adapters/copilot-adapter';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code-adapter';
import { CodexAdapter } from '../src/adapters/codex-adapter';
import { resolveAdapter } from '../src/adapters';
import SessionExecutor, { SessionResult } from '../src/session-executor';
import { parseSwarmFlags } from '../src/cli-handlers';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'adapters-test-'));
}

// Stub adapter for testing SessionExecutor delegation without spawning real processes
class StubAdapter implements AgentAdapter {
  readonly name = 'stub';
  lastOpts: AgentSpawnOptions | undefined;
  resultToReturn: AgentResult;

  constructor(result?: Partial<AgentResult>) {
    this.resultToReturn = {
      stdout: result?.stdout ?? 'stub output',
      stderr: result?.stderr ?? '',
      exitCode: result?.exitCode ?? 0,
      durationMs: result?.durationMs ?? 42,
      shareTranscriptPath: result?.shareTranscriptPath,
    };
  }

  async spawn(opts: AgentSpawnOptions): Promise<AgentResult> {
    this.lastOpts = opts;
    return this.resultToReturn;
  }
}

describe('Agent Adapters', () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    tempDirs = [];
  });

  describe('resolveAdapter()', () => {
    it('resolves "copilot" to CopilotAdapter', () => {
      const adapter = resolveAdapter('copilot');
      assert.strictEqual(adapter.name, 'copilot');
      assert.ok(adapter instanceof CopilotAdapter);
    });

    it('resolves "claude-code" to ClaudeCodeAdapter', () => {
      const adapter = resolveAdapter('claude-code');
      assert.strictEqual(adapter.name, 'claude-code');
      assert.ok(adapter instanceof ClaudeCodeAdapter);
    });

    it('resolves "codex" to CodexAdapter', () => {
      const adapter = resolveAdapter('codex');
      assert.strictEqual(adapter.name, 'codex');
      assert.ok(adapter instanceof CodexAdapter);
    });

    it('throws on unknown adapter with available names in message', () => {
      assert.throws(
        () => resolveAdapter('unknown-agent'),
        (err: Error) => {
          assert.ok(err.message.includes('"unknown-agent"'));
          assert.ok(err.message.includes('copilot'));
          assert.ok(err.message.includes('claude-code'));
          assert.ok(err.message.includes('codex'));
          return true;
        }
      );
    });
  });

  describe('Adapter names', () => {
    it('CopilotAdapter has name "copilot"', () => {
      assert.strictEqual(new CopilotAdapter().name, 'copilot');
    });

    it('ClaudeCodeAdapter has name "claude-code"', () => {
      assert.strictEqual(new ClaudeCodeAdapter().name, 'claude-code');
    });

    it('CodexAdapter has name "codex"', () => {
      assert.strictEqual(new CodexAdapter().name, 'codex');
    });
  });

  describe('SessionExecutor with adapter', () => {
    it('delegates to adapter.spawn when adapter is set', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const stub = new StubAdapter({ stdout: 'hello world', stderr: '', exitCode: 0, durationMs: 100 });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('test prompt');

      assert.ok(stub.lastOpts, 'adapter.spawn should have been called');
      assert.strictEqual(stub.lastOpts!.prompt, 'test prompt');
      assert.strictEqual(stub.lastOpts!.workdir, dir);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.output, 'hello world');
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.duration, 100);
    });

    it('maps model and agent options to adapter spawn', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const stub = new StubAdapter();
      const executor = new SessionExecutor(dir, stub);

      await executor.executeSession('task', { model: 'o3', agent: '@workspace' });

      assert.strictEqual(stub.lastOpts!.model, 'o3');
      assert.strictEqual(stub.lastOpts!.copilotAgent, '@workspace');
    });

    it('maps failed exit code to SessionResult error field', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const stub = new StubAdapter({ stdout: '', stderr: 'build failed', exitCode: 1 });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('failing task');

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(result.error, 'build failed');
    });

    it('does not set error when exit code is 0', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const stub = new StubAdapter({ stdout: 'ok', stderr: 'warning', exitCode: 0 });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('task');

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.error, undefined);
      // stderr is still part of output
      assert.ok(result.output.includes('warning'));
    });

    it('generates fallback transcript for non-Copilot adapters', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const transcriptPath = path.join(dir, 'proof', 'step-1.md');
      const stub = new StubAdapter({ stdout: 'generated code here' });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('build api', { shareToFile: transcriptPath });

      assert.ok(fs.existsSync(transcriptPath), 'fallback transcript should be written');
      const content = fs.readFileSync(transcriptPath, 'utf8');
      assert.ok(content.includes('generated code here'));
      assert.strictEqual(result.transcriptPath, transcriptPath);
    });

    it('writes transcript even when session fails so verification can inspect agent work', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const transcriptPath = path.join(dir, 'proof', 'step-1.md');
      const stub = new StubAdapter({ stdout: '', exitCode: 1, stderr: 'permission denied' });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('failing', { shareToFile: transcriptPath });

      assert.ok(fs.existsSync(transcriptPath), 'transcript should exist even on non-zero exit');
      assert.strictEqual(result.transcriptPath, transcriptPath, 'transcriptPath must be set on failure');
      const content = fs.readFileSync(transcriptPath, 'utf8');
      assert.ok(content.includes('permission denied'), 'transcript should include stderr when stdout is empty');
    });

    it('passes shareTranscriptPath from adapter result when present', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const sharePath = path.join(dir, 'copilot-share.md');
      fs.writeFileSync(sharePath, '# transcript', 'utf8');
      const stub = new StubAdapter({ shareTranscriptPath: sharePath });
      const executor = new SessionExecutor(dir, stub);

      const result = await executor.executeSession('task');

      assert.strictEqual(result.transcriptPath, sharePath);
    });
  });

  describe('SessionExecutor without adapter (backward compat)', () => {
    it('falls back to copilot path when no adapter set', () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      // Constructor without adapter should not throw
      const executor = new SessionExecutor(dir);
      assert.ok(executor, 'executor should be created');
    });
  });

  describe('--tool CLI flag parsing', () => {
    it('parses --tool copilot', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--tool', 'copilot']);
      assert.strictEqual(opts.cliAgent, 'copilot');
    });

    it('parses --tool claude-code', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--tool', 'claude-code']);
      assert.strictEqual(opts.cliAgent, 'claude-code');
    });

    it('parses --tool codex', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--tool', 'codex']);
      assert.strictEqual(opts.cliAgent, 'codex');
    });

    it('does not set cliAgent when --tool is absent', () => {
      const opts = parseSwarmFlags(['swarm', 'plan.json']);
      assert.strictEqual(opts.cliAgent, undefined);
    });

    it('preserves existing --agent flag independently', () => {
      // The --agent flag is handled in handleQuickCommand, not parseSwarmFlags,
      // so it should not interfere with --tool
      const opts = parseSwarmFlags(['swarm', 'plan.json', '--tool', 'claude-code']);
      assert.strictEqual(opts.cliAgent, 'claude-code');
    });
  });

  describe('hasFatalStderrError', () => {
    it('detects model-not-available error', () => {
      assert.strictEqual(
        hasFatalStderrError('Error: Model "claude-opus-4" from --model flag is not available.'),
        true
      );
    });

    it('detects model-not-available with different model name', () => {
      assert.strictEqual(
        hasFatalStderrError('Error: Model "gpt-4o" from --model flag is not available.'),
        true
      );
    });

    it('returns false for normal stderr warnings', () => {
      assert.strictEqual(
        hasFatalStderrError('Warning: some non-critical message'),
        false
      );
    });

    it('returns false for empty stderr', () => {
      assert.strictEqual(hasFatalStderrError(''), false);
    });

    it('returns false for scope noise', () => {
      assert.strictEqual(
        hasFatalStderrError('Permission denied and could not request permission'),
        false
      );
    });

    it('detects authentication failed error', () => {
      assert.strictEqual(
        hasFatalStderrError('Error: Authentication failed (Request ID: 98F0:2EA3FB:2CD219C:37F0BEE:69E3DC73)'),
        true
      );
    });

    it('detects token invalid/expired error', () => {
      assert.strictEqual(
        hasFatalStderrError('Your token is invalid or expired'),
        true
      );
    });
  });

  describe('parseCopilotRequestCount (P3/D5)', () => {
    // Resolve relative to the test source tree, not the dist/ compiled output.
    // __dirname at runtime is dist/test/, so repo root is two levels up.
    const fixturesDir = path.resolve(__dirname, '..', '..', 'test', 'fixtures', 'transcripts');

    it('extracts N=1 from a real short Copilot session', () => {
      const stderr = fs.readFileSync(
        path.join(fixturesDir, 'copilot-short-1premium.stderr.txt'),
        'utf8'
      );
      assert.strictEqual(parseCopilotRequestCount(stderr), 1);
    });

    it('extracts N=1 from a real multi-tool-use Copilot session (billing-accurate)', () => {
      const stderr = fs.readFileSync(
        path.join(fixturesDir, 'copilot-multi-step-1premium.stderr.txt'),
        'utf8'
      );
      // Copilot bills a multi-tool-use session as a single premium request,
      // even though the underlying session log shows multiple model calls.
      // The parser must match the user's actual bill, not the model-call count.
      assert.strictEqual(parseCopilotRequestCount(stderr), 1);
    });

    it('extracts N=4 from a multi-premium-request fixture', () => {
      const stderr = fs.readFileSync(
        path.join(fixturesDir, 'copilot-synthetic-4premium.stderr.txt'),
        'utf8'
      );
      assert.strictEqual(parseCopilotRequestCount(stderr), 4);
    });

    it('returns undefined when the Requests line is absent (auth failure)', () => {
      const stderr = fs.readFileSync(
        path.join(fixturesDir, 'copilot-auth-fail.stderr.txt'),
        'utf8'
      );
      assert.strictEqual(parseCopilotRequestCount(stderr), undefined);
    });

    it('returns undefined for empty input', () => {
      assert.strictEqual(parseCopilotRequestCount(''), undefined);
    });

    it('handles large two-digit counts', () => {
      assert.strictEqual(
        parseCopilotRequestCount('\nChanges +0 -0\nRequests  27 Premium (612s)\nTokens ...'),
        27
      );
    });

    it('handles zero request count without collapsing to undefined', () => {
      assert.strictEqual(
        parseCopilotRequestCount('\nRequests  0 Premium (1s)\n'),
        0
      );
    });
  });

  describe('scrubCopilotHostileTokens', () => {
    it('removes GITHUB_TOKEN, GH_TOKEN, COPILOT_GITHUB_TOKEN by default', () => {
      const cleaned = scrubCopilotHostileTokens({
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'ghp_xyz',
        GH_TOKEN: 'gho_xyz',
        COPILOT_GITHUB_TOKEN: 'ghc_xyz',
        HOME: '/home/u',
      });
      assert.strictEqual(cleaned.GITHUB_TOKEN, undefined);
      assert.strictEqual(cleaned.GH_TOKEN, undefined);
      assert.strictEqual(cleaned.COPILOT_GITHUB_TOKEN, undefined);
      assert.strictEqual(cleaned.PATH, '/usr/bin');
      assert.strictEqual(cleaned.HOME, '/home/u');
    });

    it('preserves tokens when SWARM_USE_ENV_GITHUB_TOKEN=1 is set', () => {
      const cleaned = scrubCopilotHostileTokens({
        GITHUB_TOKEN: 'ghp_keep',
        SWARM_USE_ENV_GITHUB_TOKEN: '1',
      });
      assert.strictEqual(cleaned.GITHUB_TOKEN, 'ghp_keep');
    });

    it('returns a fresh object (does not mutate the input)', () => {
      const source = { GITHUB_TOKEN: 'ghp_xyz', FOO: 'bar' };
      const cleaned = scrubCopilotHostileTokens(source);
      assert.strictEqual(source.GITHUB_TOKEN, 'ghp_xyz', 'source should be untouched');
      assert.strictEqual(cleaned.GITHUB_TOKEN, undefined);
      assert.strictEqual(cleaned.FOO, 'bar');
    });
  });

  describe('Adapter transcript edge cases', () => {
    it('includes stderr in transcript body when stdout is empty', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const transcriptPath = path.join(dir, 'proof', 'share.md');
      // Simulate an adapter that exits 0 but produced only stderr
      const stub = new StubAdapter({ stdout: '', stderr: 'diagnostic warning here', exitCode: 0 });
      const executor = new SessionExecutor(dir, stub);

      await executor.executeSession('task', { shareToFile: transcriptPath });

      assert.ok(fs.existsSync(transcriptPath), 'transcript should exist');
      const content = fs.readFileSync(transcriptPath, 'utf8');
      assert.ok(content.includes('diagnostic warning here'), 'stderr should appear in transcript when stdout is empty');
    });

    it('prefers stdout over stderr in transcript when both present', async () => {
      const dir = tmpDir();
      tempDirs.push(dir);
      const transcriptPath = path.join(dir, 'proof', 'share.md');
      const stub = new StubAdapter({ stdout: 'actual output', stderr: 'some warning', exitCode: 0 });
      const executor = new SessionExecutor(dir, stub);

      await executor.executeSession('task', { shareToFile: transcriptPath });

      const content = fs.readFileSync(transcriptPath, 'utf8');
      assert.ok(content.includes('actual output'), 'stdout should be in transcript');
      // stderr is not included in transcript body when stdout has content
      assert.ok(!content.includes('some warning'), 'stderr should not be in transcript body when stdout present');
    });
  });

  describe('buildRestrictedEnv', () => {
    it('always includes PATH, HOME, and git identity', () => {
      const env = buildRestrictedEnv([]);
      assert.ok(env.PATH, 'PATH must be present');
      assert.ok(env.HOME, 'HOME must be present');
      assert.strictEqual(env.GIT_AUTHOR_NAME, 'swarm-orchestrator');
      assert.strictEqual(env.GIT_COMMITTER_NAME, 'swarm-orchestrator');
    });

    it('forwards only the requested adapter keys from process.env', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      process.env.ANTHROPIC_API_KEY = 'test-key-123';
      try {
        const env = buildRestrictedEnv(['ANTHROPIC_API_KEY']);
        assert.strictEqual(env.ANTHROPIC_API_KEY, 'test-key-123');
        // Other secrets should not leak through
        assert.strictEqual(env.OPENAI_API_KEY, undefined);
      } finally {
        if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
        else process.env.ANTHROPIC_API_KEY = original;
      }
    });

    it('omits keys that are not set in process.env', () => {
      const original = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const env = buildRestrictedEnv(['OPENAI_API_KEY']);
        assert.strictEqual(env.OPENAI_API_KEY, undefined);
      } finally {
        if (original !== undefined) process.env.OPENAI_API_KEY = original;
      }
    });

    it('does not include unrelated process.env entries', () => {
      process.env.__RESTRICTED_ENV_TEST__ = 'should-not-appear';
      try {
        const env = buildRestrictedEnv([]);
        assert.strictEqual(env.__RESTRICTED_ENV_TEST__, undefined);
      } finally {
        delete process.env.__RESTRICTED_ENV_TEST__;
      }
    });
  });
});
