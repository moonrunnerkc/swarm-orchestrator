import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeCodeTeamsAdapter, TeamWaveResult } from '../../src/adapters/claude-code-teams';
import { AgentAdapter, AgentResult, AgentSpawnOptions } from '../../src/adapters/agent-adapter';

describe('ClaudeCodeTeamsAdapter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teams-adapter-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('constructor', () => {
    it('has name "claude-code-teams"', () => {
      const adapter = new ClaudeCodeTeamsAdapter();
      assert.strictEqual(adapter.name, 'claude-code-teams');
    });

    it('implements AgentAdapter interface', () => {
      const adapter: AgentAdapter = new ClaudeCodeTeamsAdapter();
      assert.strictEqual(typeof adapter.spawn, 'function');
    });
  });

  describe('spawn (single step)', function() {
    before(function() {
      if (!process.env.ANTHROPIC_API_KEY) this.skip();
    });

    it('returns AgentResult structure', async function() {
      this.timeout(15000);
      // spawn will fail (no claude CLI), but the fallback should handle it
      const adapter = new ClaudeCodeTeamsAdapter();

      const result = await adapter.spawn({
        prompt: 'echo test',
        workdir: tmpDir
      });

      assert.strictEqual(typeof result.stdout, 'string');
      assert.strictEqual(typeof result.stderr, 'string');
      assert.strictEqual(typeof result.exitCode, 'number');
      assert.strictEqual(typeof result.durationMs, 'number');
    });
  });

  describe('executeWave', function() {
    before(function() {
      if (!process.env.ANTHROPIC_API_KEY) this.skip();
    });

    it('handles empty wave', async () => {
      const adapter = new ClaudeCodeTeamsAdapter();
      const results = await adapter.executeWave([]);
      assert.strictEqual(results.length, 0);
    });
  });

  describe('model validation', () => {
    it('isOpusModel returns true for opus model strings', () => {
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel('claude-opus-4.6'), true);
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel('opus-4.6'), true);
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel('claude-opus-4'), true);
    });

    it('isOpusModel returns false for non-opus models', () => {
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel('claude-sonnet-4'), false);
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel('gpt-5'), false);
      assert.strictEqual(ClaudeCodeTeamsAdapter.isOpusModel(undefined), false);
    });
  });

  describe('fallback behavior', function() {
    before(function() {
      if (!process.env.ANTHROPIC_API_KEY) this.skip();
    });

    it('falls back to per-step execution when team spawn fails', async function() {
      this.timeout(15000);
      const adapter = new ClaudeCodeTeamsAdapter();

      // Without claude CLI installed, team spawn will fail.
      // Adapter should fall back to per-step subprocess execution.
      const steps: AgentSpawnOptions[] = [
        { prompt: 'task 1', workdir: tmpDir }
      ];

      const results = await adapter.executeWave(steps);

      // Should still return results (from fallback path)
      assert.strictEqual(results.length, 1);
      assert.strictEqual(typeof results[0].exitCode, 'number');
    });
  });
});
