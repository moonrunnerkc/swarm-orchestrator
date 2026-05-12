import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import type {
  FalsificationCallEntry,
  ObligationAttemptedEntry,
  ObligationRolledBackEntry,
  RunFinishedEntry,
  RunStartedEntry,
  TournamentRoundStartedEntry,
  WorkspaceSnapshotEntry,
} from '../../src/ledger/types';
import { handleStats } from '../../src/cli/v8/stats-handler';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function captureStdout<T>(fn: () => Promise<T>): Promise<{ result: T; stdout: string }> {
  const chunks: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  (process.stdout.write as unknown) = (s: string | Uint8Array): boolean => {
    chunks.push(typeof s === 'string' ? s : Buffer.from(s).toString('utf8'));
    return true;
  };
  return fn()
    .then((result) => ({ result, stdout: chunks.join('') }))
    .finally(() => {
      (process.stdout.write as unknown) = orig;
    });
}

describe('cli/v8 stats-handler', () => {
  it('aggregates rollback, falsification, and file-touch counts from a ledger', async () => {
    const repo = tmpDir('v8-stats-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-stats-1');
    ledger.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c1',
      contractHash: 'h1',
      obligationCount: 3,
      goal: 'g',
    });
    ledger.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex: 0,
      obligationType: 'file-must-exist',
      personaId: 'architect',
    });
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 0,
      files: [{ path: 'a.ts', preBlobSha: 'sha1', expectedPostBlobSha: 'sha2' }],
    });
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex: 0,
      obligationType: 'file-must-exist',
      adapterName: 'fake',
      resultKind: 'counter-example-input',
      counterExamplesFound: 1,
      wallClockMs: 1,
      dollarsBilled: 0,
      dollarsApiEquivalent: 0,
      detail: 'x',
    });
    ledger.append<ObligationRolledBackEntry>({
      type: 'obligation-rolled-back',
      obligationIndex: 0,
      trigger: 'per-obligation-falsification',
      success: true,
      restoredFiles: [{ path: 'a.ts', restoredBlobSha: 'sha1' }],
      detail: 'rolled back 1 file(s)',
    });
    ledger.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex: 1,
      obligationType: 'build-must-pass',
      personaId: 'implementer',
    });
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex: 1,
      files: [{ path: 'b.ts', preBlobSha: 'sha3', expectedPostBlobSha: 'sha4' }],
    });
    ledger.append<ObligationRolledBackEntry>({
      type: 'obligation-rolled-back',
      obligationIndex: 1,
      trigger: 'post-merge-regression',
      success: true,
      restoredFiles: [{ path: 'b.ts', restoredBlobSha: 'sha3' }],
      detail: 'rolled back 1 file(s)',
    });
    ledger.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 1,
      totalUsage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });

    const { result, stdout } = await captureStdout(() =>
      handleStats(['run-stats-1', '--ledger', path.join(repo, 'ledger.jsonl'), '--json']),
    );
    assert.equal(result, 0);
    const parsed = JSON.parse(stdout) as {
      mode: string;
      rollbackCount: number;
      rollbackByTrigger: Record<string, number>;
      rollbackByObligationType: Record<string, number>;
      falsificationCount: number;
      falsificationByAdapter: Record<string, number>;
      falsificationByObligationType: Record<string, number>;
      topFiles: Array<[string, number]>;
    };
    assert.equal(parsed.mode, 'single');
    assert.equal(parsed.rollbackCount, 2);
    assert.equal(parsed.rollbackByTrigger['per-obligation-falsification'], 1);
    assert.equal(parsed.rollbackByTrigger['post-merge-regression'], 1);
    assert.equal(parsed.rollbackByObligationType['file-must-exist'], 1);
    assert.equal(parsed.rollbackByObligationType['build-must-pass'], 1);
    assert.equal(parsed.falsificationCount, 1);
    assert.equal(parsed.falsificationByAdapter['fake'], 1);
    assert.equal(parsed.falsificationByObligationType['file-must-exist'], 1);
    const fileNames = parsed.topFiles.map(([p]) => p).sort();
    assert.deepEqual(fileNames, ['a.ts', 'b.ts']);
  });

  it('plain output reflects rollback counts visibly to operators', async () => {
    const repo = tmpDir('v8-stats-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-stats-plain');
    ledger.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c1',
      contractHash: 'h1',
      obligationCount: 1,
      goal: 'g',
    });
    ledger.append<ObligationRolledBackEntry>({
      type: 'obligation-rolled-back',
      obligationIndex: 0,
      trigger: 'per-obligation-falsification',
      success: true,
      restoredFiles: [],
      detail: 'r',
    });
    ledger.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 0,
      failed: 1,
      totalUsage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });
    const { result, stdout } = await captureStdout(() =>
      handleStats(['run-stats-plain', '--ledger', path.join(repo, 'ledger.jsonl')]),
    );
    assert.equal(result, 0);
    assert.match(stdout, /Rollbacks: 1/);
    assert.match(stdout, /per-obligation-falsification: 1/);
  });

  it('infers tournament mode from tournament-round-started entries', async () => {
    const repo = tmpDir('v8-stats-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-stats-tourn');
    ledger.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c1',
      contractHash: 'h1',
      obligationCount: 1,
      goal: 'g',
    });
    ledger.append<TournamentRoundStartedEntry>({
      type: 'tournament-round-started',
      obligationIndex: 0,
      obligationType: 'build-must-pass',
      roundIndex: 0,
      roundCap: 3,
      personaIds: ['implementer'],
      temperatures: [0.2],
    });
    ledger.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 0,
      totalUsage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });
    const { stdout } = await captureStdout(() =>
      handleStats(['run-stats-tourn', '--ledger', path.join(repo, 'ledger.jsonl'), '--json']),
    );
    const parsed = JSON.parse(stdout) as { mode: string };
    assert.equal(parsed.mode, 'tournament');
  });

  it('breaks out falsification attempts vs counter-examples vs dispatcher-errors', async () => {
    const repo = tmpDir('v8-stats-falsify-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-stats-falsify');
    ledger.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c1',
      contractHash: 'h1',
      obligationCount: 1,
      goal: 'g',
    });
    ledger.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex: 0,
      obligationType: 'property-must-hold',
      personaId: 'security-reviewer',
    });
    // 1 successful counter-example from codex
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex: 0,
      obligationType: 'property-must-hold',
      adapterName: 'codex',
      resultKind: 'counter-example-input',
      counterExamplesFound: 1,
      wallClockMs: 100,
      dollarsBilled: 0,
      dollarsApiEquivalent: 0,
      detail: 'found',
    });
    // 2 dispatcher errors from codex
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex: 0,
      obligationType: 'property-must-hold',
      adapterName: 'codex',
      resultKind: 'dispatcher-error',
      counterExamplesFound: 0,
      wallClockMs: 0,
      dollarsBilled: 0,
      dollarsApiEquivalent: 0,
      detail: 'binary not found',
    });
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex: 0,
      obligationType: 'property-must-hold',
      adapterName: 'codex',
      resultKind: 'dispatcher-error',
      counterExamplesFound: 0,
      wallClockMs: 0,
      dollarsBilled: 0,
      dollarsApiEquivalent: 0,
      detail: 'binary not found',
    });
    ledger.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 0,
      totalUsage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });

    const { stdout } = await captureStdout(() =>
      handleStats(['run-stats-falsify', '--ledger', path.join(repo, 'ledger.jsonl')]),
    );
    // Plain-text output should distinguish attempted from counter-examples
    // from dispatcher-errors and surface the warning.
    assert.match(stdout, /attempted:\s*3/);
    assert.match(stdout, /counter-examples:\s*1/);
    assert.match(stdout, /dispatcher-errors:\s*2/);
    assert.match(stdout, /WARNING:.*falsifier dispatch.*failed/);
    assert.match(stdout, /codex:.*counter-examples=1.*errors=2/);
  });

  it('reports zero rollbacks for an empty ledger', async () => {
    const repo = tmpDir('v8-stats-');
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-stats-2');
    ledger.append<RunStartedEntry>({
      type: 'run-started',
      contractId: 'c2',
      contractHash: 'h2',
      obligationCount: 1,
      goal: 'g',
    });
    ledger.append<RunFinishedEntry>({
      type: 'run-finished',
      satisfied: 1,
      failed: 0,
      totalUsage: {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
      },
    });

    const { result, stdout } = await captureStdout(() =>
      handleStats(['run-stats-2', '--ledger', path.join(repo, 'ledger.jsonl'), '--json']),
    );
    assert.equal(result, 0);
    const parsed = JSON.parse(stdout) as { rollbackCount: number };
    assert.equal(parsed.rollbackCount, 0);
  });
});
