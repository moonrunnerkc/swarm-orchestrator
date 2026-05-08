import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleRun } from '../../src/cli/v8/run-handler';
import { StubSession } from '../../src/session/stub-session';
import { readEntries } from '../../src/ledger/jsonl-ledger';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-tour-int-'));
}

interface TournamentResultFile {
  mode: 'single' | 'tournament';
  satisfied: number;
  failed: number;
  outcomes: Array<{
    type: string;
    satisfied: boolean;
    tournament: {
      rounds: number;
      escalated: boolean;
      bestScore: number;
      winner: { roundIndex: number; candidateIndex: number; personaId: string } | null;
    } | null;
  }>;
}

describe('integration: swarm v8 run --mode tournament', () => {
  it('runs tournaments end-to-end and writes evidence files', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({ name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } }, null, 2),
    );
    fs.writeFileSync(path.join(work, 'tsconfig.json'), '{}');
    const contractDir = path.join(work, 'contract');

    await handleCompile([
      'add a CHANGES.md note',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);

    const resultPath = path.join(work, 'result.json');
    const ledgerPath = path.join(work, 'ledger.jsonl');
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        if (req.personaId === 'tournament-verifier') {
          // Score every candidate equally above threshold; first wins.
          return JSON.stringify({ score: 0.9, rationale: 'looks good' });
        }
        if (req.personaId === 'architect') return '```\nfile body\n```';
        return 'no-op';
      },
    });

    const exit = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--session', 'stub',
        '--ledger', ledgerPath,
        '--result', resultPath,
        '--run-id', 'fixed-tour-id',
        '--mode', 'tournament',
        '--candidates', '2',
      ],
      { session },
    );
    assert.equal(exit, 0);

    const result: TournamentResultFile = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.mode, 'tournament');
    assert.equal(result.satisfied, 3);
    // Every outcome carries a tournament evidence object.
    for (const o of result.outcomes) {
      assert.ok(o.tournament, `${o.type} carries tournament evidence`);
      assert.equal(o.tournament?.escalated, false);
      assert.ok((o.tournament?.rounds ?? 0) >= 1);
    }

    // Ledger contains tournament-specific entry types.
    const entries = readEntries(ledgerPath);
    const types = new Set(entries.map((e) => e.type));
    assert.ok(types.has('tournament-round-started'));
    assert.ok(types.has('tournament-winner-selected'));
    assert.ok(types.has('candidate-discarded'));
  });

  it('rejects an invalid --mode value', async () => {
    const work = tmpDir();
    const contractDir = path.join(work, 'contract');
    await handleCompile([
      'g',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);
    const exit = await handleRun([contractDir, '--mode', 'bogus']);
    assert.equal(exit, 1);
  });

  it('rejects --candidates out of range', async () => {
    const work = tmpDir();
    const contractDir = path.join(work, 'contract');
    await handleCompile([
      'g',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);
    const exit = await handleRun([contractDir, '--candidates', '99']);
    assert.equal(exit, 1);
  });
});
