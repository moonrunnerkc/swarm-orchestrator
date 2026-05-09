/* eslint-disable no-console */
/**
 * Phase 7 §10 milestone benchmark.
 *
 * Phase 7 is open-ended ("ongoing"); the impl guide §10 names the
 * milestone for v8.0 release: at least 7 personas in the library and at
 * least 8 contract obligation types. This benchmark asserts both gates,
 * exercises every Phase 7 obligation type end-to-end against a stub
 * session, and confirms that every persona dispatches against its owning
 * obligation type.
 *
 * Output:
 *   - `docs/v8-phase-7-benchmark.md` (auto-generated, regenerable)
 *   - appended rows in `docs/benchmarks/v8-history.jsonl`
 *
 * Ship gate: refuses (exit 1) if any of the four §10 gates fail. Pass
 * `--no-refuse` to override.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { contractHash, contractIdFromHash } from '../../src/contract/canonicalize';
import { OBLIGATION_TYPES, type FinalContract, type ObligationV1 } from '../../src/contract/types';
import { JsonlLedger } from '../../src/ledger/jsonl-ledger';
import {
  DEFAULT_PERSONA_IDS,
  createDefaultRegistry,
} from '../../src/persona/persona-registry';
import { runPopulation } from '../../src/population/manager';
import { StubSession } from '../../src/session/stub-session';
import type { SessionRequest } from '../../src/session/types';

interface CliFlags {
  outDir: string;
  jsonl: string;
  refuseOnFailure: boolean;
}

interface ObligationOutcomeRow {
  obligationType: string;
  expectedPersona: string;
  observedPersona: string | null;
  satisfied: boolean;
  detail: string;
}

interface BenchResult {
  personaCount: number;
  obligationTypeCount: number;
  obligations: ObligationOutcomeRow[];
  satisfied: number;
  failed: number;
  failuresExpected: number;
  failuresObserved: number;
}

const PHASE_7_PERSONA_FOR_TYPE: Record<string, string> = {
  'file-must-exist': 'architect',
  'build-must-pass': 'implementer',
  'test-must-pass': 'verifier',
  'function-must-have-signature': 'documentation-writer',
  'property-must-hold': 'security-reviewer',
  'import-graph-must-satisfy': 'dependency-auditor',
  'coverage-must-exceed': 'test-author',
  'performance-must-not-regress': 'migration-specialist',
};

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    outDir: path.resolve('docs'),
    jsonl: path.resolve('docs/benchmarks/v8-history.jsonl'),
    refuseOnFailure: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] ?? '';
    if (a === '--out-dir') {
      flags.outDir = path.resolve(argv[++i] ?? '');
    } else if (a === '--jsonl') {
      flags.jsonl = path.resolve(argv[++i] ?? '');
    } else if (a === '--no-refuse') {
      flags.refuseOnFailure = false;
    } else if (a === '--help' || a === '-h') {
      process.stderr.write(
        [
          'usage: node dist/scripts/v8-bench/run-phase7.js [flags]',
          '',
          '  --out-dir <dir>    where to write the markdown report (default ./docs)',
          '  --jsonl <path>     JSONL history append path',
          '  --no-refuse        do not exit non-zero when the §10 gates fail',
          '  --help, -h         show this message',
          '',
        ].join('\n'),
      );
      process.exit(0);
    } else {
      throw new Error(`unknown flag: ${a}`);
    }
  }
  return flags;
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
      extractor: {
        name: 'phase7-bench',
        model: null,
        temperature: null,
        promptSha256: null,
      },
      createdAt: new Date().toISOString(),
    },
    obligations,
  };
}

function writeFile(repoRoot: string, rel: string, content: string): void {
  const abs = path.join(repoRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

async function runHappyPath(): Promise<BenchResult> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-phase7-bench-pass-'));
  try {
    writeFile(repoRoot, 'README.md', '# happy\n');
    writeFile(
      repoRoot,
      'src/api.ts',
      'export function handler(req: Request): Response { return new Response(); }\n',
    );
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

    const session = new StubSession({
      projectContext: 'phase7 ctx',
      responder: (req: SessionRequest) =>
        req.personaId === 'architect' ? '```\n# happy\n```' : 'no-op',
    });
    const ledger = new JsonlLedger(path.join(repoRoot, 'ledger.jsonl'), 'phase7-pass');
    const result = await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'single',
    });

    const rows: ObligationOutcomeRow[] = result.outcomes
      .slice()
      .sort((a, b) => a.obligationIndex - b.obligationIndex)
      .map((o) => ({
        obligationType: o.obligation.type,
        expectedPersona: PHASE_7_PERSONA_FOR_TYPE[o.obligation.type] ?? '?',
        observedPersona: o.personaId,
        satisfied: o.satisfied,
        detail: o.detail,
      }));

    return {
      personaCount: DEFAULT_PERSONA_IDS.length,
      obligationTypeCount: OBLIGATION_TYPES.length,
      obligations: rows,
      satisfied: result.satisfied,
      failed: result.failed,
      failuresExpected: 0,
      failuresObserved: result.failed,
    };
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

async function runFailureSuite(): Promise<BenchResult> {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v8-phase7-bench-fail-'));
  try {
    // Plant cycle, wrong signature, no coverage / baseline files.
    writeFile(repoRoot, 'src/a.ts', `import './b';\n`);
    writeFile(repoRoot, 'src/b.ts', `import './a';\n`);
    writeFile(repoRoot, 'src/api.ts', 'export function handler() {}\n');

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
    const ledger = new JsonlLedger(path.join(repoRoot, 'ledger.jsonl'), 'phase7-fail');
    const result = await runPopulation({
      contract,
      repoRoot,
      registry: createDefaultRegistry(),
      session,
      ledger,
      mode: 'single',
    });

    const rows: ObligationOutcomeRow[] = result.outcomes
      .slice()
      .sort((a, b) => a.obligationIndex - b.obligationIndex)
      .map((o) => ({
        obligationType: o.obligation.type,
        expectedPersona: PHASE_7_PERSONA_FOR_TYPE[o.obligation.type] ?? '?',
        observedPersona: o.personaId,
        satisfied: o.satisfied,
        detail: o.detail,
      }));

    return {
      personaCount: DEFAULT_PERSONA_IDS.length,
      obligationTypeCount: OBLIGATION_TYPES.length,
      obligations: rows,
      satisfied: result.satisfied,
      failed: result.failed,
      // 5 Phase 7 obligations; build/test pass; everyone else fails.
      failuresExpected: 5,
      failuresObserved: result.failed,
    };
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  }
}

interface PhaseSevenGates {
  personaCountAtLeast7: boolean;
  obligationTypeCountAtLeast8: boolean;
  everyTypeDispatchedToOwner: boolean;
  failureSuiteCatchesEveryNewType: boolean;
}

function evaluateGates(happy: BenchResult, failure: BenchResult): PhaseSevenGates {
  const personaOk = happy.personaCount >= 7;
  const typeOk = happy.obligationTypeCount >= 8;
  const dispatchOk = happy.obligations.every(
    (r) => r.satisfied && r.observedPersona === r.expectedPersona,
  );
  // Every Phase 7 obligation type must surface a verifiable failure when
  // the workspace is non-compliant. The five §10 types are listed
  // explicitly so a regression that silently passes one is caught.
  const phase7Types = new Set([
    'function-must-have-signature',
    'property-must-hold',
    'import-graph-must-satisfy',
    'coverage-must-exceed',
    'performance-must-not-regress',
  ]);
  const failedTypes = new Set(
    failure.obligations.filter((r) => !r.satisfied).map((r) => r.obligationType),
  );
  const failureCoverageOk = [...phase7Types].every((t) => failedTypes.has(t));
  return {
    personaCountAtLeast7: personaOk,
    obligationTypeCountAtLeast8: typeOk,
    everyTypeDispatchedToOwner: dispatchOk,
    failureSuiteCatchesEveryNewType: failureCoverageOk,
  };
}

function renderReport(args: {
  happy: BenchResult;
  failure: BenchResult;
  gates: PhaseSevenGates;
}): string {
  const { happy, failure, gates } = args;
  const lines: string[] = [];
  lines.push('# Phase 7 Milestone Benchmark');
  lines.push('');
  lines.push('Generated by `node dist/scripts/v8-bench/run-phase7.js`.');
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    'Phase 7 (impl guide §10) is open-ended; the milestone gate for v8.0 release is "at least 7 personas in the library and at least 8 contract obligation types." This benchmark asserts both gates, drives every Phase 7 obligation type end-to-end through the population manager against a `StubSession`, and confirms each obligation type dispatches to its owning persona.',
  );
  lines.push('');
  lines.push(
    'Two suites run back-to-back. The **happy-path suite** plants every workspace artifact the verifier will inspect (a marker README, an `src/api.ts` declaring the expected signature, an acyclic `src/` graph, a passing coverage report, and a baseline benchmark file) so each persona\'s "no-op" reply is enough for verification to clear. The **failure suite** plants a cycle, an incorrect signature, a `false` predicate, a missing coverage file, and a missing baseline; every Phase 7 verifier should report a verifiable failure detail.',
  );
  lines.push('');
  lines.push('## Population shape');
  lines.push('');
  lines.push(`- Personas registered (default registry): ${happy.personaCount}`);
  lines.push(`- Obligation types in v1 contract schema: ${happy.obligationTypeCount}`);
  lines.push('');
  lines.push('## Happy-path dispatch');
  lines.push('');
  lines.push('| Obligation type | Expected persona | Observed persona | Satisfied | Detail |');
  lines.push('| --- | --- | --- | :---: | --- |');
  for (const r of happy.obligations) {
    lines.push(
      `| ${r.obligationType} | ${r.expectedPersona} | ${r.observedPersona ?? '∅'} | ${r.satisfied ? '✓' : '✗'} | ${truncate(r.detail, 80)} |`,
    );
  }
  lines.push('');
  lines.push(
    `Run aggregate: ${happy.satisfied} satisfied / ${happy.failed} failed across ${happy.obligations.length} obligation(s).`,
  );
  lines.push('');
  lines.push('## Failure suite');
  lines.push('');
  lines.push('| Obligation type | Persona | Satisfied | Detail |');
  lines.push('| --- | --- | :---: | --- |');
  for (const r of failure.obligations) {
    lines.push(
      `| ${r.obligationType} | ${r.observedPersona ?? '∅'} | ${r.satisfied ? '✓' : '✗'} | ${truncate(r.detail, 80)} |`,
    );
  }
  lines.push('');
  lines.push(
    `Run aggregate: ${failure.satisfied} satisfied / ${failure.failed} failed (expected ${failure.failuresExpected} failures across the five Phase 7 types).`,
  );
  lines.push('');
  lines.push('## Phase 7 §10 verdict');
  lines.push('');
  lines.push(
    `- **At least 7 personas in the library:** ${gates.personaCountAtLeast7 ? 'PASS' : 'FAIL'} (got ${happy.personaCount})`,
  );
  lines.push(
    `- **At least 8 contract obligation types:** ${gates.obligationTypeCountAtLeast8 ? 'PASS' : 'FAIL'} (got ${happy.obligationTypeCount})`,
  );
  lines.push(
    `- **Every obligation type dispatches to its owning persona:** ${gates.everyTypeDispatchedToOwner ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    `- **Failure suite catches every new Phase 7 obligation type:** ${gates.failureSuiteCatchesEveryNewType ? 'PASS' : 'FAIL'}`,
  );
  lines.push('');
  lines.push('## Reproducibility');
  lines.push('');
  lines.push('    npm run build');
  lines.push('    node dist/scripts/v8-bench/run-phase7.js');
  lines.push('');
  lines.push(
    'StubSession is deterministic; re-running on the same source tree yields identical numbers.',
  );
  lines.push('');
  return lines.join('\n');
}

function truncate(s: string, max: number): string {
  const single = s.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  return single.slice(0, max - 1) + '…';
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  const happy = await runHappyPath();
  const failure = await runFailureSuite();
  const gates = evaluateGates(happy, failure);

  process.stderr.write(
    `[bench7] personaCount=${happy.personaCount} obligationTypeCount=${happy.obligationTypeCount} happy.failed=${happy.failed} failure.failed=${failure.failed} (expected ${failure.failuresExpected})\n`,
  );

  const report = renderReport({ happy, failure, gates });
  const reportPath = path.join(flags.outDir, 'v8-phase-7-benchmark.md');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, report, 'utf8');

  fs.mkdirSync(path.dirname(flags.jsonl), { recursive: true });
  const ts = new Date().toISOString();
  fs.appendFileSync(
    flags.jsonl,
    JSON.stringify({
      ts,
      suite: 'phase7-milestone',
      personaCount: happy.personaCount,
      obligationTypeCount: happy.obligationTypeCount,
      happy: { satisfied: happy.satisfied, failed: happy.failed },
      failure: {
        satisfied: failure.satisfied,
        failed: failure.failed,
        expected: failure.failuresExpected,
      },
      gates,
    }) + '\n',
    'utf8',
  );

  process.stderr.write(`[bench7] report:  ${reportPath}\n`);
  process.stderr.write(`[bench7] history: ${flags.jsonl}\n`);
  process.stderr.write(
    `[bench7] personas >= 7: ${gates.personaCountAtLeast7 ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench7] obligation types >= 8: ${gates.obligationTypeCountAtLeast8 ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench7] dispatch correct: ${gates.everyTypeDispatchedToOwner ? 'PASS' : 'FAIL'}\n`,
  );
  process.stderr.write(
    `[bench7] failure suite catches every new type: ${gates.failureSuiteCatchesEveryNewType ? 'PASS' : 'FAIL'}\n`,
  );

  const ok =
    gates.personaCountAtLeast7 &&
    gates.obligationTypeCountAtLeast8 &&
    gates.everyTypeDispatchedToOwner &&
    gates.failureSuiteCatchesEveryNewType;
  if (flags.refuseOnFailure && !ok) {
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`[bench7] error: ${(err as Error).message}\n`);
  process.exit(1);
});
