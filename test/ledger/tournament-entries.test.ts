import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import type {
  CandidateDiscardedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from '../../src/ledger/types';
import { emptyUsage } from '../../src/session/types';

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-tour-'));
  return path.join(dir, 'ledger.jsonl');
}

describe('ledger — Phase 3 tournament entry types', () => {
  it('round-trips tournament-round-started entries', () => {
    const file = tmpFile();
    const led = new JsonlLedger(file, 'rT');
    led.append<TournamentRoundStartedEntry>({
      type: 'tournament-round-started',
      obligationIndex: 1,
      obligationType: 'file-must-exist',
      roundIndex: 0,
      roundCap: 3,
      personaIds: ['architect', 'implementer'],
      temperatures: [0.2, 0.5],
    });
    const entries = readEntries(file);
    assert.equal(entries.length, 1);
    const e = entries[0] as TournamentRoundStartedEntry;
    assert.equal(e.type, 'tournament-round-started');
    assert.deepEqual(e.personaIds, ['architect', 'implementer']);
    assert.deepEqual(e.temperatures, [0.2, 0.5]);
    assert.equal(e.roundCap, 3);
  });

  it('round-trips candidate-discarded with usage and rationale', () => {
    const file = tmpFile();
    const led = new JsonlLedger(file, 'rT');
    led.append<CandidateDiscardedEntry>({
      type: 'candidate-discarded',
      obligationIndex: 0,
      roundIndex: 0,
      candidateIndex: 1,
      personaId: 'architect',
      responseSha256: 'abc',
      score: 0.4,
      rationale: 'too short',
      usage: { ...emptyUsage(), outputTokens: 5 },
      model: 'haiku-x',
    });
    const e = readEntries(file)[0] as CandidateDiscardedEntry;
    assert.equal(e.type, 'candidate-discarded');
    assert.equal(e.score, 0.4);
    assert.equal(e.rationale, 'too short');
    assert.equal(e.usage.outputTokens, 5);
    assert.equal(e.model, 'haiku-x');
  });

  it('round-trips tournament-winner-selected', () => {
    const file = tmpFile();
    const led = new JsonlLedger(file, 'rT');
    led.append<TournamentWinnerSelectedEntry>({
      type: 'tournament-winner-selected',
      obligationIndex: 0,
      roundIndex: 1,
      candidateIndex: 0,
      personaId: 'implementer',
      responseSha256: 'deadbeef',
      score: 0.9,
      rationale: 'looks good',
    });
    const e = readEntries(file)[0] as TournamentWinnerSelectedEntry;
    assert.equal(e.type, 'tournament-winner-selected');
    assert.equal(e.personaId, 'implementer');
    assert.equal(e.roundIndex, 1);
    assert.equal(e.score, 0.9);
  });

  it('round-trips tournament-escalated', () => {
    const file = tmpFile();
    const led = new JsonlLedger(file, 'rT');
    led.append<TournamentEscalatedEntry>({
      type: 'tournament-escalated',
      obligationIndex: 2,
      obligationType: 'build-must-pass',
      roundsRun: 3,
      bestScore: 0.4,
      detail: 'all candidates fell short',
    });
    const e = readEntries(file)[0] as TournamentEscalatedEntry;
    assert.equal(e.type, 'tournament-escalated');
    assert.equal(e.roundsRun, 3);
    assert.equal(e.bestScore, 0.4);
  });
});
