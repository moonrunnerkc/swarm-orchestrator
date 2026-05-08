import { strict as assert } from 'assert';
import {
  MemoStore,
  obligationKey,
  priorSatisfiedIndexes,
  priorFailedIndexes,
  hitFromMemoized,
} from '../../src/ledger/memoization';
import type {
  CandidateRecordedEntry,
  LedgerEntry,
  ObligationAttemptedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from '../../src/ledger/types';
import type { ObligationV1 } from '../../src/contract/types';
import { emptyUsage } from '../../src/session/types';

function header(seq: number, runId = 'r1') {
  return {
    ts: '2026-05-08T00:00:00.000Z',
    runId,
    seq,
    prevHash: '0'.repeat(64),
    entryHash: 'a'.repeat(64),
  };
}

describe('ledger/memoization', () => {
  describe('obligationKey', () => {
    it('keys file-must-exist by path', () => {
      assert.equal(
        obligationKey({ type: 'file-must-exist', path: 'src/x.ts' }),
        'file-must-exist|src/x.ts',
      );
    });
    it('keys build-must-pass by command', () => {
      assert.equal(
        obligationKey({ type: 'build-must-pass', command: 'npm run build' }),
        'build-must-pass|npm run build',
      );
    });
  });

  describe('MemoStore', () => {
    it('indexes tournament winners by hash and obligation type', () => {
      const entries: LedgerEntry[] = [
        { ...header(0), type: 'run-started', contractId: 'c', contractHash: 'h', obligationCount: 1, goal: 'g' } as RunStartedEntry,
        { ...header(1), type: 'tournament-round-started', obligationIndex: 0, obligationType: 'file-must-exist', roundIndex: 0, roundCap: 3, personaIds: ['architect'], temperatures: [0.2] } as TournamentRoundStartedEntry,
        { ...header(2), type: 'tournament-winner-selected', obligationIndex: 0, roundIndex: 0, candidateIndex: 0, personaId: 'architect', responseSha256: 'aaaa', score: 0.9, rationale: 'ok' } as TournamentWinnerSelectedEntry,
      ];
      const store = new MemoStore(entries);
      assert.equal(store.winnerCount(), 1);
      assert.equal(store.hashesIndexedCount(), 1);
      const hit = store.findPriorWinnerByHash(
        { type: 'file-must-exist', path: 'irrelevant' } as ObligationV1,
        'aaaa',
      );
      assert.ok(hit);
      assert.equal(hit?.source, 'prior-winner');
    });

    it('returns null when hash is unknown', () => {
      const store = new MemoStore([]);
      const hit = store.findPriorWinnerByHash(
        { type: 'file-must-exist', path: 'x' } as ObligationV1,
        'unknown',
      );
      assert.equal(hit, null);
    });

    it('returns null when hash matches but obligation type differs', () => {
      const entries: LedgerEntry[] = [
        { ...header(0), type: 'tournament-round-started', obligationIndex: 0, obligationType: 'build-must-pass', roundIndex: 0, roundCap: 3, personaIds: ['implementer'], temperatures: [0.2] } as TournamentRoundStartedEntry,
        { ...header(1), type: 'tournament-winner-selected', obligationIndex: 0, roundIndex: 0, candidateIndex: 0, personaId: 'implementer', responseSha256: 'aaaa', score: 0.9, rationale: 'ok' } as TournamentWinnerSelectedEntry,
      ];
      const store = new MemoStore(entries);
      const hit = store.findPriorWinnerByHash(
        { type: 'file-must-exist', path: 'x' } as ObligationV1,
        'aaaa',
      );
      assert.equal(hit, null);
    });

    it('ingestWinner adds to the index incrementally', () => {
      const store = new MemoStore([]);
      store.ingestWinner(
        {
          ...header(0),
          type: 'tournament-winner-selected',
          obligationIndex: 0,
          roundIndex: 0,
          candidateIndex: 0,
          personaId: 'architect',
          responseSha256: 'bbbb',
          score: 0.9,
          rationale: 'ok',
        } as TournamentWinnerSelectedEntry,
        'file-must-exist',
      );
      const hit = store.findPriorWinnerByHash(
        { type: 'file-must-exist', path: 'y' } as ObligationV1,
        'bbbb',
      );
      assert.ok(hit);
    });
  });

  describe('priorSatisfiedIndexes', () => {
    it('returns indexes satisfied by runs with matching contractHash', () => {
      const entries: LedgerEntry[] = [
        { ...header(0, 'old'), type: 'run-started', contractId: 'c', contractHash: 'H', obligationCount: 3, goal: 'g' } as RunStartedEntry,
        { ...header(1, 'old'), type: 'obligation-satisfied', obligationIndex: 0, obligationType: 'file-must-exist', detail: 'ok' } as ObligationSatisfiedEntry,
        { ...header(2, 'old'), type: 'obligation-satisfied', obligationIndex: 2, obligationType: 'test-must-pass', detail: 'ok' } as ObligationSatisfiedEntry,
        { ...header(3, 'old'), type: 'run-finished', satisfied: 2, failed: 0, totalUsage: emptyUsage() } as RunFinishedEntry,
      ];
      const set = priorSatisfiedIndexes(entries, 'H');
      assert.deepEqual([...set].sort(), [0, 2]);
    });

    it('skips runs with non-matching contractHash', () => {
      const entries: LedgerEntry[] = [
        { ...header(0, 'old'), type: 'run-started', contractId: 'c', contractHash: 'OTHER', obligationCount: 3, goal: 'g' } as RunStartedEntry,
        { ...header(1, 'old'), type: 'obligation-satisfied', obligationIndex: 0, obligationType: 'file-must-exist', detail: 'ok' } as ObligationSatisfiedEntry,
      ];
      const set = priorSatisfiedIndexes(entries, 'H');
      assert.equal(set.size, 0);
    });

    it('treats failed-then-satisfied as satisfied (last status wins)', () => {
      const entries: LedgerEntry[] = [
        { ...header(0, 'old'), type: 'run-started', contractId: 'c', contractHash: 'H', obligationCount: 1, goal: 'g' } as RunStartedEntry,
        { ...header(1, 'old'), type: 'obligation-failed', obligationIndex: 0, obligationType: 'build-must-pass', detail: 'err' } as ObligationFailedEntry,
        { ...header(2, 'old'), type: 'obligation-satisfied', obligationIndex: 0, obligationType: 'build-must-pass', detail: 'ok' } as ObligationSatisfiedEntry,
      ];
      const sat = priorSatisfiedIndexes(entries, 'H');
      assert.ok(sat.has(0));
      const failed = priorFailedIndexes(entries, 'H');
      assert.ok(!failed.has(0));
    });

    it('honours excludeRunId so the resuming run does not double-count itself', () => {
      const entries: LedgerEntry[] = [
        { ...header(0, 'self'), type: 'run-started', contractId: 'c', contractHash: 'H', obligationCount: 1, goal: 'g' } as RunStartedEntry,
        { ...header(1, 'self'), type: 'obligation-satisfied', obligationIndex: 0, obligationType: 'file-must-exist', detail: 'ok' } as ObligationSatisfiedEntry,
      ];
      const set = priorSatisfiedIndexes(entries, 'H', { excludeRunId: 'self' });
      assert.equal(set.size, 0);
    });

    it('honors obligation-memoized as satisfied', () => {
      const entries: LedgerEntry[] = [
        { ...header(0, 'old'), type: 'run-started', contractId: 'c', contractHash: 'H', obligationCount: 1, goal: 'g' } as RunStartedEntry,
        { ...header(1, 'old'), type: 'obligation-memoized', obligationIndex: 0, obligationType: 'file-must-exist', obligationKey: 'file-must-exist|x', source: 'prior-run', responseSha256: null, detail: 'memo' } as ObligationMemoizedEntry,
      ];
      const set = priorSatisfiedIndexes(entries, 'H');
      assert.ok(set.has(0));
    });
  });

  describe('hitFromMemoized', () => {
    it('round-trips a memoized entry to a hit', () => {
      const entry: ObligationMemoizedEntry = {
        ...header(0),
        type: 'obligation-memoized',
        obligationIndex: 0,
        obligationType: 'file-must-exist',
        obligationKey: 'file-must-exist|x',
        source: 'prior-run',
        responseSha256: 'aaaa',
        detail: 'd',
      };
      const hit = hitFromMemoized(entry);
      assert.equal(hit.source, 'prior-run');
      assert.equal(hit.responseSha256, 'aaaa');
      assert.equal(hit.detail, 'd');
    });
  });

  describe('MemoStore + obligation-attempted', () => {
    it('ignores obligation-attempted when no winner follows', () => {
      const entries: LedgerEntry[] = [
        { ...header(0), type: 'obligation-attempted', obligationIndex: 0, obligationType: 'file-must-exist', personaId: 'architect' } as ObligationAttemptedEntry,
        { ...header(1), type: 'candidate-recorded', obligationIndex: 0, personaId: 'architect', responseSha256: 'cccc', usage: emptyUsage(), model: 'm' } as CandidateRecordedEntry,
      ];
      const store = new MemoStore(entries);
      assert.equal(store.winnerCount(), 0);
    });
  });
});
