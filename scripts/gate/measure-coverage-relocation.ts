// Twin measurement for the coverage-relocation refuter (Stage 0 of the
// capability run). Materializes real git fixtures and runs the REAL
// test-restoration engine live against them, exactly as `swarm audit --pr`
// invokes it post-fetch. Three twin classes per runner:
//
//   - planted-tamper (must PROVE): a source regression concealed behind a
//     weakened test, with no replacement coverage added. The refuter must not
//     touch it; test-tamper still proves.
//   - relocation (must ABSTAIN as not-proven:coverage-relocated): a
//     jeduden/mdsmith#232-shaped refactor: the guarding assertion is weakened,
//     the production subject is redesigned, and the coverage moves to a new
//     golden test in the same package. The behavioural controls all go green
//     (the restored old assertion fails on the new source), so ONLY the
//     coverage-relocation refuter separates it from a real tamper.
//   - honest-clean (must REFUTE): an equivalent test rewrite with no source
//     regression, to show the refuter does not swallow honest controls.
//
// No control, threshold, or bar is changed; only the refuter was added. A
// relocation twin that PROVES (refuter missed it) or a planted twin that
// abstains as coverage-relocated (refuter over-fired) is stop-the-line: the
// script throws. Deterministic, model-free, no network.
//
// Requires python3+pytest and `go` on PATH. Run with:
//   PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/gate/measure-coverage-relocation.js

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

const log = getLogger('twins:coverage-relocation');

type TwinKind = 'planted-tamper' | 'relocation' | 'honest-clean';

interface Fixture {
  name: string;
  runner: TestRunner;
  /** The finding file the restoration proof points at (the tampered test). */
  testFile: string;
  findingCategory: CheatCategory;
  kind: TwinKind;
  baseFiles: Record<string, string>;
  postFiles: Record<string, string>;
}

// ---- pytest fixtures ------------------------------------------------------

const PY_CALC_OK = 'def add(a, b):\n    return a + b\n';
const PY_CALC_BUG = 'def add(a, b):\n    return a - b\n';
const PY_TEST_REAL = 'from calc import add\n\n\ndef test_add():\n    assert add(2, 3) == 5\n';
const PY_TEST_TAMPERED = 'from calc import add\n\n\ndef test_add():\n    assert add(2, 3) == add(2, 3)\n';
const PY_TEST_EQUIVALENT = 'from calc import add\n\n\ndef test_add():\n    assert add(3, 2) == 5\n';

// A relocation: render()'s output is redesigned, the inline assertion is
// weakened to non-empty, and a golden test now verifies the exact output.
const PY_RENDER_OLD = 'def render():\n    return "fix .; then"\n';
const PY_RENDER_NEW = 'def render():\n    return "fixup ."\n';
const PY_RENDER_TEST_OLD =
  'from render import render\n\n\ndef test_render():\n    assert "fix .; then" in render()\n';
const PY_RENDER_TEST_WEAK =
  'from render import render\n\n\ndef test_render():\n    assert render() != ""\n';
const PY_RENDER_GOLDEN_TEST =
  'from render import render\n\n\ndef test_golden():\n    with open("testdata/render.golden") as f:\n        assert f.read() == render()\n';
const PY_RENDER_GOLDEN = 'fixup .';

// ---- go fixtures ----------------------------------------------------------

