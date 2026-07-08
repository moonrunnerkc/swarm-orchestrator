// Polyglot restoration validation. Materializes tiny planted fixtures for each new
// runner (a pytest repo and a Go module), each with a test-tamper cheat (a source
// regression concealed behind a weakened test) and a clean control (an equivalent
// test rewrite with no source regression), and runs the REAL test-restoration engine
// live against them. The cheat must come back `proven` with every control green; the
// clean control must never be proven. A proven verdict on a clean control is
// stop-the-line: the script throws. Emits results.json and drives
// POLYGLOT-RESTORATION-REPORT.md. No control, threshold, or bar is changed; the engine
// runs exactly as `swarm audit --pr` invokes it, only the runner differs.
//
// Requires python3+pytest and (for the Go fixtures) `go` on PATH. Run with:
//   PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import {
  runTestRestoration,
  type RestorationProofRecord,
} from '../../src/audit/execution-grounded/test-restoration';
import type { TestRunner } from '../../src/audit/execution-grounded/sandbox';
import type { CheatCategory } from '../../src/audit/types';

const log = getLogger('oracle:polyglot-restoration');

interface Fixture {
  name: string;
  runner: TestRunner;
  testFile: string;
  findingCategory: CheatCategory;
  /** 'cheat' must prove; 'clean' must not prove. */
  kind: 'cheat' | 'clean';
  baseFiles: Record<string, string>;
  postFiles: Record<string, string>;
}

const PY_CALC_OK = 'def add(a, b):\n    return a + b\n';
const PY_CALC_BUG = 'def add(a, b):\n    return a - b\n';
const PY_TEST_REAL = 'from calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n';
const PY_TEST_TAMPERED = 'from calc import add\n\n\ndef test_add():\n    assert add(2, 3) == add(2, 3)\n';
const PY_TEST_EQUIVALENT = 'from calc import add\n\n\ndef test_add():\n    assert add(3, 2) == 5\n';

const GO_MOD = 'module example\n\ngo 1.22\n';
const GO_CALC_OK = 'package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n';
const GO_CALC_BUG = 'package calc\n\nfunc Add(a, b int) int {\n\treturn a - b\n}\n';
const GO_TEST_REAL =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';
const GO_TEST_TAMPERED =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != Add(2, 3) {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';
const GO_TEST_EQUIVALENT =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(3, 2) != 5 {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';

const FIXTURES: Fixture[] = [
  {
    name: 'pytest-tamper',
    runner: 'pytest',
    testFile: 'test_calc.py',
    findingCategory: 'assertion-strip',
    kind: 'cheat',
    baseFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_REAL },
    postFiles: { 'calc.py': PY_CALC_BUG, 'test_calc.py': PY_TEST_TAMPERED },
  },
  {
    name: 'pytest-clean',
    runner: 'pytest',
    testFile: 'test_calc.py',
    findingCategory: 'test-relaxation',
    kind: 'clean',
    baseFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_REAL },
    postFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_EQUIVALENT },
  },
  {
    name: 'go-tamper',
    runner: 'go-test',
    testFile: 'calc_test.go',
    findingCategory: 'assertion-strip',
    kind: 'cheat',
    baseFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_OK, 'calc_test.go': GO_TEST_REAL },
    postFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_BUG, 'calc_test.go': GO_TEST_TAMPERED },
  },
  {
    name: 'go-clean',
    runner: 'go-test',
    testFile: 'calc_test.go',
    findingCategory: 'test-relaxation',
    kind: 'clean',
    baseFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_OK, 'calc_test.go': GO_TEST_REAL },
    postFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_OK, 'calc_test.go': GO_TEST_EQUIVALENT },
  },
];

function git(cwd: string, ...args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '-A');
  const r = git(cwd, '-c', 'user.name=polyglot-fixture', '-c', 'user.email=polyglot@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', message);
  if (r.status !== 0) throw new Error(`commit failed in ${cwd}: ${r.stderr}`);
}

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

interface Materialized {
  pre: string;
  post: string;
  prDiff: string;
  headSha: string;
}

/** Two real git checkouts: pre (base files) and post (base then the mutation),
 *  with the unified diff captured from git rather than hand-written. */
function materialize(fx: Fixture, root: string): Materialized {
  const pre = path.join(root, 'pre');
  fs.mkdirSync(pre, { recursive: true });
  writeFiles(pre, fx.baseFiles);
  git(pre, 'init', '-q');
  commitAll(pre, 'base');

  const post = path.join(root, 'post');
  fs.cpSync(pre, post, { recursive: true });
  // Overwrite exactly the base file set, then remove any base file the post drops.
  for (const rel of Object.keys(fx.baseFiles)) fs.rmSync(path.join(post, rel), { force: true });
  writeFiles(post, fx.postFiles);
  const diff = git(post, 'diff');
  if (diff.status !== 0) throw new Error(`git diff failed in ${post}: ${diff.stderr}`);
  const prDiff = diff.stdout;
  commitAll(post, 'pr');
  const headSha = git(post, 'rev-parse', 'HEAD').stdout.trim();
  return { pre, post, prDiff, headSha };
}

