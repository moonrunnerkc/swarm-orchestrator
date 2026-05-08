import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { handleCompile } from '../../src/cli/v8/compile-handler';
import { handleRun } from '../../src/cli/v8/run-handler';
import { StubSession } from '../../src/session/stub-session';
import { readEntries } from '../../src/ledger/jsonl-ledger';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-run-int-'));
}

interface RunResultFile {
  runId: string;
  satisfied: number;
  failed: number;
  cacheHitRate: number;
  effectiveInputTokens: number;
  ledgerPath: string;
  totalUsage: { inputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; outputTokens: number };
}

describe('integration: swarm v8 run', () => {
  it('compiles a contract, runs it against a stub session, and writes evidence files', async () => {
    const work = tmpDir();
    fs.writeFileSync(
      path.join(work, 'package.json'),
      JSON.stringify({ name: 'wf', private: true, scripts: { build: "node -e ''", test: "node -e ''" } }, null, 2),
    );
    fs.writeFileSync(path.join(work, 'tsconfig.json'), '{}');
    const contractDir = path.join(work, 'contract');

    // Compile
    const compileExit = await handleCompile([
      'add a CHANGES.md note',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);
    assert.equal(compileExit, 0);

    // Run
    const resultPath = path.join(work, 'result.json');
    const ledgerPath = path.join(work, 'ledger.jsonl');
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nhello world\n```' : 'no-op'),
    });
    const runExit = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--session', 'stub',
        '--ledger', ledgerPath,
        '--result', resultPath,
        '--run-id', 'fixed-run-id',
      ],
      { session },
    );
    assert.equal(runExit, 0);

    // Result file
    const result: RunResultFile = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(result.satisfied, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.runId, 'fixed-run-id');
    // Cache hit rate is in [0, 1].
    assert.ok(result.cacheHitRate >= 0 && result.cacheHitRate <= 1);
    // 3 calls: 1 cache write + 2 cache reads ⇒ rate > 0.
    assert.ok(result.cacheHitRate > 0);

    // Ledger file
    const entries = readEntries(ledgerPath);
    assert.ok(entries.length >= 1 + 3 * 3 + 1); // run-started + 3 × (attempted, candidate, satisfied) + run-finished
    assert.equal(entries[0]?.type, 'run-started');
    const lastEntry = entries[entries.length - 1];
    assert.equal(lastEntry?.type, 'run-finished');
  });

  it('exits 2 when at least one obligation fails verification', async () => {
    const work = tmpDir();
    fs.writeFileSync(path.join(work, 'package.json'), '{}');
    const contractDir = path.join(work, 'contract');
    await handleCompile([
      'add a thing',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);

    // Override the contract on disk to use a failing build command, then re-write
    // the manifest so the contract reader still validates.
    const fail = fs.readFileSync(path.join(contractDir, 'contract.jsonl'), 'utf8');
    fs.writeFileSync(
      path.join(contractDir, 'contract.jsonl'),
      fail
        .replace(/"build-must-pass","command":"[^"]+"/, '"build-must-pass","command":"false"')
        .replace(/"test-must-pass","command":"[^"]+"/, '"test-must-pass","command":"true"'),
    );
    // The hash recorded in the manifest no longer matches; readContract validates
    // the obligation list, not the hash, so this still loads. Phase 4 will add
    // hash-chain enforcement.

    const session = new StubSession({
      projectContext: '',
      responder: () => '```\nx\n```',
    });
    const exit = await handleRun(
      [
        contractDir,
        '--repo-root', work,
        '--session', 'stub',
        '--ledger', path.join(work, 'ledger.jsonl'),
        '--run-id', 'r2',
      ],
      { session },
    );
    assert.equal(exit, 2);
  });

  it('rejects unknown flags with exit 1', async () => {
    const work = tmpDir();
    fs.writeFileSync(path.join(work, 'package.json'), '{}');
    const contractDir = path.join(work, 'contract');
    await handleCompile([
      'goal',
      '--repo-root', work,
      '--out', contractDir,
      '--extractor', 'stub',
      '--yes',
      '--no-editor',
    ]);
    const exit = await handleRun([contractDir, '--bogus']);
    assert.equal(exit, 1);
  });
});
