import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { MemoStore } from '../../src/ledger/memoization';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-memo-int-'));
}

describe('integration: in-run memoization measurably reduces verifier calls', () => {
  it('saves verifier calls on a goal with repeated patterns (4 health-check files)', async () => {
    const repoRoot = tmpDir();

    // Build a 4-file-must-exist contract — the canonical "add health
    // checks to N services" repeated-pattern goal from impl guide §7.
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'add health checks to 4 services',
      repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'src/svc-a/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-b/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-c/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-d/health.ts' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });

    // Architect responds with the same body for every file-must-exist
    // obligation — the natural shape for "repeated patterns." Tournament
    // verifier returns a passing score.
    const responder = (req: { personaId: string }) => {
      if (req.personaId === 'tournament-verifier') {
        return JSON.stringify({ score: 0.9, rationale: 'looks good' });
      }
      if (req.personaId === 'architect') {
        return '```\nexport function healthCheck() { return 200; }\n```';
      }
      return 'no-op';
    };

    // Baseline run WITHOUT a memoStore: the harness still does the
    // implicit in-round dedup (two identical hashes in the same round
    // share one verifier call), but no cross-obligation memoization.
    const baselineSession = new StubSession({ projectContext: 'CTX', responder });
    const baselineLedger = new JsonlLedger(path.join(repoRoot, 'baseline.jsonl'), 'baseline');
    const baselineResult = await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session: baselineSession,
      ledger: baselineLedger,
      mode: 'tournament',
    });
    assert.equal(baselineResult.satisfied, 6);

    // Memoized run WITH memo store: same workload, but cross-obligation
    // winner-hash matches let later tournaments skip *all* their
    // verifier calls (their candidates' hashes are already on the
    // store).
    const memoRoot = tmpDir();
    const contractMemo = finalize({
      schemaVersion: 'v1',
      goal: 'add health checks to 4 services',
      repoContext: { repoRoot: memoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'src/svc-a/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-b/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-c/health.ts' },
        { type: 'file-must-exist', path: 'src/svc-d/health.ts' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const memoSession = new StubSession({ projectContext: 'CTX', responder });
    const memoLedger = new JsonlLedger(path.join(memoRoot, 'memo.jsonl'), 'memo');
    const memoStore = new MemoStore([]);
    const memoResult = await runPopulation({
      contract: contractMemo,
      repoRoot: memoRoot,
      registry: createDefaultRegistry(),
      session: memoSession,
      ledger: memoLedger,
      mode: 'tournament',
      memoStore,
    });
    assert.equal(memoResult.satisfied, 6);
    // Memoization saves strictly more verifier calls than the
    // implicit in-round dedup alone — that's the §7 "share work
    // across repeated patterns" criterion.
    assert.ok(
      memoResult.verifierCallsSavedByMemoization > baselineResult.verifierCallsSavedByMemoization,
      `expected memoized saves (${memoResult.verifierCallsSavedByMemoization}) > baseline saves (${baselineResult.verifierCallsSavedByMemoization})`,
    );
    // Aggregate output-token usage on the memoized run is strictly
    // lower — skipped verifier calls don't bill output tokens.
    assert.ok(
      memoResult.totalUsage.outputTokens < baselineResult.totalUsage.outputTokens,
      `expected memoized output tokens < baseline (${memoResult.totalUsage.outputTokens} vs ${baselineResult.totalUsage.outputTokens})`,
    );
  });

  it('records winner ingestion so a later identical-hash candidate inherits the verdict', async () => {
    const repoRoot = tmpDir();
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'a.ts' },
        { type: 'file-must-exist', path: 'b.ts' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    let architectVerifierCalls = 0;
    const responder = (req: { personaId: string; userMessage: string }) => {
      if (req.personaId === 'tournament-verifier') {
        // Count only verifier calls that score architect candidates,
        // i.e. those targeting a file-must-exist obligation. Build/test
        // obligations score "no-op" responses; we don't care about
        // those for this assertion.
        if (req.userMessage.includes('file-must-exist')) {
          architectVerifierCalls += 1;
        }
        return JSON.stringify({ score: 0.9, rationale: 'ok' });
      }
      if (req.personaId === 'architect') return '```\nbody\n```';
      return 'no-op';
    };
    const session = new StubSession({ projectContext: 'CTX', responder });
    const ledger = new JsonlLedger(path.join(repoRoot, 'ledger.jsonl'), 'r1');
    await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'tournament',
      memoStore: new MemoStore([]),
    });
    // First file-must-exist obligation: 2 candidates, same hash → 1
    // fresh verifier call. Second file-must-exist: 2 candidates, same
    // hash AND matches prior winner → 0 fresh verifier calls. Total
    // architect-side fresh verifier calls = 1.
    assert.equal(
      architectVerifierCalls,
      1,
      `expected exactly 1 fresh verifier call on file-must-exist tournaments, got ${architectVerifierCalls}`,
    );
  });
});
