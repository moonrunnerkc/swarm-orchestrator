import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliFalsifier } from '../../../../src/falsification/adapters/cli-falsifier';
import { copilotProfile } from '../../../../src/falsification/adapters/profiles/copilot';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';

/**
 * Real-CLI integration test for the Copilot falsifier. Exercises the full
 * adapter against an installed `copilot` binary plus a logged-in
 * Copilot session. Runs only when `SWARM_E2E_COPILOT=1` is set; otherwise
 * mocha skips the suite.
 *
 * Per `docs/adapter-integration.md` Phase 3: the integration test must
 * run the real CLI locally; CI may skip via the env-var gate.
 *
 * The test relaxes the production per-tool permission set to
 * `--allow-all-tools` because (a) it runs inside an isolated temp
 * workspace that is deleted at end-of-test, and (b) we want this test to
 * exercise the real model behaviour, not the production sandboxing.
 * Production runs leave the default per-tool grant set in place.
 */

const E2E_FLAG = 'SWARM_E2E_COPILOT';

function copilotAvailable(): boolean {
  const result = spawnSync('copilot', ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-copilot-e2e-'));
}

describe('CopilotFalsifier real-CLI integration', function () {
  this.timeout(300_000);

  before(function () {
    if (process.env[E2E_FLAG] !== '1') {
      this.skip();
      return;
    }
    if (!copilotAvailable()) {
      throw new Error(
        `${E2E_FLAG}=1 is set but the copilot binary is not on PATH. ` +
          `Install it (npm i -g @github/copilot) or unset ${E2E_FLAG}.`,
      );
    }
  });

  it('produces at least one confirmed counter-example for a trivial no-upward-imports obligation', async () => {
    const workspace = makeWorkspace();
    try {
      // Set up a tiny scope the import-graph verifier can walk. The
      // unmodified workspace satisfies the obligation (no imports at
      // all); the falsifier should add a file with an upward import.
      const scope = path.join(workspace, 'lib');
      fs.mkdirSync(scope, { recursive: true });
      fs.writeFileSync(
        path.join(scope, 'a.ts'),
        'export const a = 1;\n',
        'utf8',
      );
      // Sibling file outside the scope so an upward import has somewhere
      // to point.
      fs.writeFileSync(
        path.join(workspace, 'sibling.ts'),
        'export const sibling = 2;\n',
        'utf8',
      );
      const adapter = new CliFalsifier(copilotProfile, { allowedTools: 'all' });
      const input: FalsificationInput = {
        patchSha: '0000000000000000000000000000000000000000',
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
      assert.equal(outcome.cost.adapterName, 'copilot');
      assert.ok(outcome.cost.wallClockMs > 0);
      assert.ok(outcome.cost.dollarsTokenEstimate >= 0);

      switch (outcome.result.kind) {
        case 'counter-example-input':
          assert.ok(
            outcome.result.inputs.length > 0,
            'expected at least one confirmed counter-example for the trivial no-upward-imports obligation',
          );
          for (const example of outcome.result.inputs) {
            assert.ok(example.reproducerExitCode !== 0);
            assert.ok(example.files.length > 0);
          }
          assert.ok(outcome.cost.counterExamplesFound > 0);
          break;
        case 'no-falsification-found':
          assert.fail(
            `Copilot returned no-falsification-found (reason=${outcome.result.reason}, ` +
              `attempts=${outcome.result.attempts}) on the trivial no-upward-imports obligation. ` +
              `This is a Phase 3 dev-gate failure: investigate the prompt or model.`,
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
