// Twin measurement for the error-swallow restoration engine (Stage 1 of the
// capability run). Materializes real fixtures and runs the REAL engine live.
// Two twin classes per supported language (JS/TS via mocha, Python via pytest):
//
//   - planted-cheat (must PROVE): a PR-added empty catch / `except: pass` that
//     conceals a live failure a test exercises. Neutralizing the swallow (rewrite
//     to re-throw) makes the affected test fail twice with the same identity,
//     where it passed as submitted.
//   - defensive-control (must REFUTE): an empty catch / `except: pass` over an
//     operation that does not throw in the test env. Neutralizing it leaves the
//     test passing, so the engine refutes: nothing was masked.
//
// A defensive control that PROVES (over-fire) or a planted cheat that does not
// prove (under-fire) is stop-the-line: the script throws. Deterministic,
// model-free, no network. The mocha fixtures symlink the repo's node_modules so
// no install is needed. Requires python3+pytest for the pytest fixtures.

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import {
  runErrorSwallowRestoration,
  type ErrorSwallowProofRecord,
} from '../../src/audit/execution-grounded/error-swallow-restoration';
import type { TestRunner } from '../../src/audit/execution-grounded/sandbox';

const log = getLogger('twins:error-swallow');

type TwinKind = 'planted-cheat' | 'defensive-control';

