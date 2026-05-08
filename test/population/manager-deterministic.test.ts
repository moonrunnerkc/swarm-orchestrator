import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger, readEntries } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { SessionRequest } from '../../src/session/types';
import { createDefaultRuntime, WasmRuntime } from '../../src/wasm';
import type { DeterministicStrategy } from '../../src/wasm/types';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-det-'));
}

function makeContract(repoRoot: string, obligations: ObligationV1[]): FinalContract {
  return finalize({
    schemaVersion: 'v1',
    goal: 'phase 5 deterministic-floor test',
    repoContext: { repoRoot, buildCommand: 'true', testCommand: 'true', language: 'typescript' },
    obligations,
    extractor: { name: 'test', model: null, temperature: null, promptSha256: null },
  });
}

/**
 * Stub session that returns no-op for every persona. The §8 (a) check
 * lives at the ledger level: the deterministic-floor obligation must
 * never produce a `candidate-recorded` entry. The session may still be
 * hit for build/test obligations (and tournament fallback personas),
 * which return 'no-op' so the verifier passes against `true`.
 */
function trackingSession(): StubSession {
  return new StubSession({
    projectContext: 'CTX',
    responder: (_req: SessionRequest) => 'no-op',
  });
}

describe('population/manager — deterministic dispatch', () => {
  it('satisfies a tagged file-must-exist with zero session calls for that obligation (§8 exit (a))', async () => {
    const repo = tmpDir();
    // Contract validator requires ≥1 build + ≥1 test; both run no-ops
    // so the only synthesis-eligible obligation is the LICENSE one,
    // which the deterministic floor must absorb.
    const contract = makeContract(repo, [
      { type: 'file-must-exist', path: 'LICENSE', deterministicStrategy: 'scaffold-template' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    const session = trackingSession();
    const ledgerPath = path.join(repo, 'ledger.jsonl');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(ledgerPath, 'r-1'),
      mode: 'single',
      wasmRuntime: createDefaultRuntime(),
    });
    assert.equal(result.satisfied, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.deterministicObligations, 1);
    assert.equal(result.deterministicReroutes, 0);
    // §8 (a): zero LLM tokens consumed for the deterministic obligation.
    // The build and test obligations DO call into the session (architect
    // is the file-must-exist persona; build/test go through the
    // implementer/verifier personas), but they declare 'no-op' so no
    // diff is applied. The architect persona — the only one that would
    // have generated a file body — is never called because the
    // deterministic floor already satisfied the file obligation.
    // For the explicit "zero tokens" check we look at the ledger: there
    // must be no candidate-recorded entry for the file-must-exist
    // obligation (index 0 in canonical order).
    const entries = readEntries(ledgerPath);
    const candidateForFile = entries.filter(
      (e) => e.type === 'candidate-recorded' && e.obligationIndex === 0,
    );
    assert.equal(candidateForFile.length, 0);

    const types = entries.map((e) => e.type);
    assert.ok(types.includes('obligation-deterministic-attempted'));
    assert.ok(types.includes('obligation-deterministic-applied'));
    assert.ok(types.includes('obligation-satisfied'));
  });

  it('reroutes to synthesis when the strategy fails', async () => {
    const repo = tmpDir();
    const contract = makeContract(repo, [
      // Scaffold-template will throw because there is no template for `.weird`.
      {
        type: 'file-must-exist',
        path: 'src/code.weird',
        deterministicStrategy: 'scaffold-template',
      },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    const responses: string[] = [];
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req: SessionRequest) => {
        responses.push(req.personaId);
        if (req.personaId === 'architect') return '```\nweird body\n```';
        if (req.personaId === 'tournament-verifier') {
          return JSON.stringify({ score: 0.9, rationale: 'ok' });
        }
        return 'no-op';
      },
    });
    const ledgerPath = path.join(repo, 'ledger.jsonl');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(ledgerPath, 'r-2'),
      mode: 'single',
      wasmRuntime: createDefaultRuntime(),
    });
    assert.equal(result.satisfied, 3);
    assert.equal(result.deterministicObligations, 0);
    assert.equal(result.deterministicReroutes, 1);
    // Architect persona was called for the rerouted obligation.
    assert.ok(responses.includes('architect'));

    const entries = readEntries(ledgerPath);
    const detFailed = entries.filter((e) => e.type === 'obligation-deterministic-failed');
    assert.equal(detFailed.length, 1);
  });

  it('does not retry the WASM strategy after a failure (§8 misclassification recovery)', async () => {
    const repo = tmpDir();
    const dispatched: string[] = [];
    const oneShotFailing: DeterministicStrategy = {
      name: 'one-shot-failing',
      description: 'always fails',
      handles: ['file-must-exist'],
      async execute(ctx) {
        dispatched.push(ctx.obligation.type);
        throw new Error('strategy refuses to run');
      },
    };
    const runtime = new WasmRuntime([oneShotFailing]);
    const contract = makeContract(repo, [
      { type: 'file-must-exist', path: 'a.ts', deterministicStrategy: 'one-shot-failing' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nbody\n```' : 'no-op'),
    });
    const ledgerPath = path.join(repo, 'ledger.jsonl');
    await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(ledgerPath, 'r-3'),
      mode: 'single',
      wasmRuntime: runtime,
    });
    assert.equal(dispatched.length, 1, 'strategy must be dispatched exactly once');
  });

  it('verifier-rejected after apply also reroutes and records reason', async () => {
    const repo = tmpDir();
    const liar: DeterministicStrategy = {
      name: 'liar',
      description: 'claims success but does not write',
      handles: ['file-must-exist'],
      async execute() {
        return { applied: true, detail: 'lied', filesAffected: [] };
      },
    };
    const runtime = new WasmRuntime([liar]);
    const contract = makeContract(repo, [
      { type: 'file-must-exist', path: 'src/missing.ts', deterministicStrategy: 'liar' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nrecovered body\n```' : 'no-op'),
    });
    const ledgerPath = path.join(repo, 'ledger.jsonl');
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(ledgerPath, 'r-4'),
      mode: 'single',
      wasmRuntime: runtime,
    });
    assert.equal(result.deterministicReroutes, 1);
    assert.equal(result.satisfied, 3);
    const entries = readEntries(ledgerPath);
    const failedEntry = entries.find((e) => e.type === 'obligation-deterministic-failed');
    if (!failedEntry || failedEntry.type !== 'obligation-deterministic-failed') {
      throw new Error('expected obligation-deterministic-failed entry');
    }
    assert.equal(failedEntry.reason, 'verifier-rejected');
  });

  it('omitting the runtime keeps the synthesis path entirely', async () => {
    const repo = tmpDir();
    // Tag the obligation but pass no runtime — population manager must
    // ignore the tag and run synthesis as usual.
    const contract = makeContract(repo, [
      { type: 'file-must-exist', path: 'LICENSE', deterministicStrategy: 'scaffold-template' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    let calls = 0;
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        calls += 1;
        if (req.personaId === 'architect') return '```\nfile body\n```';
        return 'no-op';
      },
    });
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r-5'),
      mode: 'single',
    });
    assert.equal(result.deterministicObligations, 0);
    assert.equal(result.deterministicReroutes, 0);
    assert.ok(calls > 0);
  });

  it('strategies not registered in the runtime fall through to synthesis', async () => {
    const repo = tmpDir();
    const runtime = new WasmRuntime([]); // empty
    const contract = makeContract(repo, [
      { type: 'file-must-exist', path: 'LICENSE', deterministicStrategy: 'scaffold-template' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
    ]);
    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => (req.personaId === 'architect' ? '```\nfile body\n```' : 'no-op'),
    });
    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger: new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'r-6'),
      mode: 'single',
      wasmRuntime: runtime,
    });
    assert.equal(result.deterministicObligations, 0);
    assert.equal(result.deterministicReroutes, 0);
    assert.equal(result.satisfied, 3);
  });
});