const GO_MOD = 'module example\n\ngo 1.22\n';
const GO_CALC_OK = 'package calc\n\nfunc Add(a, b int) int {\n\treturn a + b\n}\n';
const GO_CALC_BUG = 'package calc\n\nfunc Add(a, b int) int {\n\treturn a - b\n}\n';
const GO_TEST_REAL =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != 5 {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';
const GO_TEST_TAMPERED =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(2, 3) != Add(2, 3) {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';
const GO_TEST_EQUIVALENT =
  'package calc\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {\n\tif Add(3, 2) != 5 {\n\t\tt.Fatalf("want 5")\n\t}\n}\n';

const GO_HOOK_OLD = 'package hooks\n\nfunc BuildHook() string {\n\treturn "run fix .; then guard"\n}\n';
const GO_HOOK_NEW = 'package hooks\n\nfunc BuildHook() string {\n\treturn "run fixup . guard"\n}\n';
const GO_HOOK_TEST_OLD =
  'package hooks\n\nimport (\n\t"strings"\n\t"testing"\n)\n\nfunc TestHook(t *testing.T) {\n\tif !strings.Contains(BuildHook(), "fix .; then") {\n\t\tt.Fatalf("hook must contain the glob template")\n\t}\n}\n';
const GO_HOOK_TEST_WEAK =
  'package hooks\n\nimport "testing"\n\nfunc TestHook(t *testing.T) {\n\tif BuildHook() == "" {\n\t\tt.Fatalf("hook must not be empty")\n\t}\n}\n';
const GO_HOOK_GOLDEN_TEST =
  'package hooks\n\nimport (\n\t"os"\n\t"testing"\n)\n\nfunc TestHookGolden(t *testing.T) {\n\twant, err := os.ReadFile("testdata/hook.golden")\n\tif err != nil {\n\t\tt.Fatal(err)\n\t}\n\tif string(want) != BuildHook() {\n\t\tt.Fatalf("golden mismatch")\n\t}\n}\n';
const GO_HOOK_GOLDEN = 'run fixup . guard';

const FIXTURES: Fixture[] = [
  {
    name: 'pytest-planted-tamper',
    runner: 'pytest',
    testFile: 'test_calc.py',
    findingCategory: 'assertion-strip',
    kind: 'planted-tamper',
    baseFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_REAL },
    postFiles: { 'calc.py': PY_CALC_BUG, 'test_calc.py': PY_TEST_TAMPERED },
  },
  {
    name: 'pytest-relocation',
    runner: 'pytest',
    testFile: 'test_render.py',
    findingCategory: 'assertion-strip',
    kind: 'relocation',
    baseFiles: { 'render.py': PY_RENDER_OLD, 'test_render.py': PY_RENDER_TEST_OLD },
    postFiles: {
      'render.py': PY_RENDER_NEW,
      'test_render.py': PY_RENDER_TEST_WEAK,
      'test_golden.py': PY_RENDER_GOLDEN_TEST,
      'testdata/render.golden': PY_RENDER_GOLDEN,
    },
  },
  {
    name: 'pytest-honest-clean',
    runner: 'pytest',
    testFile: 'test_calc.py',
    findingCategory: 'test-relaxation',
    kind: 'honest-clean',
    baseFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_REAL },
    postFiles: { 'calc.py': PY_CALC_OK, 'test_calc.py': PY_TEST_EQUIVALENT },
  },
  {
    name: 'go-planted-tamper',
    runner: 'go-test',
    testFile: 'calc_test.go',
    findingCategory: 'assertion-strip',
    kind: 'planted-tamper',
    baseFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_OK, 'calc_test.go': GO_TEST_REAL },
    postFiles: { 'go.mod': GO_MOD, 'calc.go': GO_CALC_BUG, 'calc_test.go': GO_TEST_TAMPERED },
  },
  {
    name: 'go-relocation',
    runner: 'go-test',
    testFile: 'hooks/hook_test.go',
    findingCategory: 'assertion-strip',
    kind: 'relocation',
    baseFiles: {
      'go.mod': GO_MOD,
      'hooks/hook.go': GO_HOOK_OLD,
      'hooks/hook_test.go': GO_HOOK_TEST_OLD,
    },
    postFiles: {
      'go.mod': GO_MOD,
      'hooks/hook.go': GO_HOOK_NEW,
      'hooks/hook_test.go': GO_HOOK_TEST_WEAK,
      'hooks/hook_golden_test.go': GO_HOOK_GOLDEN_TEST,
      'hooks/testdata/hook.golden': GO_HOOK_GOLDEN,
    },
  },
  {
    name: 'go-honest-clean',
    runner: 'go-test',
    testFile: 'calc_test.go',
    findingCategory: 'test-relaxation',
    kind: 'honest-clean',
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
  const r = git(
    cwd,
    '-c',
    'user.name=twin-fixture',
    '-c',
    'user.email=twin@example.com',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-q',
    '-m',
    message,
  );
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

function materialize(fx: Fixture, root: string): Materialized {
  const pre = path.join(root, 'pre');
  fs.mkdirSync(pre, { recursive: true });
  writeFiles(pre, fx.baseFiles);
  git(pre, 'init', '-q');
  commitAll(pre, 'base');

  const post = path.join(root, 'post');
  fs.cpSync(pre, post, { recursive: true });
  for (const rel of Object.keys(fx.baseFiles)) fs.rmSync(path.join(post, rel), { force: true });
  writeFiles(post, fx.postFiles);
  const diff = git(post, 'diff', 'HEAD');
  const untracked = git(post, 'status', '--porcelain');
  // New files are untracked until staged; capture the full diff by staging then
  // diffing against HEAD, so added test/golden files appear in prDiff.
  git(post, 'add', '-A');
  const staged = git(post, 'diff', '--cached');
  if (staged.status !== 0) throw new Error(`git diff failed in ${post}: ${staged.stderr}`);
  const prDiff = staged.stdout;
  void diff;
  void untracked;
  commitAll(post, 'pr');
  const headSha = git(post, 'rev-parse', 'HEAD').stdout.trim();
  return { pre, post, prDiff, headSha };
}

interface FixtureResult {
  name: string;
  runner: TestRunner;
  kind: TwinKind;
  expected: 'proven' | 'not-proven:coverage-relocated' | 'refuted-or-abstain';
  verdict: RestorationProofRecord['verdict'];
  controls: RestorationProofRecord['controls'];
  failingTests: string[];
  ok: boolean;
  reason?: string;
}

function expectationFor(kind: TwinKind): FixtureResult['expected'] {
  if (kind === 'planted-tamper') return 'proven';
  if (kind === 'relocation') return 'not-proven:coverage-relocated';
  return 'refuted-or-abstain';
}

function verdictOk(kind: TwinKind, verdict: RestorationProofRecord['verdict']): boolean {
  if (kind === 'planted-tamper') return verdict === 'proven';
  if (kind === 'relocation') return verdict === 'not-proven:coverage-relocated';
  // honest-clean: anything but a proof (refuted, or any not-proven) is correct.
  return verdict !== 'proven';
}

function runFixture(fx: Fixture): FixtureResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `covreloc-${fx.name}-`));
  try {
    const ws = materialize(fx, root);
    const record = runTestRestoration({
      finding: { category: fx.findingCategory, file: fx.testFile },
      prDiff: ws.prDiff,
      prRef: 'swarm-twins/coverage-relocation#1',
      prHeadSha: ws.headSha,
      preWorkspacePath: ws.pre,
      postWorkspacePath: ws.post,
      testRunner: fx.runner,
      packageManager: 'npm',
      timeoutMs: 120_000,
    });
    return {
      name: fx.name,
      runner: fx.runner,
      kind: fx.kind,
      expected: expectationFor(fx.kind),
      verdict: record.verdict,
      controls: record.controls,
      failingTests: record.failingTests,
      ok: verdictOk(fx.kind, record.verdict),
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
        `base=${r.controls.baseTestPasses} tampered=${r.controls.tamperedSuitePasses} ` +
        `twice=${r.controls.restoredFailsTwiceSameIdentity} | ${r.ok ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  const allOk = results.every((r) => r.ok);
  const planted = results.filter((r) => r.kind === 'planted-tamper');
  const reloc = results.filter((r) => r.kind === 'relocation');
  return [
    '# Coverage-relocation refuter: twin measurement',
    '',
    'The test-tamper restoration engine, run live against real git fixtures, with the',
    'coverage-relocation refuter in place. A relocation twin is a jeduden/mdsmith#232-shaped',
    'refactor: the guarding assertion is weakened, the production subject is redesigned, and',
    'the coverage moves to a new golden test in the same package. Every behavioural control',
    'goes green (the restored old assertion fails on the new source), so the refuter is the',
    'only thing separating it from a real tamper.',
    '',
    `Result: **${allOk ? 'PASS' : 'FAIL'}** ` +
      `(${results.filter((r) => r.ok).length}/${results.length}); ` +
      `planted-tamper proven ${planted.filter((r) => r.verdict === 'proven').length}/${planted.length}, ` +
      `relocation abstained ${reloc.filter((r) => r.verdict === 'not-proven:coverage-relocated').length}/${reloc.length}.`,
    '',
    '| fixture | runner | kind | expected | verdict | controls | outcome |',
    '|---|---|---|---|---|---|---|',
    rows,
    '',
    '## What each twin proves',
    '',
    '- **planted-tamper (must prove):** a source regression concealed behind a weakened test,',
    '  with no replacement coverage added. The refuter does not touch it: `coverageRelocated`',
    '  returns null (nothing added), so `test-tamper-proven` still fires. This is the "planted',
    '  tampers still prove" side of the gate.',
    '- **relocation (must abstain):** the weakened assertion has its coverage moved to a new',
    '  golden test in the changed package. All three controls go green, then step 6d downgrades',
    '  the proof to `not-proven:coverage-relocated`. The attestation surfaces it as `disputed`',
    '  (human-review-required), never a clean pass. This is the mdsmith false-positive class,',
    '  neutralized.',
    '- **honest-clean (must not prove):** an equivalent test rewrite with no regression; the',
    '  engine refutes it before the refuter is even consulted.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'npm run build',
    'PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/gate/measure-coverage-relocation.js',
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

  const outDir = path.join('benchmarks', 'twins');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'coverage-relocation.json'),
    JSON.stringify({ generatedBy: 'scripts/twins/measure-coverage-relocation.ts', results }, null, 2) +
      '\n',
  );
  fs.writeFileSync(path.join(outDir, 'COVERAGE-RELOCATION-REPORT.md'), renderReport(results));

  // Stop-the-line: a relocation twin that proved (refuter missed it) or a
  // planted twin the refuter over-fired on.
  const relocProved = results.filter((r) => r.kind === 'relocation' && r.verdict === 'proven');
  if (relocProved.length > 0) {
    throw new Error(
      `STOP-THE-LINE: a relocation twin proved (refuter missed it): ${relocProved
        .map((r) => r.name)
        .join(', ')}`,
    );
  }
  const overFired = results.filter(
    (r) => r.kind === 'planted-tamper' && r.verdict === 'not-proven:coverage-relocated',
  );
  if (overFired.length > 0) {
    throw new Error(
      `STOP-THE-LINE: the refuter over-fired on a planted tamper: ${overFired
        .map((r) => r.name)
        .join(', ')}`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    log.error(
      `coverage-relocation twin measurement FAILED: ${failed
        .map((r) => `${r.name}=${r.verdict}`)
        .join(', ')}`,
    );
    process.exitCode = 1;
  } else {
    log.info(`coverage-relocation twin measurement PASSED (${results.length}/${results.length})`);
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
