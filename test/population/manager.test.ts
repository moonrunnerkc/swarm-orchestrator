import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { renderDynamicMessage, runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { FinalContract } from '../../src/contract/types';
import { finalize } from '../../src/contract/compiler';

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

describe('population/manager', () => {
  it('runs the contract end-to-end against a stub session and reports success', async () => {
    const repo = tmpDir('v8-mgr-');
    const ledgerPath = path.join(repo, '.swarm/ledger/test.jsonl');
    const contract = makeContract(repo, 'CHANGES.md');
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nhello\n```' : 'no-op'),
    });
    const ledger = new JsonlLedger(ledgerPath, 'r1');

    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
    });

    assert.equal(result.satisfied, 3);
    assert.equal(result.failed, 0);
    assert.ok(fs.existsSync(path.join(repo, 'CHANGES.md')));
    const entries = ledger.readAll();
    assert.equal(entries[0]?.type, 'run-started');
    const lastEntry = entries[entries.length - 1];
    assert.equal(lastEntry?.type, 'run-finished');
    assert.ok(entries.some((e) => e.type === 'obligation-attempted'));
    assert.ok(entries.some((e) => e.type === 'candidate-recorded'));
    assert.ok(entries.some((e) => e.type === 'obligation-satisfied'));
  });

  it('records cache reads on subsequent obligations (substrate cache reuse)', async () => {
    const repo = tmpDir('v8-mgr-');
    const contract = makeContract(repo, 'CHANGES.md');
    const session = new StubSession({
      projectContext: 'A'.repeat(800), // ~200 tokens
      responder: () => '```\nx\n```',
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
    });
    // First call warms cache, subsequent calls read from cache.
    assert.ok(result.totalUsage.cacheCreationTokens > 0);
    assert.ok(result.totalUsage.cacheReadTokens > 0);
    // 3 obligations: 1 write + 2 reads of the same prefix.
    assert.equal(
      result.totalUsage.cacheReadTokens,
      result.totalUsage.cacheCreationTokens * 2,
    );
  });

  it('marks obligations as failed when verification rejects', async () => {
    const repo = tmpDir('v8-mgr-');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: { repoRoot: repo, buildCommand: 'false', testCommand: 'true', language: 'typescript' },
      obligations: [
        { type: 'file-must-exist', path: 'CHANGES.md' },
        { type: 'build-must-pass', command: 'false' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const session = new StubSession({
      projectContext: '',
      responder: (req) => (req.personaId === 'architect' ? '```\nhello\n```' : 'no-op'),
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
    });
    assert.equal(result.satisfied, 2);
    assert.equal(result.failed, 1);
    const failed = result.outcomes.find((o) => !o.satisfied);
    assert.ok(failed);
    assert.equal(failed?.obligation.type, 'build-must-pass');
  });

  it('respects maxObligations cap', async () => {
    const repo = tmpDir('v8-mgr-');
    const contract = makeContract(repo, 'CHANGES.md');
    const session = new StubSession({ projectContext: '', responder: () => '```\nx\n```' });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      maxObligations: 1,
    });
    assert.equal(result.outcomes.length, 1);
  });

  it('renderDynamicMessage embeds the obligation JSON', () => {
    const message = renderDynamicMessage(
      { type: 'file-must-exist', path: 'src/x.ts' },
      '/repo',
    );
    assert.match(message, /file-must-exist/);
    assert.match(message, /src\/x\.ts/);
    assert.match(message, /\/repo/);
  });
});
