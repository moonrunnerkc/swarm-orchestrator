import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { finalize } from '../../src/contract/compiler';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('population/manager rollback integration', () => {
  it('single-mode falsification path restores workspace to pre-run state', async () => {
    const repo = tmpDir('v8-mgr-rb-');
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
        { type: 'file-must-exist', path: 'CHANGES.md' },
        { type: 'build-must-pass', command: 'true' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });

    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req) => {
        if (req.personaId === 'architect') return '```\nhello\n```';
        return 'no-op';
      },
    });

    const registry = createDefaultRegistry();
    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-rb-1');

    const preState = fs.readdirSync(repo);

    const fakeAdapter = {
      name: 'fake',
      handles: ['file-must-exist' as const, 'build-must-pass' as const, 'test-must-pass' as const],
      falsify: async () => ({
        result: {
          kind: 'counter-example-input' as const,
          obligationType: 'file-must-exist' as const,
          inputs: [{
            files: [],
            reproducer: 'always fails',
            reproducerOutput: '',
            reproducerExitCode: 1,
          }],
        },
        cost: {
          adapterName: 'fake',
          obligationType: 'file-must-exist',
          wallClockMs: 1,
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

    const fakeRegistry = {
      forObligation: () => [fakeAdapter],
    };

    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry,
      session,
      ledger,
      runId: 'run-rb-1',
      falsifiers: 'on',
      adapterRegistry: fakeRegistry as unknown as import('../../src/falsification/adapters/registry').AdapterRegistry,
    });

    assert.equal(result.failed > 0, true);
    const entries = ledger.readAll();
    assert.ok(entries.some((e) => e.type === 'obligation-rolled-back'));
    const postState = fs.readdirSync(repo);
    assert.deepEqual(postState, preState);
  });

  it('post-merge regression path restores workspace for applied obligations', async () => {
    const repo = tmpDir('v8-mgr-pm-');
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
        { type: 'build-must-pass', command: 'test -f one.ts' },
        { type: 'build-must-pass', command: 'test ! -f one.ts' },
        { type: 'test-must-pass', command: 'true' },
      ],
      extractor: { name: 'stub', model: null, temperature: null, promptSha256: null },
    });

    const session = new StubSession({
      projectContext: 'CTX',
      responder: (req, callIndex) => {
        if (req.personaId === 'implementer') {
          if (callIndex === 0) {
            return [
              '--- /dev/null',
              '+++ b/one.ts',
              '@@ -0,0 +1,1 @@',
              '+one',
            ].join('\n');
          }
          if (callIndex === 1) {
            return [
              '--- a/one.ts',
              '+++ /dev/null',
              '@@ -1,1 +0,0 @@',
              '-one',
            ].join('\n');
          }
        }
        return 'no-op';
      },
    });

    const ledger = new JsonlLedger(path.join(repo, 'ledger.jsonl'), 'run-pm-1');

    const result = await runPopulation({
      contract,
      repoRoot: repo,
      registry: createDefaultRegistry(),
      session,
      ledger,
      runId: 'run-pm-1',
      postMerge: true,
    });

    // Obligation 0 passes during synthesis (one.ts created), obligation 1
    // passes during synthesis (one.ts deleted). Post-merge re-checks
    // obligation 0: one.ts no longer exists, so it fails. This triggers
    // rollback of all applied obligations in reverse order.
    assert.equal(result.postMerge?.passed, false);
    const entries = ledger.readAll();
    assert.ok(entries.some((e) => e.type === 'obligation-rolled-back'));

    // Obligation 0's rollback removes one.ts (its pre-apply state was absent).
    // The manager rolls back every satisfied obligation, restoring the
    // pre-run workspace state.
    assert.equal(fs.existsSync(path.join(repo, 'one.ts')), false);
  });
});
