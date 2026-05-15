import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CliFalsifier } from '../../../../src/falsification/adapters/cli-falsifier';
import { codexProfile } from '../../../../src/falsification/adapters/profiles/codex';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';

/**
 * Unit tests for `CodexFalsifier` paths that do not require the real
 * codex binary. Spawning is replaced with `invocationOverride` and auth
 * detection with `authMethodOverride`. The integration test
 * (`codex-falsifier.integration.test.ts`) covers the real-CLI path.
 */

function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-codex-falsifier-unit-'));
}

function makeCandidateStdout(usageLine: string): string {
  // Codex prompt mandates exactly CODEX_CANDIDATE_COUNT=3 candidates; the
  // output parser rejects anything else.
  const candidates = Array.from({ length: 3 }, (_, i) => ({
    name: `c-${i}`,
    rationale: 'introduces forbidden token',
    files: [{ relPath: `c-${i}/leak.txt`, bytes: 'FORBIDDEN_TOKEN_UNIT' }],
  }));
  return [
    '```json',
    JSON.stringify({ candidates }),
    '```',
    usageLine,
  ].join('\n');
}

function smokeInput(workspaceRoot: string): FalsificationInput {
  return {
    patchSha: '0000000000000000000000000000000000000000',
    obligation: {
      type: 'property-must-hold',
      predicate: '! grep -r "FORBIDDEN_TOKEN_UNIT" . 2>/dev/null',
      target: 'no FORBIDDEN_TOKEN_UNIT in workspace',
    },
    contextRefs: [],
    timeBudgetMs: 5_000,
    workspaceRoot,
  };
}

describe('CodexFalsifier unit paths', () => {
  it('preserves full stderr on Error.cause when codex exits non-zero', async () => {
    const stderr4kb = 'X'.repeat(4096);
    const adapter = new CliFalsifier(codexProfile, {
      authMethodOverride: () => 'api',
      invocationOverride: async () => ({
        stdout: '',
        stderr: stderr4kb,
        exitCode: 7,
        wallClockMs: 10,
      }),
    });
    const ws = makeWorkspace();
    try {
      await adapter.falsify(smokeInput(ws));
      assert.fail('expected falsify() to throw');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.match(err.message, /codex exec failed with exit code 7/);
      assert.match(err.message, /…\[truncated\]/);
      const cause = (err as Error & { cause?: unknown }).cause as
        | { exitCode: number; stderr: string; stdout: string }
        | undefined;
      assert.ok(cause !== undefined, 'expected Error.cause to be populated');
      assert.equal(cause!.exitCode, 7);
      assert.equal(cause!.stderr.length, 4096);
      assert.equal(cause!.stderr, stderr4kb);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('returns baseline-predicate-failed without invoking codex when workspace is pre-tainted', async () => {
    let codexCalled = false;
    const adapter = new CliFalsifier(codexProfile, {
      authMethodOverride: () => 'api',
      invocationOverride: async () => {
        codexCalled = true;
        return { stdout: '', stderr: '', exitCode: 0, wallClockMs: 0 };
      },
    });
    const ws = makeWorkspace();
    try {
      // Plant the forbidden token so the baseline predicate fails.
      fs.writeFileSync(path.join(ws, 'tainted.txt'), 'FORBIDDEN_TOKEN_UNIT', 'utf8');
      const outcome = await adapter.falsify(smokeInput(ws));
      assert.equal(codexCalled, false, 'codex must not be invoked when baseline fails');
      assert.equal(outcome.result.kind, 'no-falsification-found');
      if (outcome.result.kind === 'no-falsification-found') {
        assert.equal(outcome.result.reason, 'baseline-predicate-failed');
        assert.equal(outcome.result.attempts, 0);
      }
      assert.equal(outcome.cost.dollarsBilled, 0);
      assert.equal(outcome.cost.dollarsTokenEstimate, 0);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('reports dollarsBilled=0 under chatgpt auth but populates dollarsTokenEstimate', async () => {
    const fakeStdout = makeCandidateStdout('tokens used: input=1000 output=2000 total=3000');
    const adapter = new CliFalsifier(codexProfile, {
      authMethodOverride: () => 'chatgpt',
      invocationOverride: async () => ({
        stdout: fakeStdout,
        stderr: 'model: o4-mini',
        exitCode: 0,
        wallClockMs: 50,
      }),
    });
    const ws = makeWorkspace();
    try {
      const outcome = await adapter.falsify(smokeInput(ws));
      assert.equal(outcome.cost.authMethod, 'chatgpt');
      assert.equal(outcome.cost.dollarsBilled, 0, 'flat-rate auth must not charge per-token');
      assert.ok(outcome.cost.dollarsTokenEstimate > 0, 'token estimate should still be computed');
      // Backward-compat alias.
      assert.equal(outcome.cost.dollarsSpent, outcome.cost.dollarsTokenEstimate);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('reports dollarsBilled === dollarsTokenEstimate under api auth', async () => {
    const fakeStdout = makeCandidateStdout('tokens used: input=500 output=1500 total=2000');
    const adapter = new CliFalsifier(codexProfile, {
      authMethodOverride: () => 'api',
      invocationOverride: async () => ({
        stdout: fakeStdout,
        stderr: 'model: o4-mini',
        exitCode: 0,
        wallClockMs: 50,
      }),
    });
    const ws = makeWorkspace();
    try {
      const outcome = await adapter.falsify(smokeInput(ws));
      assert.equal(outcome.cost.authMethod, 'api');
      assert.ok(outcome.cost.dollarsBilled > 0);
      assert.equal(outcome.cost.dollarsBilled, outcome.cost.dollarsTokenEstimate);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
