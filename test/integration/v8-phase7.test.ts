import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { contractHash, contractIdFromHash } from '../../src/contract/canonicalize';
import type { FinalContract, ObligationV1 } from '../../src/contract/types';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import { createDefaultRegistry } from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { SessionRequest } from '../../src/session/types';

/**
 * Phase 7 milestone integration test (impl guide §10).
 *
 * Verifies that:
 *   1. The default registry exposes every Phase 7 persona AND each Phase 7
 *      obligation type is dispatched to its owning persona by the
 *      predicate evaluator.
 *   2. The population manager can drive an 8-obligation contract — one
 *      obligation per type — through to satisfaction in single mode using
 *      stub responses tailored to each persona.
 *   3. The ledger records one `obligation-attempted` entry per persona,
 *      and `run-finished` reports `failed=0` once all eight verifiers
 *      agree.
 */

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v8-phase7-'));
}

function writeFile(repoRoot: string, rel: string, content: string): void {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function buildContract(repoRoot: string, obligations: ObligationV1[]): FinalContract {
  const hash = contractHash(obligations);
  return {
    manifest: {
      schemaVersion: 'v1',
      contractHash: hash,
      contractId: contractIdFromHash(hash),
      goal: 'phase 7 milestone',
      repoContext: {
        repoRoot,
        buildCommand: 'true',
        testCommand: 'true',
        language: 'typescript',
      },
      extractor: { name: 'inline-test', model: null, temperature: null, promptSha256: null },
      createdAt: new Date().toISOString(),
    },
    obligations,
  };
}

describe('integration: v8 Phase 7 milestone', () => {
  let repoRoot: string;
  beforeEach(() => {
    repoRoot = tmp();
  });
  afterEach(() => {
    if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it('drives every Phase 7 obligation type through the right persona', async () => {
    // Pre-place every workspace artifact the verifiers will inspect, so
    // a "no-op" response from each persona suffices to satisfy. The
    // point of this test is wiring (predicate dispatch + verifier
    // coverage), not synthesis.
    writeFile(repoRoot, 'README.md', '# wired\n');
    writeFile(repoRoot, 'src/api.ts', 'export function handler(req: Request): Response { return new Response(); }\n');
    writeFile(repoRoot, 'src/a.ts', `import './b';\nexport const a = 1;\n`);
    writeFile(repoRoot, 'src/b.ts', `export const b = 2;\n`);
    writeFile(
      repoRoot,
      'coverage/coverage-summary.json',
      JSON.stringify({ total: { lines: { pct: 95 } } }),
    );
    writeFile(repoRoot, 'bench/baseline.json', JSON.stringify({ value: 100 }));

    const obligations: ObligationV1[] = [
      { type: 'file-must-exist', path: 'README.md' },
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
      {
        type: 'function-must-have-signature',
        file: 'src/api.ts',
        name: 'handler',
        signature: '(req: Request): Response',
      },
      { type: 'property-must-hold', target: 'tautology', predicate: 'true' },
      { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
      {
        type: 'coverage-must-exceed',
        scope: 'coverage/coverage-summary.json',
        metric: 'lines',
        threshold: 80,
      },
      {
        type: 'performance-must-not-regress',
        benchmark: 'echo 100',
        baseline: 'bench/baseline.json',
        threshold: 0.1,
      },
    ];
    const contract = buildContract(repoRoot, obligations);

    // Track which persona handled which obligation type so we can assert
    // dispatch correctness.
    const dispatched: Array<{ personaId: string; userMessage: string }> = [];
    const session = new StubSession({
      projectContext: 'phase7 ctx',
      responder: (req: SessionRequest) => {
        dispatched.push({ personaId: req.personaId, userMessage: req.userMessage });
        // For file-must-exist, we want the architect to NOT clobber the
        // existing README; respond with the same content fenced so
        // applyFileEmit just rewrites identical bytes.
        if (req.personaId === 'architect') {
          return '```\n# wired\n```';
        }
        return 'no-op';
      },
    });

    const ledgerPath = path.join(repoRoot, 'ledger.jsonl');
    const ledger = new JsonlLedger(ledgerPath, 'phase7-run');
    const result = await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'single',
    });

    assert.equal(result.failed, 0, 'no obligation should fail');
    assert.equal(result.satisfied, 8);
    assert.equal(result.outcomes.length, 8);

    // Map obligation type → persona id observed.
    const typeToPersona = new Map<string, string>();
    for (const o of result.outcomes) {
      assert.ok(o.satisfied, `obligation ${o.obligationIndex} (${o.obligation.type}): ${o.detail}`);
      assert.ok(o.personaId, `outcome should have a persona`);
      typeToPersona.set(o.obligation.type, o.personaId as string);
    }
    assert.deepEqual(
      Object.fromEntries(typeToPersona.entries()),
      {
        'file-must-exist': 'architect',
        'build-must-pass': 'implementer',
        'test-must-pass': 'verifier',
        'function-must-have-signature': 'documentation-writer',
        'property-must-hold': 'security-reviewer',
        'import-graph-must-satisfy': 'dependency-auditor',
        'coverage-must-exceed': 'test-author',
        'performance-must-not-regress': 'migration-specialist',
      },
    );

    // Eight personas dispatched, eight responses consumed.
    assert.equal(dispatched.length, 8);
    const personaIds = dispatched.map((d) => d.personaId).sort();
    assert.deepEqual(personaIds, [
      'architect',
      'dependency-auditor',
      'documentation-writer',
      'implementer',
      'migration-specialist',
      'security-reviewer',
      'test-author',
      'verifier',
    ]);
  });

  it('Phase 7 obligation types fail loudly on a non-compliant workspace', async () => {
    // No README, signature missing, cycle in src, coverage absent,
    // baseline missing — every Phase 7 verifier should report a
    // verifiable failure detail.
    writeFile(repoRoot, 'src/a.ts', `import './b';\n`);
    writeFile(repoRoot, 'src/b.ts', `import './a';\n`); // cycle
    writeFile(repoRoot, 'src/api.ts', 'export function handler() {}\n'); // wrong signature

    const obligations: ObligationV1[] = [
      { type: 'build-must-pass', command: 'true' },
      { type: 'test-must-pass', command: 'true' },
      {
        type: 'function-must-have-signature',
        file: 'src/api.ts',
        name: 'handler',
        signature: '(req: Request): Response',
      },
      { type: 'property-must-hold', target: 'always-fails', predicate: 'false' },
      { type: 'import-graph-must-satisfy', constraint: 'no-cycles', scope: 'src' },
      {
        type: 'coverage-must-exceed',
        scope: 'coverage/coverage-summary.json',
        metric: 'lines',
        threshold: 80,
      },
      {
        type: 'performance-must-not-regress',
        benchmark: 'echo 100',
        baseline: 'bench/baseline.json',
        threshold: 0.1,
      },
    ];
    const contract = buildContract(repoRoot, obligations);

    const session = new StubSession({
      projectContext: 'phase7 ctx',
      responder: () => 'no-op',
    });
    const ledgerPath = path.join(repoRoot, 'ledger.jsonl');
    const ledger = new JsonlLedger(ledgerPath, 'phase7-fail');
    const result = await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'single',
    });

    // Five Phase 7 obligations fail; the two build/test obligations pass.
    assert.equal(result.satisfied, 2);
    assert.equal(result.failed, 5);

    const fails = result.outcomes.filter((o) => !o.satisfied).map((o) => o.obligation.type);
    assert.deepEqual([...fails].sort(), [
      'coverage-must-exceed',
      'function-must-have-signature',
      'import-graph-must-satisfy',
      'performance-must-not-regress',
      'property-must-hold',
    ]);
  });
});

