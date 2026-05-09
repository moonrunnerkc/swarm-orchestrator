import { strict as assert } from 'assert';
import { deriveResumeState, ResumeError, memoizedEntriesForResume } from '../../src/ledger/resume';
import type { FinalContract } from '../../src/contract/types';
import type {
  LedgerEntry,
  ObligationFailedEntry,
  ObligationSatisfiedEntry,
  RunStartedEntry,
} from '../../src/ledger/types';
import { finalize } from '../../src/contract/compiler';

function header(seq: number, runId = 'r1') {
  return {
    ts: '2026-05-08T00:00:00.000Z',
    runId,
    seq,
    prevHash: '0'.repeat(64),
    entryHash: 'a'.repeat(64),
  };
}

function buildContract(): FinalContract {
  return finalize({
    schemaVersion: 'v1',
    goal: 'g',
    repoContext: { repoRoot: '/r', buildCommand: 'true', testCommand: 'true', language: 'typescript' },
    obligations: [
      { type: 'file-must-exist', path: 'a.ts' },
      { type: 'file-must-exist', path: 'b.ts' },
      { type: 'file-must-exist', path: 'c.ts' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
      { type: 'file-must-exist', path: 'd.ts' },
    ],
    extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
  });
}

describe('ledger/resume', () => {
  describe('deriveResumeState', () => {
    it('throws ResumeError when no run-started matches', () => {
      const contract = buildContract();
      assert.throws(
        () => deriveResumeState([], contract),
        (err: unknown) => err instanceof ResumeError && err.code === 'no-run-started',
      );
    });

    it('returns empty satisfied set when prior run only got run-started', () => {
      const contract = buildContract();
      const entries: LedgerEntry[] = [
        {
          ...header(0, 'old'),
          type: 'run-started',
          contractId: contract.manifest.contractId,
          contractHash: contract.manifest.contractHash,
          obligationCount: contract.obligations.length,
          goal: 'g',
        } as RunStartedEntry,
      ];
      const state = deriveResumeState(entries, contract);
      assert.equal(state.satisfiedIndexes.size, 0);
      assert.equal(state.pendingIndexes.size, contract.obligations.length);
      assert.equal(state.resumeOf, 'old');
    });

    it('correctly identifies satisfied indexes for a partial 5-of-6 prior run', () => {
      const contract = buildContract();
      // prior run completed 5 obligations and was killed before the 6th.
      const entries: LedgerEntry[] = [
        {
          ...header(0, 'old'),
          type: 'run-started',
          contractId: contract.manifest.contractId,
          contractHash: contract.manifest.contractHash,
          obligationCount: contract.obligations.length,
          goal: 'g',
        } as RunStartedEntry,
        ...[0, 1, 2, 3, 4].map<LedgerEntry>((i, k) => ({
          ...header(k + 1, 'old'),
          type: 'obligation-satisfied',
          obligationIndex: i,
          obligationType: contract.obligations[i]!.type,
          detail: 'ok',
        }) as ObligationSatisfiedEntry),
      ];
      const state = deriveResumeState(entries, contract);
      assert.equal(state.satisfiedIndexes.size, 5);
      assert.deepEqual([...state.pendingIndexes], [5]);
      assert.equal(state.originalObligationCount, contract.obligations.length);
    });

    it('lists prior failures separately from satisfied', () => {
      const contract = buildContract();
      const entries: LedgerEntry[] = [
        {
          ...header(0, 'old'),
          type: 'run-started',
          contractId: contract.manifest.contractId,
          contractHash: contract.manifest.contractHash,
          obligationCount: contract.obligations.length,
          goal: 'g',
        } as RunStartedEntry,
        {
          ...header(1, 'old'),
          type: 'obligation-satisfied',
          obligationIndex: 0,
          obligationType: 'file-must-exist',
          detail: 'ok',
        } as ObligationSatisfiedEntry,
        {
          ...header(2, 'old'),
          type: 'obligation-failed',
          obligationIndex: 3,
          obligationType: 'build-must-pass',
          detail: 'build failed',
        } as ObligationFailedEntry,
      ];
      const state = deriveResumeState(entries, contract);
      assert.deepEqual([...state.satisfiedIndexes].sort(), [0]);
      assert.deepEqual([...state.failedIndexes].sort(), [3]);
      // Failed indexes still go in pending so resume retries them.
      assert.ok(state.pendingIndexes.has(3));
    });

    it('rejects empty contract obligations', () => {
      const contract: FinalContract = {
        manifest: {
          schemaVersion: 'v1',
          contractHash: 'h',
          contractId: 'h0000000',
          goal: 'g',
          repoContext: { repoRoot: '/r', buildCommand: null, testCommand: null, language: 'unknown' },
          extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
          createdAt: '2026-05-08T00:00:00.000Z',
        },
        obligations: [],
      };
      const entries: LedgerEntry[] = [
        {
          ...header(0, 'old'),
          type: 'run-started',
          contractId: 'h0000000',
          contractHash: 'h',
          obligationCount: 0,
          goal: 'g',
        } as RunStartedEntry,
      ];
      assert.throws(
        () => deriveResumeState(entries, contract),
        (err: unknown) => err instanceof ResumeError && err.code === 'no-obligations',
      );
    });
  });

  describe('memoizedEntriesForResume', () => {
    it('builds one entry per satisfied index with the canonical obligation key', () => {
      const contract = buildContract();
      const state = {
        resumeOf: 'old',
        contractId: contract.manifest.contractId,
        contractHash: contract.manifest.contractHash,
        satisfiedIndexes: new Set([0, 2]),
        failedIndexes: new Set<number>(),
        pendingIndexes: new Set([1, 3, 4, 5]),
        originalObligationCount: contract.obligations.length,
      };
      const out = memoizedEntriesForResume(state, contract);
      assert.equal(out.length, 2);
      const keys = out.map((e) => e.obligationKey).sort();
      assert.deepEqual(keys, ['file-must-exist|a.ts', 'file-must-exist|c.ts']);
      for (const e of out) {
        assert.equal(e.type, 'obligation-memoized');
        assert.equal(e.source, 'prior-run');
      }
    });
  });
});
