import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CopilotFalsifier } from '../../../../src/falsification/adapters/copilot/copilot-falsifier';
import type { FalsificationInput } from '../../../../src/falsification/adapters/types';
import {
  TRANSIENT_API_ERROR_PATTERN,
  TransientApiRetryExhaustedError,
  invokeWithTransientRetry,
  isTransientApiError,
} from '../../../../src/copilot-transient-retry';

/**
 * Drives the retry path for the Copilot CLI's transient-API-error
 * marker. The unit cases hit `invokeWithTransientRetry` directly with
 * deterministic invokers; the integration cases drive the same path
 * through `CopilotFalsifier.falsify()` via the `invocationOverride`
 * test seam, which is how the orchestrator exercises the wrapper at
 * runtime.
 */

const TRANSIENT_STDOUT =
  'Request failed due to a transient API error. Retrying...\n';
const TRANSIENT_STDERR =
  'something failed\nRequest failed due to a transient API error. Retrying...\n';

// The Copilot parser requires exactly 3 candidates. Use three innocent
// (non-falsifying) entries so the test reaches `no-falsification-found`
// — the integration test only needs the retry path to deliver a parseable
// response, not to confirm a counter-example.
const SUCCESS_CANDIDATES = [
  { name: 'a', rationale: 'innocent', files: [{ relPath: 'lib/x1.ts', bytes: 'export const x1 = 1;\n' }] },
  { name: 'b', rationale: 'innocent', files: [{ relPath: 'lib/x2.ts', bytes: 'export const x2 = 2;\n' }] },
  { name: 'c', rationale: 'innocent', files: [{ relPath: 'lib/x3.ts', bytes: 'export const x3 = 3;\n' }] },
];
const SUCCESS_STDOUT =
  ['```json', JSON.stringify({ candidates: SUCCESS_CANDIDATES }), '```'].join('\n') +
  '\nRequests 1 Premium (5s)\n';

function transientResult(channel: 'stdout' | 'stderr' = 'stderr') {
  return {
    stdout: channel === 'stdout' ? TRANSIENT_STDOUT : '',
    stderr: channel === 'stderr' ? TRANSIENT_STDERR : '',
    exitCode: 1,
    wallClockMs: 50,
  };
}

function successResult() {
  return {
    stdout: SUCCESS_STDOUT,
    stderr: '',
    exitCode: 0,
    wallClockMs: 50,
  };
}

describe('isTransientApiError', () => {
  it('matches the marker in stdout when exit code is non-zero', () => {
    assert.equal(isTransientApiError(transientResult('stdout')), true);
  });

  it('matches the marker in stderr when exit code is non-zero', () => {
    assert.equal(isTransientApiError(transientResult('stderr')), true);
  });

  it('returns false when exit code is 0 even if the marker is in the output', () => {
    // Defensive: some prompts include the literal phrase in their text
    // and the CLI exits cleanly. A clean exit is authoritative.
    assert.equal(
      isTransientApiError({
        stdout: TRANSIENT_STDOUT,
        stderr: '',
        exitCode: 0,
      }),
      false,
    );
  });

  it('returns false when the marker is absent and exit code is non-zero', () => {
    assert.equal(
      isTransientApiError({
        stdout: '',
        stderr: 'auth: bad token',
        exitCode: 2,
      }),
      false,
    );
  });

  it('matches a four-dot variant of the marker', () => {
    // Belt-and-suspenders: regex tolerates 1+ trailing dots.
    assert.match(
      'Request failed due to a transient API error. Retrying....',
      TRANSIENT_API_ERROR_PATTERN,
    );
  });
});