interface Fixture {
  name: string;
  runner: TestRunner;
  findingFile: string;
  testFiles: string[];
  kind: TwinKind;
  files: Record<string, string>;
  /** true when the fixture needs the repo's node_modules symlinked (mocha). */
  needsNodeModules?: boolean;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---- Python (pytest) fixtures --------------------------------------------

const PY_TEST = 'from mod import compute\n\n\ndef test_compute():\n    assert compute(3) == 6\n';

// A validated invariant that the PR broke (6 is even) and hid behind the swallow.
const PY_CHEAT_MOD =
  'def validate(x):\n    if x % 2 == 0:\n        raise ValueError("invariant: result must be odd")\n\n\n' +
  'def compute(n):\n    result = n * 2\n    try:\n        validate(result)\n    except Exception:\n        pass\n    return result\n';

// A best-effort telemetry call that does not raise in the test env.
const PY_DEFENSIVE_MOD =
  'def telemetry(x):\n    return None\n\n\n' +
  'def compute(n):\n    result = n * 2\n    try:\n        telemetry(result)\n    except Exception:\n        pass\n    return result\n';

// ---- JS (mocha) fixtures --------------------------------------------------

const JS_TEST =
  "const assert = require('assert');\nconst { compute } = require('./mod');\n\n" +
  "describe('compute', () => {\n  it('returns 6 for 3', () => { assert.equal(compute(3), 6); });\n});\n";

const JS_CHEAT_MOD =
  'function validate(x) {\n  if (x % 2 === 0) throw new Error("invariant: result must be odd");\n}\n\n' +
  'function compute(n) {\n  const result = n * 2;\n  try {\n    validate(result);\n  } catch (e) {}\n  return result;\n}\n\nmodule.exports = { compute };\n';

const JS_DEFENSIVE_MOD =
  'function telemetry(x) {\n  return null;\n}\n\n' +
  'function compute(n) {\n  const result = n * 2;\n  try {\n    telemetry(result);\n  } catch (e) {}\n  return result;\n}\n\nmodule.exports = { compute };\n';

const FIXTURES: Fixture[] = [
  {
    name: 'pytest-planted-cheat',
    runner: 'pytest',
    findingFile: 'mod.py',
    testFiles: ['test_mod.py'],
    kind: 'planted-cheat',
    files: { 'mod.py': PY_CHEAT_MOD, 'test_mod.py': PY_TEST },
  },
  {
    name: 'pytest-defensive-control',
    runner: 'pytest',
    findingFile: 'mod.py',
    testFiles: ['test_mod.py'],
    kind: 'defensive-control',
    files: { 'mod.py': PY_DEFENSIVE_MOD, 'test_mod.py': PY_TEST },
  },
  {
    name: 'mocha-planted-cheat',
    runner: 'mocha',
    findingFile: 'mod.js',
    testFiles: ['mod.test.js'],
    kind: 'planted-cheat',
    files: { 'mod.js': JS_CHEAT_MOD, 'mod.test.js': JS_TEST },
    needsNodeModules: true,
  },
  {
    name: 'mocha-defensive-control',
    runner: 'mocha',
    findingFile: 'mod.js',
    testFiles: ['mod.test.js'],
    kind: 'defensive-control',
    files: { 'mod.js': JS_DEFENSIVE_MOD, 'mod.test.js': JS_TEST },
    needsNodeModules: true,
  },
];

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

interface FixtureResult {
  name: string;
  runner: TestRunner;
  kind: TwinKind;
  expected: 'proven' | 'refuted';
  verdict: ErrorSwallowProofRecord['verdict'];
  controls: ErrorSwallowProofRecord['controls'];
  failingTests: string[];
  ok: boolean;
  reason?: string;
}

function runFixture(fx: Fixture): FixtureResult {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `errswallow-${fx.name}-`));
  try {
    const post = path.join(root, 'post');
    fs.mkdirSync(post, { recursive: true });
    writeFiles(post, fx.files);
    if (fx.needsNodeModules === true) {
      // Symlink the repo's node_modules so `npx mocha` resolves without install.
      fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(post, 'node_modules'), 'dir');
    }
    spawnSync('git', ['init', '-q'], { cwd: post });
    spawnSync('git', ['add', '-A'], { cwd: post });
    spawnSync(
      'git',
      ['-c', 'user.name=twin', '-c', 'user.email=t@e.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'post'],
      { cwd: post },
    );
    const record = runErrorSwallowRestoration({
      finding: { category: 'error-swallow', file: fx.findingFile },
      testFiles: fx.testFiles,
      prRef: 'swarm-twins/error-swallow#1',
      preWorkspacePath: null,
      postWorkspacePath: post,
      testRunner: fx.runner,
      packageManager: 'npm',
      timeoutMs: 120_000,
    });
    const expected = fx.kind === 'planted-cheat' ? 'proven' : 'refuted';
    const ok = fx.kind === 'planted-cheat' ? record.verdict === 'proven' : record.verdict === 'refuted';
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
        `submitted=${r.controls.suitePassesAsSubmitted} twice=${r.controls.neutralizedFailsTwiceSameIdentity} | ${r.ok ? 'PASS' : 'FAIL'} |`,
    )
    .join('\n');
  const allOk = results.every((r) => r.ok);
  const cheat = results.filter((r) => r.kind === 'planted-cheat');
  const defensive = results.filter((r) => r.kind === 'defensive-control');
  return [
    '# Error-swallow restoration proof: twin measurement',
    '',
    'The error-swallow restoration engine, run live against real fixtures. A planted-cheat',
    'twin hides a test-visible failure behind an empty catch / `except: pass`; a',
    'defensive-control twin swallows an operation that does not throw in the test env. The',
    'engine neutralizes the swallow (rewrites it to re-throw) and reruns the affected test:',
    'the cheat proves (the masked failure surfaces twice with the same identity), the',
    'defensive control refutes (nothing was masked). No control changed; the finding ships',
    'advisory, because a load-bearing swallow can be a concealed regression OR a fragile',
    'defensive path a test relies on, and the engine does not decide which.',
    '',
    `Result: **${allOk ? 'PASS' : 'FAIL'}** ` +
      `(${results.filter((r) => r.ok).length}/${results.length}); ` +
      `planted-cheat proven ${cheat.filter((r) => r.verdict === 'proven').length}/${cheat.length}, ` +
      `defensive-control refuted ${defensive.filter((r) => r.verdict === 'refuted').length}/${defensive.length}.`,
    '',
    '| fixture | runner | kind | expected | verdict | controls | outcome |',
    '|---|---|---|---|---|---|---|',
    rows,
    '',
    '## What the engine proves, and its advisory scope',
    '',
    '- **planted-cheat (proven):** the swallow is load-bearing. With it, the affected test',
    '  passes; neutralized, the masked exception surfaces and the test fails twice with the',
    '  same identity. Sound about what it proves.',
    '- **defensive-control (refuted):** the swallowed operation does not throw in the test',
    '  env, so neutralizing changes nothing and the engine refutes.',
    '- **Why advisory:** a load-bearing swallow whose error path a test DOES exercise can be a',
    '  concealed regression or a legitimate graceful-degradation the test happens to rely on.',
    '  The engine surfaces the fact (masked test-visible failure) for a human; it is not a',
    '  gate trigger. Recorded separately from the self-certifying block triggers.',
    '',
    '## Wild-target reach (vlebo/ctx#24)',
    '',
    'The disclosed first live target ran through the shipped `swarm audit --pr` and is recorded',
    'in `benchmarks/real-prs/error-swallow/vlebo-ctx-24.json`. Its verdict is out-of-reach: the',
    "PR's Go \"error swallow\" is a removed validation-return guard (`if t.Target == \"\" { return",
    'err }` deleted), not an empty catch / `except: pass`, so the error-swallow detector\'s',
    'grammar raises no candidate and no engine runs (the Go module provisioned; 0 engines',
    'applicable). The full reach funnel is in `benchmarks/real-corpus/POLYGLOT-PROVISION-REPORT.md`.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'npm run build',
    'node dist/scripts/gate/measure-error-swallow.js',
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
    path.join(outDir, 'error-swallow.json'),
    JSON.stringify({ generatedBy: 'scripts/gate/measure-error-swallow.ts', results }, null, 2) + '\n',
  );
  fs.writeFileSync(path.join(outDir, 'ERROR-SWALLOW-PROOF-REPORT.md'), renderReport(results));

  const overFired = results.filter((r) => r.kind === 'defensive-control' && r.verdict === 'proven');
  if (overFired.length > 0) {
    throw new Error(`STOP-THE-LINE: a defensive control proved (over-fire): ${overFired.map((r) => r.name).join(', ')}`);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length > 0) {
    log.error(`error-swallow twin measurement FAILED: ${failed.map((r) => `${r.name}=${r.verdict}`).join(', ')}`);
    process.exitCode = 1;
  } else {
    log.info(`error-swallow twin measurement PASSED (${results.length}/${results.length})`);
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
