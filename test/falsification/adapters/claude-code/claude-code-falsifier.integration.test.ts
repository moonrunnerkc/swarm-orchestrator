import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliFalsifier } from '../../../../src/falsification/adapters/cli-falsifier';
import { claudeCodeProfile } from '../../../../src/falsification/adapters/profiles/claude-code';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';

/**
 * Real-CLI integration test for the ClaudeCode falsifier. Runs only
 * when `SWARM_E2E_CLAUDECODE=1` is set; otherwise mocha skips the
 * suite.
 *
 * Real subprocess invocation, no SDK shortcut. The test exercises the
 * smallest possible task that demonstrates end-to-end behaviour
 * (prompt → JSON envelope → fenced candidates → AST verifier confirms
 * a falsifying perturbation).
 */

const E2E_FLAG = 'SWARM_E2E_CLAUDECODE';

function claudeAvailable(): boolean {
  const result = spawnSync('claude', ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-claudecode-e2e-'));
}

describe('ClaudeCodeFalsifier real-CLI integration', function () {
  this.timeout(300_000);

  before(function () {
    if (process.env[E2E_FLAG] !== '1') {
      this.skip();
      return;
    }
    if (!claudeAvailable()) {
      throw new Error(
        `${E2E_FLAG}=1 is set but the claude binary is not on PATH. ` +
          `Install it (npm i -g @anthropic-ai/claude-code) or unset ${E2E_FLAG}.`,
      );
    }
  });

  it('produces at least one confirmed counter-example for a trivial no-upward-imports obligation', async () => {
    const workspace = makeWorkspace();
    try {
      const scope = path.join(workspace, 'lib');
      fs.mkdirSync(scope, { recursive: true });
      fs.writeFileSync(path.join(scope, 'a.ts'), 'export const a = 1;\n', 'utf8');
      fs.writeFileSync(
        path.join(workspace, 'sibling.ts'),
        'export const sibling = 2;\n',
        'utf8',
      );
      const adapter = new CliFalsifier(claudeCodeProfile, { maxBudgetUsd: 1.0 });
      const input: FalsificationInput = {
        patchSha: '0'.repeat(40),
        obligation: {
          type: 'import-graph-must-satisfy',
          constraint: 'no-upward-imports',
          scope: 'lib',
        },
        contextRefs: [],
        timeBudgetMs: 240_000,
        workspaceRoot: workspace,
      };
      const outcome = await adapter.falsify(input);
      assert.equal(outcome.cost.adapterName, 'claude-code');
      assert.ok(outcome.cost.wallClockMs > 0);

      switch (outcome.result.kind) {
        case 'counter-example-input':
          assert.ok(outcome.result.inputs.length > 0);
          for (const example of outcome.result.inputs) {
            assert.ok(example.reproducerExitCode !== 0);
            assert.ok(example.files.length > 0);
          }
          assert.ok(outcome.cost.counterExamplesFound > 0);
          break;
        case 'no-falsification-found':
          assert.fail(
            `ClaudeCode returned no-falsification-found (reason=${outcome.result.reason}, ` +
              `attempts=${outcome.result.attempts}) on the trivial no-upward-imports obligation.`,
          );
          break;
        default:
          assert.fail(`unexpected result kind: ${outcome.result.kind}`);
      }
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