describe('invokeWithTransientRetry', () => {
  it('retries when attempt 1 is transient and returns the attempt-2 success', async () => {
    let n = 0;
    const result = await invokeWithTransientRetry(
      async () => {
        n += 1;
        return n === 1 ? transientResult('stderr') : successResult();
      },
      { maxAttempts: 3 },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(n, 2, 'invoker was called exactly twice');
  });

  it('throws TransientApiRetryExhaustedError after maxAttempts consecutive transients', async () => {
    let n = 0;
    await assert.rejects(
      invokeWithTransientRetry(
        async () => {
          n += 1;
          return transientResult('stderr');
        },
        { maxAttempts: 3 },
      ),
      (err: Error) => {
        assert.ok(err instanceof TransientApiRetryExhaustedError);
        assert.match(err.message, /3 attempts/);
        assert.match(err.message, /transient API error/);
        return true;
      },
    );
    assert.equal(n, 3, 'invoker was called maxAttempts times');
  });

  it('fires onAttempt for every attempt including transient ones', async () => {
    const events: Array<{ attempt: number; exitCode: number }> = [];
    let n = 0;
    await invokeWithTransientRetry(
      async () => {
        n += 1;
        return n < 3 ? transientResult('stderr') : successResult();
      },
      {
        maxAttempts: 3,
        onAttempt: (result, attempt) => events.push({ attempt, exitCode: result.exitCode }),
      },
    );
    assert.deepEqual(
      events,
      [
        { attempt: 1, exitCode: 1 },
        { attempt: 2, exitCode: 1 },
        { attempt: 3, exitCode: 0 },
      ],
      'onAttempt observed every spawn',
    );
  });

  it('rejects a non-positive maxAttempts immediately', async () => {
    await assert.rejects(
      invokeWithTransientRetry(async () => successResult(), { maxAttempts: 0 }),
      /maxAttempts must be a positive integer/,
    );
  });

  it('returns the first success without retry when attempt 1 already succeeds', async () => {
    let n = 0;
    const result = await invokeWithTransientRetry(
      async () => {
        n += 1;
        return successResult();
      },
      { maxAttempts: 3 },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(n, 1, 'no retry when the first attempt is clean');
  });
});

/**
 * Integration: drives the same retry path through `CopilotFalsifier`
 * using the `invocationOverride` test seam. Sets up a baseline-clean
 * fixture so the falsifier proceeds past the baseline-predicate gate
 * and actually reaches the runCopilot wrapper.
 */
function makeWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-copilot-transient-retry-'));
}

function setupNoUpwardImportsScope(workspaceRoot: string): void {
  const scope = path.join(workspaceRoot, 'lib');
  fs.mkdirSync(scope, { recursive: true });
  fs.writeFileSync(path.join(scope, 'a.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(workspaceRoot, 'sibling.ts'), 'export const s = 2;\n', 'utf8');
}

function noUpwardImportsInput(workspaceRoot: string): FalsificationInput {
  return {
    patchSha: '0'.repeat(40),
    obligation: {
      type: 'import-graph-must-satisfy',
      constraint: 'no-upward-imports',
      scope: 'lib',
    },
    contextRefs: [],
    timeBudgetMs: 5_000,
    workspaceRoot,
  };
}

describe('CopilotFalsifier transient-retry integration', () => {
  it('retries the spawn when the CLI emits the transient marker and proceeds with the recovered output', async () => {
    let calls = 0;
    const adapter = new CopilotFalsifier({
      authMethodOverride: () => 'chatgpt',
      premiumRequestsOverride: () => null,
      invocationOverride: async () => {
        calls += 1;
        if (calls === 1) {
          return transientResult('stderr');
        }
        return successResult();
      },
    });
    const ws = makeWorkspace();
    try {
      setupNoUpwardImportsScope(ws);
      const outcome = await adapter.falsify(noUpwardImportsInput(ws));
      // Empty candidate list → no-falsification-found, but the call
      // completed successfully — proving the retry path delivered a
      // valid result through the rest of the pipeline.
      assert.equal(outcome.result.kind, 'no-falsification-found');
      assert.equal(calls, 2, 'spawn re-invoked exactly once after the transient marker');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('surfaces TransientApiRetryExhaustedError when every attempt was transient', async () => {
    let calls = 0;
    const adapter = new CopilotFalsifier({
      authMethodOverride: () => 'chatgpt',
      premiumRequestsOverride: () => null,
      invocationOverride: async () => {
        calls += 1;
        return transientResult('stderr');
      },
    });
    const ws = makeWorkspace();
    try {
      setupNoUpwardImportsScope(ws);
      await assert.rejects(
        adapter.falsify(noUpwardImportsInput(ws)),
        (err: Error) => {
          assert.ok(
            err instanceof TransientApiRetryExhaustedError,
            `expected TransientApiRetryExhaustedError, got ${err.constructor.name}: ${err.message}`,
          );
          assert.match(err.message, /3 attempts/);
          return true;
        },
      );
      assert.equal(calls, 3, 'spawn was attempted exactly maxAttempts times');
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('fires onInvocation observability hook on every attempt including transient ones', async () => {
    const captured: Array<{ exitCode: number }> = [];
    let calls = 0;
    const adapter = new CopilotFalsifier({
      authMethodOverride: () => 'chatgpt',
      premiumRequestsOverride: () => null,
      invocationOverride: async () => {
        calls += 1;
        return calls < 2 ? transientResult('stderr') : successResult();
      },
      onInvocation: (_req, res) => captured.push({ exitCode: res.exitCode }),
    });
    const ws = makeWorkspace();
    try {
      setupNoUpwardImportsScope(ws);
      await adapter.falsify(noUpwardImportsInput(ws));
      assert.deepEqual(
        captured,
        [{ exitCode: 1 }, { exitCode: 0 }],
        'every real spawn went through onInvocation — transient errors stay in the transcript',
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});
