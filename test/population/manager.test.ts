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

  it('dispatches falsifiers after producer satisfaction; counter-example flips obligation to failed', async () => {
    const { AdapterRegistry } = await import('../../src/falsification/adapters/registry');
    const repo = tmpDir('v8-mgr-fals-');
    // Property obligation that's trivially satisfied (file exists), so the
    // producer side passes; the fake adapter then claims a counter-example
    // and the manager must flip the obligation to failed.
    fs.writeFileSync(path.join(repo, 'pkg.txt'), 'hello\n');
    const propertyContract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: {
        repoRoot: repo,
        buildCommand: 'true',
        testCommand: 'true',
        language: 'typescript',
      },
      obligations: [
        { type: 'file-must-exist', path: 'pkg.txt' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
        {
          type: 'property-must-hold',
          predicate: 'true',
          target: 'always holds',
        },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    const fakeAdapter = {
      name: 'fake-falsifier',
      handles: ['property-must-hold'] as const,
      falsify: async () => ({
        result: {
          kind: 'counter-example-input' as const,
          obligationType: 'property-must-hold' as const,
          inputs: [
            {
              files: [],
              reproducer: 'echo broke',
              reproducerOutput: 'broke',
              reproducerExitCode: 1,
            },
          ],
        },
        cost: {
          adapterName: 'fake-falsifier',
          obligationType: 'property-must-hold' as const,
          wallClockMs: 5,
          dollarsSpent: 0,
          authMethod: 'api' as const,
          dollarsBilled: 0,
          dollarsTokenEstimate: 0,
          dollarsApiEquivalent: 0,
          counterExamplesFound: 1,
          falsePositives: 0,
        },
      }),
    };
    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(fakeAdapter);
    const session = new StubSession({
      projectContext: '',
      responder: (req) =>
        req.personaId === 'architect' ? '```\nhello\n```' : 'no-op',
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'fals-1');
    const result = await runPopulation({
      contract: propertyContract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      adapterRegistry,
      falsifiers: 'on',
    });
    // Property obligation must have been flipped to failed by the falsifier.
    const propertyOutcome = result.outcomes.find(
      (o) => o.obligation.type === 'property-must-hold',
    );
    assert.ok(propertyOutcome);
    assert.equal(propertyOutcome?.satisfied, false);
    assert.match(propertyOutcome?.detail ?? '', /fake-falsifier/);
    // Ledger must contain the falsification-call entry with the counter-example.
    const entries = ledger.readAll();
    const falsCall = entries.find((e) => e.type === 'falsification-call');
    assert.ok(falsCall, 'expected a falsification-call ledger entry');
    assert.equal(
      (falsCall as { resultKind: string }).resultKind,
      'counter-example-input',
    );
  });

  it('skips dispatch entirely when falsifiers === "off"', async () => {
    const { AdapterRegistry } = await import('../../src/falsification/adapters/registry');
    const repo = tmpDir('v8-mgr-fals-off-');
    fs.writeFileSync(path.join(repo, 'pkg.txt'), 'hi\n');
    const contract = finalize({
      schemaVersion: 'v1',
      goal: 'g',
      repoContext: {
        repoRoot: repo,
        buildCommand: 'true',
        testCommand: 'true',
        language: 'typescript',
      },
      obligations: [
        { type: 'file-must-exist', path: 'pkg.txt' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
        { type: 'property-must-hold', predicate: 'true', target: 'always holds' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });
    let called = false;
    const fakeAdapter = {
      name: 'fake',
      handles: ['property-must-hold'] as const,
      falsify: async () => {
        called = true;
        throw new Error('should never be called');
      },
    };
    const adapterRegistry = new AdapterRegistry();
    adapterRegistry.register(fakeAdapter);
    const session = new StubSession({
      projectContext: '',
      responder: (req) =>
        req.personaId === 'architect' ? '```\nhi\n```' : 'no-op',
    });
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r1');
    await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      adapterRegistry,
      falsifiers: 'off',
    });
    assert.equal(called, false);
    const entries = ledger.readAll();
    assert.equal(
      entries.some((e) => e.type === 'falsification-call'),
      false,
    );
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
