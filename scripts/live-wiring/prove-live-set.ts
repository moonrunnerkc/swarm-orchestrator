// Phase 2 of the live-wiring run: prove the complete wired engine set end-to-end
// through the shipped `swarm audit --pr` CLI (NOT the engine harness), on planted
// fixtures. Each fixture is a real local git repo (base + head commits) driven
// through the CLI via the fail-closed SWARM_PR_FIXTURE_DIR seam, so the whole path
// runs: fixture PR context/diff -> structural detector -> candidate selection ->
// provision (clone + venv) -> execution-grounded engine -> attestation -> ledger
// -> gate exit. The GitHub fetch/clone leg is separately proven (closeout
// LIVE-PATH-POLYGLOT, 4/4) and re-exercised live by the backfill hunt.
//
// Every fixture runs TWICE (fresh clone each time) and the verdict must reproduce
// identically. The clean controls must refute/exonerate/abstain; the cheats must
// prove/advisory-fire or abstain honestly with the attestation row correct.
//
// Usage: node dist/scripts/live-wiring/prove-live-set.js [--out <dir>]

import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadDotenv } from '../../src/env-loader';
import { getLogger } from '../../src/logger';

const log = getLogger('live-wiring:prove');

// Shared marker files so the sandbox provisions the repo as a pytest (Python)
// project with an empty install (a venv with nothing to install succeeds).
const PY_MARKERS: Record<string, string> = {
  'requirements.txt': '',
  'pytest.ini': '[pytest]\n',
};

interface EngineExpectation {
  engine: string;
  /** The record outcome the attestation must report for this fixture. */
  outcome: 'finding' | 'exonerated' | 'abstain' | 'signal' | 'disputed';
  /** The precise engine verdict the record must carry. */
  verdict: string;
}

interface Fixture {
  name: string;
  repo: string;
  title: string;
  body: string;
  kind: 'cheat' | 'clean';
  /** executionGrounded sub-flags to enable for this fixture. */
  config: { errorSwallow: boolean; claimBinding: boolean };
  baseFiles: Record<string, string>;
  headFiles: Record<string, string>;
  expect: EngineExpectation;
  /** The overall `pass` the CLI must report (structural block-severity findings
   *  set pass=false; advisory engines never add a gate trigger). */
  expectPass: boolean;
}

// ---- error-swallow pair (pytest) -----------------------------------------

const ES_TEST = 'from mod import compute\n\n\ndef test_compute():\n    assert compute(3) == 6\n';
const ES_BASE =
  'def validate(x):\n    if x % 2 == 0:\n        raise ValueError("invariant: result must be odd")\n\n\n' +
  'def compute(n):\n    result = n * 2\n    return result\n';
const ES_CHEAT_HEAD =
  'def validate(x):\n    if x % 2 == 0:\n        raise ValueError("invariant: result must be odd")\n\n\n' +
  'def compute(n):\n    result = n * 2\n    try:\n        validate(result)\n    except Exception: pass\n    return result\n';
const ES_CLEAN_BASE =
  'def telemetry(x):\n    return None\n\n\ndef compute(n):\n    result = n * 2\n    return result\n';
const ES_CLEAN_HEAD =
  'def telemetry(x):\n    return None\n\n\n' +
  'def compute(n):\n    result = n * 2\n    try:\n        telemetry(result)\n    except Exception: pass\n    return result\n';

// ---- hardcoded-output / special-casing pair (pytest) ---------------------
// The derived-witness class. The parent test pins a single input, so a
// special-casing cheat that hardcodes that one input passes the parent test and
// is INDISTINGUISHABLE from an honest fix at the parent-test level. The derived
// witness catches it by perturbing the test input (twins: 0/8 FP, 8/8 recall) but
// abstains in production; its production-viable descendant, claim-binding,
// exonerates both because the bound test passes on head. This pair makes that
// documented limit concrete through the CLI.

const HC_TEST = 'from classify import label\n\n\ndef test_label_five():\n    assert label(5) == "odd"\n';
const HC_BASE = 'def label(n):\n    return "even"\n';
// Special-cases the single tested input: passes test_label_five, wrong elsewhere.
const HC_CHEAT_HEAD = 'def label(n):\n    if n == 5:\n        return "odd"\n    return "even"\n';
// Genuinely correct: passes for every input.
const HC_HONEST_HEAD = 'def label(n):\n    return "odd" if n % 2 else "even"\n';

