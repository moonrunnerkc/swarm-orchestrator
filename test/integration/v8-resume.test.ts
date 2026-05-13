import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import { writeContract } from '../../src/contract/serializer';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleResume } from '../../src/cli/v8/resume-handler';
import { StubExtractor } from '../../src/contract/extractor/stub-extractor';
import { handleRun } from '../../src/cli/v8/run-handler';
import { readEntries, verifyChainAt } from '../../src/ledger/ledger';
import { StubSession } from '../../src/session/stub-session';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-resume-int-'));
}

interface ResumeResultFile {
  satisfied: number;
  failed: number;
  memoizedObligations: number;
  verifierCallsSavedByMemoization: number;
  outcomes: Array<{ type: string; satisfied: boolean }>;
  resumeOf: string;
}

describe('integration: swarm v8 resume', () => {
  it('resumes a partial run and finishes the remaining obligation without redoing satisfied work', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify(
        {
          name: 'wf',
          private: true,
          scripts: { build: "node -e ''", test: "node -e ''" },
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(path.join(work, 'tsconfig.json'), '{}');
    // Build a 6-file-must-exist contract directly via finalize() so we
    // get a deterministic obligation count regardless of the goal-parser
    // heuristics. Phase 4 §7 exit criterion: 5/6 then resume.
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'add 6 service health files',
      repoContext: { repoRoot: work, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'services/svc-1/health.ts' },
        { type: 'file-must-exist', path: 'services/svc-2/health.ts' },
        { type: 'file-must-exist', path: 'services/svc-3/health.ts' },
        { type: 'file-must-exist', path: 'services/svc-4/health.ts' },
        { type: 'file-must-exist', path: 'services/svc-5/health.ts' },
        { type: 'file-must-exist', path: 'services/svc-6/health.ts' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const contractDir = path.join(work, '.swarm', 'contracts', contract.manifest.contractId);
    writeContract(contractDir, contract);

    // First run: kill after the 5th obligation by capping --max-obligations.
    const ledgerPath = path.join(work, 'ledger.jsonl');
    const session1 = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nfile body\n```' : 'no-op'),
    });
    const result1Path = path.join(work, 'r1.json');
    const exit1 = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--ledger', ledgerPath,
        '--result', result1Path,
        '--run-id', 'partial-run',
        '--max-obligations', '5',
        // Phase 6 features add pre-generation + post-merge passes; this
        // test asserts Phase 4 behavior (memoization), so opt out.
        '--no-streaming',
        '--no-pre-generation',
        '--no-post-merge',
      ],
      { session: session1 },
    );
    assert.equal(exit1, 0);
    const r1 = JSON.parse(fs.readFileSync(result1Path, 'utf8'));
    // Capped at 5 obligations attempted; the run reports just the 5 it
    // attempted (the manager doesn't push outcomes for un-attempted
    // obligations).
    assert.equal(r1.satisfied, 5);
    assert.equal(r1.failed, 0);

    // Verify the chain on the partial ledger.
    assert.doesNotThrow(() => verifyChainAt(ledgerPath));

    // Resume with a fresh session; should pick up the un-attempted
    // obligations and write a `run-resumed` marker.
    const session2 = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nfile body\n```' : 'no-op'),
    });
    const result2Path = path.join(work, 'r2.json');
    const exit2 = await handleResume(
      [
        'resumed-run',
        '--ledger', ledgerPath,
        '--contract', contractDir,
        '--repo-root', work,
        '--result', result2Path,
        '--no-streaming',
        '--no-pre-generation',
        '--no-post-merge',
      ],
      { session: session2 },
    );
    assert.equal(exit2, 0);

    const r2: ResumeResultFile = JSON.parse(fs.readFileSync(result2Path, 'utf8'));
    assert.equal(r2.resumeOf, 'partial-run');
    // 5 prior-satisfied obligations are memoized; the contract has 8
    // total. Resume's outcomes list contains only the un-attempted
    // obligations (the manager doesn't push outcomes for memoized
    // skips). Together: memoized + freshly-attempted = 8.
    assert.equal(r2.memoizedObligations, 5);
    assert.equal(r2.memoizedObligations + r2.outcomes.length, contract.obligations.length);
    assert.equal(r2.failed, 0);
    // The fresh outcomes cover only the un-attempted obligations.
    assert.ok(r2.outcomes.length >= 1);

    // Ledger chain remains valid after resume.
    assert.doesNotThrow(() => verifyChainAt(ledgerPath));

    // Ledger contains the run-resumed marker plus obligation-memoized
    // entries for the prior-satisfied indexes.
    const entries = readEntries(ledgerPath);
    const types = entries.map((e) => e.type);
    assert.ok(types.includes('run-resumed'));
    const memoCount = types.filter((t) => t === 'obligation-memoized').length;
    assert.equal(memoCount, 5, 'one memoized entry per prior-satisfied obligation');
  });

  it('aborts when the ledger chain is tampered', async () => {
    const work = tmpDir();
    fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } }));
    fs.writeFileSync(path.join(work, 'tsconfig.json'), '{}');
    const contractDir = path.join(work, 'contract');
    await handleCompile(
      [
        'add CHANGES.md',
        '--repo-root', work,
        '--out', contractDir,
        '--yes',
        '--no-editor',
      ],
      { extractor: StubExtractor.fromHeuristic() },
    );
    const ledgerPath = path.join(work, 'ledger.jsonl');
    const session1 = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nbody\n```' : 'no-op'),
    });
    await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--ledger', ledgerPath,
        '--run-id', 'orig',
        '--max-obligations', '2',
        '--no-streaming',
        '--no-pre-generation',
        '--no-post-merge',
      ],
      { session: session1 },
    );

    // Tamper with the ledger: edit a goal field.
    const text = fs.readFileSync(ledgerPath, 'utf8');
    fs.writeFileSync(ledgerPath, text.replace(/"goal":"[^"]*"/, '"goal":"hacked"'));

    const exitTamper = await handleResume(
      [
        'resume-after-tamper',
        '--ledger', ledgerPath,
        '--contract', contractDir,
        '--repo-root', work,
      ],
      { session: new StubSession({ projectContext: 'CTX' }) },
    );
    assert.equal(exitTamper, 4, 'tamper exit code is 4');
  });

  it('resume rejects argv with no run id', async () => {
    const exit = await handleResume([]);
    assert.equal(exit, 1);
  });

  it('resume returns 1 when ledger does not exist', async () => {
    const work = tmpDir();
    const exit = await handleResume([
      'no-such-run',
      '--ledger', path.join(work, 'no-such.jsonl'),
      '--repo-root', work,
    ]);
    assert.equal(exit, 1);
  });
});
