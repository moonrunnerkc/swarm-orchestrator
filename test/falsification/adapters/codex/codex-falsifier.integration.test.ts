import { strict as assert } from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliFalsifier } from '../../../../src/falsification/adapters/cli-falsifier';
import { codexProfile } from '../../../../src/falsification/adapters/profiles/codex';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';

/**
 * Real-CLI integration test for the Codex falsifier. Exercises the full
 * adapter against an installed `codex` binary plus valid OpenAI
 * credentials in the environment. Runs only when `SWARM_E2E_CODEX=1` is
 * set; otherwise mocha skips the suite, which keeps CI green when the
 * binary is absent.
 *
 * Per `docs/adapter-integration.md` Phase 1: "If the binary is not
 * present in CI, gate the test on an env var, but the test must run and
 * pass against a real Codex install locally."
 */

const E2E_FLAG = 'SWARM_E2E_CODEX';

function codexAvailable(): boolean {
  const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
  return result.error === undefined && result.status === 0;
}

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-codex-e2e-'));
}

describe('CodexFalsifier real-CLI integration', function () {
  this.timeout(180_000);

  before(function () {
    if (process.env[E2E_FLAG] !== '1') {
      this.skip();
      return;
    }
    if (!codexAvailable()) {
      throw new Error(
        `${E2E_FLAG}=1 is set but the codex binary is not on PATH. ` +
          `Install it (npm i -g @openai/codex) or unset ${E2E_FLAG}.`,
      );
    }
  });

  it('produces at least one confirmed counter-example for a trivial property', async () => {
    const workspace = makeWorkspace();
    try {
      const adapter = new CliFalsifier(codexProfile, );
      const input: FalsificationInput = {
        patchSha: '0000000000000000000000000000000000000000',
        obligation: {
          type: 'property-must-hold',
          predicate: '! grep -r "FORBIDDEN_TOKEN_XYZ_12345" . 2>/dev/null',
          target: 'no occurrences of FORBIDDEN_TOKEN_XYZ_12345 in workspace',
        },
        contextRefs: [],
        timeBudgetMs: 150_000,
        workspaceRoot: workspace,
      };
      const outcome = await adapter.falsify(input);
      assert.equal(outcome.cost.adapterName, 'codex');
      assert.ok(outcome.cost.wallClockMs > 0);
      assert.ok(outcome.cost.dollarsSpent >= 0);

      switch (outcome.result.kind) {
        case 'counter-example-input':
          assert.ok(
            outcome.result.inputs.length > 0,
            'expected at least one confirmed counter-example for the trivial token-grep property',
          );
          for (const example of outcome.result.inputs) {
            assert.ok(example.reproducerExitCode !== 0);
            assert.ok(example.files.length > 0);
          }
          assert.ok(outcome.cost.counterExamplesFound > 0);
          break;
        case 'no-falsification-found':
          // For this property the strategy should always produce a hit.
          // Treat zero as a real failure so the dev gate sees it.
          assert.fail(
            `Codex returned no-falsification-found (reason=${outcome.result.reason}, ` +
              `attempts=${outcome.result.attempts}) on the trivial token-grep property. ` +
              `This is a Phase 1 dev-gate failure: investigate the prompt or model.`,
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