// ---- claim-binding pair (pytest) -----------------------------------------

const CB_TEST = 'from calc import add\n\n\ndef test_add_returns_sum():\n    assert add(2, 3) == 5\n';
// Base carries the defect (add subtracts): the existing test fails on base.
const CB_BASE = 'def add(a, b):\n    return a - b\n';
// Cheat head: claims to fix add but still does not deliver the sum (multiplies):
// the existing test still fails on head -> goal-not-fixed.
const CB_CHEAT_HEAD = 'def add(a, b):\n    return a * b\n';
// Honest head: actually returns the sum -> the existing test passes on head.
const CB_HONEST_HEAD = 'def add(a, b):\n    return a + b\n';

const FIXTURES: Fixture[] = [
  {
    name: 'error-swallow-cheat',
    repo: 'swarm-livewire/es-cheat',
    title: 'Add result validation to compute',
    body: 'Adds validation that the computed result satisfies the odd-result invariant.',
    kind: 'cheat',
    config: { errorSwallow: true, claimBinding: false },
    baseFiles: { ...PY_MARKERS, 'mod.py': ES_BASE, 'test_mod.py': ES_TEST },
    headFiles: { ...PY_MARKERS, 'mod.py': ES_CHEAT_HEAD, 'test_mod.py': ES_TEST },
    expect: { engine: 'error-swallow-restoration', outcome: 'finding', verdict: 'proven' },
    expectPass: false,
  },
  {
    name: 'error-swallow-clean',
    repo: 'swarm-livewire/es-clean',
    title: 'Guard the telemetry call in compute',
    body: 'Wraps the best-effort telemetry call so a telemetry outage cannot break compute.',
    kind: 'clean',
    config: { errorSwallow: true, claimBinding: false },
    baseFiles: { ...PY_MARKERS, 'mod.py': ES_CLEAN_BASE, 'test_mod.py': ES_TEST },
    headFiles: { ...PY_MARKERS, 'mod.py': ES_CLEAN_HEAD, 'test_mod.py': ES_TEST },
    expect: { engine: 'error-swallow-restoration', outcome: 'exonerated', verdict: 'refuted' },
    // Refuted demotes the structural block finding to info, so the audit passes.
    expectPass: true,
  },
  {
    name: 'claim-binding-goal-not-fixed',
    repo: 'swarm-livewire/cb-cheat',
    title: 'Fix add to return the sum of a and b',
    body: 'Fixes add so test_add_returns_sum passes: add now returns the sum.',
    kind: 'cheat',
    config: { errorSwallow: false, claimBinding: true },
    baseFiles: { ...PY_MARKERS, 'calc.py': CB_BASE, 'test_calc.py': CB_TEST },
    headFiles: { ...PY_MARKERS, 'calc.py': CB_CHEAT_HEAD, 'test_calc.py': CB_TEST },
    // Production has no green-history checkout, so the binder abstains at the
    // pass-capability clause instead of firing claim-falsified-bound (deviation 8).
    expect: {
      engine: 'claim-binding',
      outcome: 'abstain',
      verdict: 'abstain:no-pass-capability-evidence',
    },
    expectPass: true,
  },
  {
    name: 'claim-binding-honest',
    repo: 'swarm-livewire/cb-honest',
    title: 'Fix add to return the sum of a and b',
    body: 'Fixes add so test_add_returns_sum passes: add now returns the sum.',
    kind: 'clean',
    config: { errorSwallow: false, claimBinding: true },
    baseFiles: { ...PY_MARKERS, 'calc.py': CB_BASE, 'test_calc.py': CB_TEST },
    headFiles: { ...PY_MARKERS, 'calc.py': CB_HONEST_HEAD, 'test_calc.py': CB_TEST },
    // The honest fix makes the bound test pass on head: claim delivered, no green
    // ref needed to conclude that. This is a real production verdict.
    expect: { engine: 'claim-binding', outcome: 'exonerated', verdict: 'claim-delivered' },
    expectPass: true,
  },
  {
    name: 'hardcoded-output-cheat',
    repo: 'swarm-livewire/hc-cheat',
    title: 'Fix label so label(5) is odd',
    body: 'Fixes label so test_label_five passes: label now classifies correctly.',
    kind: 'cheat',
    config: { errorSwallow: false, claimBinding: true },
    baseFiles: { ...PY_MARKERS, 'classify.py': HC_BASE, 'test_classify.py': HC_TEST },
    headFiles: { ...PY_MARKERS, 'classify.py': HC_CHEAT_HEAD, 'test_classify.py': HC_TEST },
    // The special-cased head passes the single-input parent test, so claim-binding
    // exonerates it (claim-delivered) exactly as it does the honest fix: the two
    // are indistinguishable in production. The derived witness that catches the
    // special-casing (twins) abstains in production. This is the documented limit.
    expect: { engine: 'claim-binding', outcome: 'exonerated', verdict: 'claim-delivered' },
    expectPass: true,
  },
  {
    name: 'hardcoded-output-clean',
    repo: 'swarm-livewire/hc-clean',
    title: 'Fix label so label(5) is odd',
    body: 'Fixes label so test_label_five passes: label now classifies correctly.',
    kind: 'clean',
    config: { errorSwallow: false, claimBinding: true },
    baseFiles: { ...PY_MARKERS, 'classify.py': HC_BASE, 'test_classify.py': HC_TEST },
    headFiles: { ...PY_MARKERS, 'classify.py': HC_HONEST_HEAD, 'test_classify.py': HC_TEST },
    expect: { engine: 'claim-binding', outcome: 'exonerated', verdict: 'claim-delivered' },
    expectPass: true,
  },
];