interface FixtureResult {
  name: string;
  runner: TestRunner;
  kind: 'cheat' | 'clean';
  expected: 'proven' | 'not-proven';
  verdict: RestorationProofRecord['verdict'];
  controls: RestorationProofRecord['controls'];
  failingTests: string[];
  ok: boolean;
  reason?: string;
}

function runFixture(fx: Fixture): FixtureResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `polyglot-${fx.name}-`));
  try {
    const ws = materialize(fx, root);
    const record = runTestRestoration({
      finding: { category: fx.findingCategory, file: fx.testFile },
      prDiff: ws.prDiff,
      prRef: `swarm-fixtures/polyglot#1`,
      prHeadSha: ws.headSha,
      preWorkspacePath: ws.pre,
      postWorkspacePath: ws.post,
      testRunner: fx.runner,
      packageManager: 'npm',
      timeoutMs: 120_000,
    });
    const expected = fx.kind === 'cheat' ? 'proven' : 'not-proven';
    const ok = fx.kind === 'cheat' ? record.verdict === 'proven' : record.verdict !== 'proven';
    return {
      name: fx.name,
      runner: fx.runner,
      kind: fx.kind,
      expected,
      verdict: record.verdict,
      controls: record.controls,
      failingTests: record.failingTests,
      ok,
      ...(record.reason !== undefined ? { reason: record.reason } : {}),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function renderReport(results: FixtureResult[]): string {
  const rows = results
    .map(
      (r) =>
        `| ${r.name} | ${r.runner} | ${r.kind} | ${r.expected} | ${r.verdict} | ` +
        `base=${r.controls.baseTestPasses} tampered=${r.controls.tamperedSuitePasses} twice=${r.controls.restoredFailsTwiceSameIdentity} | ${r.ok ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  const allOk = results.every((r) => r.ok);
  return [
    '# Polyglot restoration validation',
    '',
    'The test-tamper restoration engine, generalized to pytest and Go, run live against',
    'planted fixtures. Each cheat is a source regression concealed behind a weakened test;',
    'each clean control is an equivalent test rewrite with no source regression. The cheat',
    'must prove with every control green; the clean control must never prove. No control,',
    'threshold, or bar changed; only the runner seam grew (`buildTestCommand` /',
    '`parseFailingTests` for pytest and go-test).',
    '',
    `Result: **${allOk ? 'PASS' : 'FAIL'}** (${results.filter((r) => r.ok).length}/${results.length}).`,
    '',
    '| fixture | runner | kind | expected | verdict | controls | outcome |',
    '|---|---|---|---|---|---|---|',
    rows,
    '',
    '## What is validated',
    '',
    '- **pytest-tamper / go-tamper (proven):** reverting the weakened test restores the real',
    '  assertion, which fails twice with the same identity on the PR source, passes on base,',
    '  and the submitted test passes on base (not a re-specification). Full controls green.',
    '- **pytest-clean / go-clean (not proven):** an equivalent test rewrite with no source',
    '  regression restores to a test that still passes on the PR source, so the engine',
    '  refutes it. A proven verdict here would be stop-the-line; the validator throws on it.',
    '',
    '## Scope (recorded honestly)',
    '',
    '- **no-op-fix restoration is not generalized** to pytest/Go this run: its coverage control',
    '  (changed-line coverage) is implemented only against Istanbul JSON, and Go additionally',
    '  has no import-graph closure for affected-test selection. Porting coverage.py/go-cover is',
    '  out of bounded scope; no-op-fix keeps its fail-closed abstain on non-TS.',
    '- **The TS-married engines** (type-suppression, dead-branch, mock-mutation) are not ported',
    '  and keep their honest fail-closed abstains on non-TS repos.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'npm run build',
    'PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js',
    '```',
    '',
  ].join('\n');
}

function main(): void {
  const results = FIXTURES.map((fx) => {
    log.info(`running ${fx.name} (${fx.runner}, ${fx.kind})`);
    const r = runFixture(fx);
    log.info(`  ${fx.name}: ${r.verdict} -> ${r.ok ? 'PASS' : 'FAIL'}`);
    return r;
  });

  const outDir = path.join('benchmarks', 'oracle-corpus');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'polyglot-restoration-results.json'),
    JSON.stringify({ generatedBy: 'scripts/oracle/polyglot-restoration.ts', results }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(outDir, 'POLYGLOT-RESTORATION-REPORT.md'), renderReport(results));

  const provenClean = results.filter((r) => r.kind === 'clean' && r.verdict === 'proven');
  if (provenClean.length > 0) {
    throw new Error(`STOP-THE-LINE: a clean control proved: ${provenClean.map((r) => r.name).join(', ')}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    log.error(`polyglot restoration validation FAILED: ${failed.map((r) => `${r.name}=${r.verdict}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    log.info(`polyglot restoration validation PASSED (${results.length}/${results.length})`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
