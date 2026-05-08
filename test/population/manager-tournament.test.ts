import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract } from '../../src/contract/types';
import type { SessionRequest } from '../../src/session/types';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeContract(repoRoot: string, filePath: string): FinalContract {
  return finalize({
    schemaVersion: 'v1',
    goal: 'add a thing',
    repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
    obligations: [
      { type: 'file-must-exist', path: filePath },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ],
    extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
  });
}

function buildSession(): StubSession {
  return new StubSession({
    projectContext: 'CTX',
    responder: (req: SessionRequest) => {
      if (req.personaId === 'tournament-verifier') {
        // Score every candidate equally above threshold so the first one
        // wins deterministically.
        return JSON.stringify({ score: 0.85, rationale: 'looks good' });
      }
      if (req.personaId === 'architect') {
        return '```\nfile body\n```';
      }
      return 'no-op';
    },
  });
}

describe('population/manager — tournament mode', () => {
  it('runs a tournament for every obligation and reports satisfied', async () => {
    const repo = tmpDir('v8-mgrT-');
    const contract = makeContract(repo, 'CHANGES.md');
    const session = buildSession();
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'rT');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
    });

    assert.equal(result.mode, 'tournament');
    assert.equal(result.satisfied, 3);
    assert.equal(result.failed, 0);
    // Every outcome must have a tournament evidence object.
    for (const o of result.outcomes) {
      assert.ok(o.tournament, `obligation ${o.obligationIndex} has tournament evidence`);
      assert.equal(o.tournament?.escalated, false);
      assert.ok((o.tournament?.rounds.length ?? 0) >= 1);
    }
    // Ledger contains tournament-specific entries.
    const entries = readEntries(path.join(repo, 'ledger.jsonl'));
    const types = entries.map((e) => e.type);
    assert.ok(types.includes('tournament-round-started'), 'tournament-round-started present');
    assert.ok(types.includes('tournament-winner-selected'), 'tournament-winner-selected present');
  });

  it('marks obligations failed when tournament escalates', async () => {
    const repo = tmpDir('v8-mgrT-');
    const contract = makeContract(repo, 'CHANGES.md');
    // All candidates score below threshold ⇒ escalation.
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        if (req.personaId === 'tournament-verifier') {
          return JSON.stringify({ score: 0.1, rationale: 'never good' });
        }
        return req.personaId === 'architect' ? '```\nx\n```' : 'no-op';
      },
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'rT');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
    });

    // file-must-exist escalates because no candidate scored above threshold,
    // so the file is never written and the obligation remains unsatisfied.
    const fileOutcome = result.outcomes.find((o) => o.obligation.type === 'file-must-exist');
    assert.ok(fileOutcome);
    assert.equal(fileOutcome?.satisfied, false);
    assert.equal(fileOutcome?.tournament?.escalated, true);

    const entries = readEntries(path.join(repo, 'ledger.jsonl'));
    assert.ok(entries.some((e) => e.type === 'tournament-escalated'));
  });

  it('records both winner and losers for cost attribution', async () => {
    const repo = tmpDir('v8-mgrT-');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: repo, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'a.txt' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    let callCount = 0;
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        if (req.personaId === 'tournament-verifier') {
          // Alternate scores so one beats the other.
          callCount += 1;
          const score = callCount % 2 === 0 ? 0.9 : 0.5;
          return JSON.stringify({ score, rationale: `r${callCount}` });
        }
        return '```\ncontent\n```';
      },
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'rT');
    await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
      tournamentConfig: {
        'file-must-exist': {
          candidatesPerRound: 2,
          roundCap: 3,
          scoreThreshold: 0.5,
          temperatureSchedule: [0.2],
        },
      },
    });
    const entries = readEntries(path.join(repo, 'ledger.jsonl'));
    const winners = entries.filter((e) => e.type === 'tournament-winner-selected');
    const discards = entries.filter((e) => e.type === 'candidate-discarded');
    // Three obligations × one winner each = three winners.
    assert.equal(winners.length, 3, 'one winner per obligation');
    // For the file-must-exist tournament we forced a 2-candidate round, so
    // at least one loser was discarded.
    assert.ok(discards.length >= 1, 'at least one loser discarded');
    // Discard records carry usage data.
    const d = discards[0] as unknown as { usage: { outputTokens: number } };
    assert.ok(d.usage.outputTokens > 0);
  });

  it('honors a custom tournamentConfig override', async () => {
    const repo = tmpDir('v8-mgrT-');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: repo, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'a.txt' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const session = buildSession();
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'rT');
    await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
      tournamentConfig: {
        'file-must-exist': {
          candidatesPerRound: 4,
          roundCap: 3,
          scoreThreshold: 0.5,
          temperatureSchedule: [0.3],
        },
      },
    });
    const entries = readEntries(path.join(repo, 'ledger.jsonl'));
    const round0 = entries.find(
      (e) => e.type === 'tournament-round-started',
    ) as unknown as { personaIds: string[] } | undefined;
    assert.ok(round0);
    assert.equal(round0?.personaIds.length, 4);
  });
});