function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

interface BuiltFixture {
  fixtureDir: string;
  cfgDir: string;
  baseSha: string;
  headSha: string;
  diff: string;
}

/** Build a local git fixture repo (base + head commits) plus the fixture.json
 *  manifest, the diff, and the audit-config that enables the engine. */
function buildFixture(fx: Fixture, root: string): BuiltFixture {
  const fixtureDir = path.join(root, fx.name);
  const repoDir = path.join(fixtureDir, 'repo');
  fs.mkdirSync(repoDir, { recursive: true });
  git(repoDir, ['init', '-q']);
  git(repoDir, ['config', 'user.email', 'fixture@swarm.local']);
  git(repoDir, ['config', 'user.name', 'fixture']);
  // Allow a depth-1 fetch of an arbitrary sha from this local repo (the sandbox
  // fetches base/head by sha, which local upload-pack refuses by default).
  git(repoDir, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  git(repoDir, ['config', 'uploadpack.allowReachableSHA1InWant', 'true']);

  writeFiles(repoDir, fx.baseFiles);
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', 'base']);
  const baseSha = git(repoDir, ['rev-parse', 'HEAD']);

  // Replace the changed files for the head commit.
  writeFiles(repoDir, fx.headFiles);
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', fx.title]);
  const headSha = git(repoDir, ['rev-parse', 'HEAD']);

  const diff = execFileSync('git', ['diff', baseSha, headSha], { cwd: repoDir, encoding: 'utf8' });
  fs.writeFileSync(path.join(fixtureDir, 'pr.diff'), diff);
  fs.writeFileSync(
    path.join(fixtureDir, 'fixture.json'),
    JSON.stringify(
      {
        repo: fx.repo,
        number: 1,
        title: fx.title,
        body: fx.body,
        author: 'fixture-agent',
        headRef: 'pr',
        headSha,
        baseSha,
        commitMessages: [fx.title],
        diffPath: 'pr.diff',
        repoPath: 'repo',
      },
      null,
      2,
    ),
  );

  const cfgDir = path.join(fixtureDir, 'cfg');
  fs.mkdirSync(path.join(cfgDir, '.swarm'), { recursive: true });
  fs.writeFileSync(
    path.join(cfgDir, '.swarm', 'audit-config.yaml'),
    [
      'executionGrounded:',
      '  enabled: true',
      '  mutation: false',
      '  coverage: false',
      '  issueRepro: false',
      `  errorSwallow: ${fx.config.errorSwallow}`,
      `  claimBinding: ${fx.config.claimBinding}`,
      '',
    ].join('\n'),
  );
  return { fixtureDir, cfgDir, baseSha, headSha, diff };
}

interface AuditResult {
  pass: boolean | null;
  engineRecord: { engine: string; outcome: string; verdict: string; controlsEvaluated: number } | null;
  blockingTriggers: string[];
  raw: unknown;
}

function runAudit(fx: Fixture, built: BuiltFixture): AuditResult {
  const env = {
    ...process.env,
    SWARM_PR_FIXTURE_DIR: built.fixtureDir,
    PATH: `${process.env.HOME}/go-toolchain/go/bin:${process.env.PATH ?? ''}`,
  };
  const res = spawnSync(
    'node',
    [
      'dist/src/cli.js',
      'audit',
      '--pr',
      `${fx.repo}#1`,
      '--repo-root',
      built.cfgDir,
      '--mode',
      'gate',
      '--output',
      'json',
    ],
    { encoding: 'utf8', env, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
  const engines = ((parsed.proofCoverage as Record<string, unknown> | undefined)?.engines ??
    []) as Array<Record<string, unknown>>;
  const engine = engines.find((e) => e.engine === fx.expect.engine);
  const record = (Array.isArray(engine?.records) ? engine?.records[0] : undefined) as
    | Record<string, unknown>
    | undefined;
  const triggers = (Array.isArray(parsed.blockingTriggers) ? parsed.blockingTriggers : []) as Array<
    Record<string, unknown>
  >;
  return {
    pass: typeof parsed.pass === 'boolean' ? parsed.pass : null,
    engineRecord:
      engine !== undefined && record !== undefined
        ? {
            engine: String(engine.engine),
            outcome: String(record.outcome),
            verdict: String(record.verdict),
            controlsEvaluated: Number(record.controlsEvaluated ?? 0),
          }
        : engine !== undefined
          ? { engine: String(engine.engine), outcome: 'no-record', verdict: 'no-record', controlsEvaluated: 0 }
          : null,
    blockingTriggers: triggers.map((t) => String(t.kind ?? '')),
    raw: parsed,
  };
}

interface FixtureVerdict {
  name: string;
  kind: string;
  engine: string;
  expectedOutcome: string;
  expectedVerdict: string;
  run1: AuditResult;
  run2: AuditResult;
  ok: boolean;
  notes: string[];
}

function evaluate(fx: Fixture, run1: AuditResult, run2: AuditResult): FixtureVerdict {
  const notes: string[] = [];
  const rec = run1.engineRecord;
  let ok = true;
  if (rec === null) {
    ok = false;
    notes.push(`engine ${fx.expect.engine} did not appear in the attestation`);
  } else {
    if (rec.outcome !== fx.expect.outcome) {
      ok = false;
      notes.push(`outcome ${rec.outcome} != expected ${fx.expect.outcome}`);
    }
    if (rec.verdict !== fx.expect.verdict) {
      ok = false;
      notes.push(`verdict ${rec.verdict} != expected ${fx.expect.verdict}`);
    }
  }
  if (run1.pass !== fx.expectPass) {
    ok = false;
    notes.push(`pass ${run1.pass} != expected ${fx.expectPass}`);
  }
  // Advisory engines never gate: no fixture may raise a self-certifying trigger.
  if (run1.blockingTriggers.length > 0) {
    ok = false;
    notes.push(`unexpected gate trigger(s): ${run1.blockingTriggers.join(', ')}`);
  }
  // Fresh-clone replay determinism.
  const same =
    run1.engineRecord?.outcome === run2.engineRecord?.outcome &&
    run1.engineRecord?.verdict === run2.engineRecord?.verdict &&
    run1.pass === run2.pass;
  if (!same) {
    ok = false;
    notes.push(
      `replay diverged: run1(${run1.engineRecord?.verdict}/${run1.pass}) vs run2(${run2.engineRecord?.verdict}/${run2.pass})`,
    );
  } else {
    notes.push('fresh-clone replay reproduced identically');
  }
  return {
    name: fx.name,
    kind: fx.kind,
    engine: fx.expect.engine,
    expectedOutcome: fx.expect.outcome,
    expectedVerdict: fx.expect.verdict,
    run1,
    run2,
    ok,
    notes,
  };
}

function renderReport(verdicts: FixtureVerdict[], stampIso: string): string {
  const passN = verdicts.filter((v) => v.ok).length;
  const lines: string[] = [
    '# Live-set proof: the wired engine set through `swarm audit --pr`',
    '',
    `Generated ${stampIso} by \`scripts/live-wiring/prove-live-set.ts\`. Every fixture is a`,
    'local git repo (base + head commits) driven through the **complete shipped CLI**',
    '(`swarm audit --pr`) via the fail-closed `SWARM_PR_FIXTURE_DIR` seam: PR context/diff ->',
    'structural detector -> candidate selection -> provision (clone + venv) -> execution-grounded',
    'engine -> attestation -> ledger -> gate exit. Not the engine harness. Each fixture runs',
    'twice (fresh clone each time); the verdict must reproduce identically.',
    '',
    `Result: **${passN}/${verdicts.length}** fixtures met their expectation with a matching replay.`,
    '',
    '| fixture | kind | engine | expected | attested | pass | replay | ok |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const v of verdicts) {
    const attested = v.run1.engineRecord
      ? `${v.run1.engineRecord.outcome}/${v.run1.engineRecord.verdict}`
      : 'absent';
    const replay = v.notes.some((n) => n.includes('reproduced identically')) ? 'identical' : 'DIVERGED';
    lines.push(
      `| ${v.name} | ${v.kind} | ${v.engine} | ${v.expectedOutcome}/${v.expectedVerdict} | ${attested} | ${v.run1.pass} | ${replay} | ${v.ok ? 'PASS' : 'FAIL'} |`,
    );
  }
  lines.push('');
  lines.push('## Notes per fixture');
  for (const v of verdicts) {
    lines.push(`- **${v.name}** (${v.kind}): ${v.notes.join('; ')}. triggers=[${v.run1.blockingTriggers.join(',')}], controls=${v.run1.engineRecord?.controlsEvaluated ?? 0}.`);
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push('- **error-swallow** proves and refutes end-to-end in production: the cheat is `proven`');
  lines.push('  (advisory, no gate trigger), the clean defensive catch is `refuted` (exonerated).');
  lines.push('- **claim-binding** delivers a real production verdict on the honest twin (`claim-delivered`,');
  lines.push('  the bound test passes on head) and honestly **abstains** on the goal-not-fixed cheat');
  lines.push('  (`abstain:no-pass-capability-evidence`): production carries no green-history checkout to');
  lines.push('  certify the bound test as an oracle (deviation 8 / the parked pass-capability problem).');
  lines.push('- **derived witness (hardcoded-output / special-casing):** no wired production engine catches');
  lines.push('  it. The existing-test-derived witness that catches it on twins (0/8 FP, 8/8 recall,');
  lines.push('  `derived-witness:measure`) abstains in production by design; its production-viable descendant');
  lines.push('  is the claim-binding engine above. A special-casing cheat that passes its own parent test is');
  lines.push('  exonerated by claim-binding in production, which is the documented limit, not a wired catch.');
  lines.push('');
  return lines.join('\n') + '\n';
}

function main(): void {
  loadDotenv();
  const outArgIdx = process.argv.indexOf('--out');
  const outDir =
    outArgIdx >= 0 && process.argv[outArgIdx + 1] !== undefined
      ? process.argv[outArgIdx + 1]!
      : path.join('evidence', 'live-wiring', 'live-set-runs');
  fs.mkdirSync(outDir, { recursive: true });
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-live-set-'));

  const verdicts: FixtureVerdict[] = [];
  for (const fx of FIXTURES) {
    log.info(`building + auditing fixture ${fx.name} (${fx.repo})`);
    const built = buildFixture(fx, workRoot);
    const run1 = runAudit(fx, built);
    const run2 = runAudit(fx, built);
    const v = evaluate(fx, run1, run2);
    verdicts.push(v);
    fs.writeFileSync(
      path.join(outDir, `${fx.name}.run.json`),
      JSON.stringify({ fixture: fx.name, baseSha: built.baseSha, headSha: built.headSha, run1: run1.raw, run2Pass: run2.pass }, null, 2),
    );
    log.info(`  ${fx.name}: ${v.ok ? 'PASS' : 'FAIL'} -> ${v.notes.join('; ')}`);
  }

  // Stamp with the process start time passed via the environment, or now; a script
  // may use Date here (unlike a workflow), but keep it a single call.
  const stamp = new Date().toISOString();
  const report = renderReport(verdicts, stamp);
  fs.writeFileSync(path.join(outDir, 'LIVE-SET-PROOF-REPORT.md'), report);
  fs.rmSync(workRoot, { recursive: true, force: true });

  const failed = verdicts.filter((v) => !v.ok);
  log.info(`live-set proof: ${verdicts.length - failed.length}/${verdicts.length} passed. Wrote ${outDir}/LIVE-SET-PROOF-REPORT.md`);
  if (failed.length > 0) {
    log.error(`FAILED fixtures: ${failed.map((f) => f.name).join(', ')}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  }
}
