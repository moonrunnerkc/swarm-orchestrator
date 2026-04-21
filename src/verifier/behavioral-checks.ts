import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { VerificationCheck } from '../verifier-engine';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '../defaults';

export interface TestSnapshot {
  framework: 'mocha' | 'pytest';
  passing: string[];
  failing: string[];
  skipped: string[];
}

export interface BehavioralPreservationOpts {
  workdir: string;
  preSnapshot: TestSnapshot;
  postSnapshot?: TestSnapshot;
}

/**
 * Run the project's tests and return a deterministic snapshot of test names by
 * outcome. Supports mocha (`--reporter json`) and pytest (`-v --tb=no`).
 * Throws a descriptive error when no supported framework is detected.
 *
 * Nondeterminism warning: a passing test that sometimes fails breaks snapshot
 * comparison. We do not try to hide that; captureTestSnapshot reports the raw
 * outcome of a single run and leaves it to the caller to handle flakiness.
 *
 * @param workdir Absolute path to the project under test.
 * @throws Error when no supported framework is detected.
 */
export function captureTestSnapshot(workdir: string): TestSnapshot {
  const framework = detectFramework(workdir);
  if (!framework) {
    throw new Error(
      `behavioral preservation requires mocha (with --reporter json support) or pytest; ` +
        `neither detected in ${workdir}. Add mocha or pytest as a dev dependency, or ` +
        `remove the "refactor" intent from this step.`,
    );
  }

  if (framework === 'mocha') return captureMocha(workdir);
  return capturePytest(workdir);
}

/**
 * Compare a post-step snapshot against a pre-step baseline. Fails if any test
 * that was passing before the step is no longer passing (missing from the
 * post-set OR moved to failing/skipped).
 */
export function checkBehavioralPreservation(opts: BehavioralPreservationOpts): VerificationCheck {
  const post = opts.postSnapshot ?? captureSnapshotOrThrow(opts.workdir);
  const preSet = new Set(opts.preSnapshot.passing);
  const postSet = new Set(post.passing);

  const regressed: string[] = [];
  for (const name of preSet) {
    if (!postSet.has(name)) regressed.push(name);
  }

  if (regressed.length > 0) {
    const sample = regressed.slice(0, 5).join(', ');
    const more = regressed.length > 5 ? ` (+${regressed.length - 5} more)` : '';
    return {
      type: 'behavioral_preservation',
      description: 'Pre-existing tests still pass after refactor',
      required: true,
      passed: false,
      reason: `${regressed.length} previously-passing test(s) regressed: ${sample}${more}`,
      evidence: `pre=${preSet.size} post-passing=${postSet.size}`,
    };
  }

  const added = post.passing.length - opts.preSnapshot.passing.length;
  return {
    type: 'behavioral_preservation',
    description: 'Pre-existing tests still pass after refactor',
    required: true,
    passed: true,
    evidence:
      `All ${preSet.size} previously-passing tests still pass` +
      (added > 0 ? ` (+${added} new passing)` : ''),
  };
}

function captureSnapshotOrThrow(workdir: string): TestSnapshot {
  return captureTestSnapshot(workdir);
}

function detectFramework(workdir: string): 'mocha' | 'pytest' | null {
  const pkgPath = path.join(workdir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        devDependencies?: Record<string, string>;
        dependencies?: Record<string, string>;
      };
      const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      if (deps.mocha) return 'mocha';
    } catch {
      // malformed package.json; fall through to pytest detection
    }
  }

  for (const marker of ['pyproject.toml', 'setup.cfg', 'requirements.txt']) {
    const p = path.join(workdir, marker);
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes('pytest')) return 'pytest';
  }

  return null;
}

interface MochaJsonReport {
  passes?: Array<{ fullTitle?: string; title?: string }>;
  failures?: Array<{ fullTitle?: string; title?: string }>;
  pending?: Array<{ fullTitle?: string; title?: string }>;
}

function captureMocha(workdir: string): TestSnapshot {
  const raw = runAndCapture('npx --no-install mocha --reporter json', workdir);
  const report = parseMochaJson(raw);
  return {
    framework: 'mocha',
    passing: (report.passes ?? []).map(mochaName),
    failing: (report.failures ?? []).map(mochaName),
    skipped: (report.pending ?? []).map(mochaName),
  };
}

function mochaName(t: { fullTitle?: string; title?: string }): string {
  return t.fullTitle ?? t.title ?? '<unnamed>';
}

function parseMochaJson(output: string): MochaJsonReport {
  const firstBrace = output.indexOf('{');
  if (firstBrace < 0) {
    throw new Error('mocha JSON reporter produced no JSON; got: ' + output.slice(0, 200));
  }
  const sliced = output.slice(firstBrace);
  try {
    return JSON.parse(sliced) as MochaJsonReport;
  } catch (err: unknown) {
    throw new Error('failed to parse mocha JSON output: ' + asMessage(err), { cause: err });
  }
}

function capturePytest(workdir: string): TestSnapshot {
  const raw = runAndCapture('python3 -m pytest -v --tb=no --no-header -q', workdir);
  return parsePytestOutput(raw);
}

function parsePytestOutput(output: string): TestSnapshot {
  const passing: string[] = [];
  const failing: string[] = [];
  const skipped: string[] = [];
  const lineRe = /^(\S+?::\S+?)\s+(PASSED|FAILED|ERROR|SKIPPED)\b/;

  for (const line of output.split('\n')) {
    const m = lineRe.exec(line.trim());
    if (!m) continue;
    const [, name, status] = m;
    if (status === 'PASSED') passing.push(name);
    else if (status === 'SKIPPED') skipped.push(name);
    else failing.push(name);
  }

  return { framework: 'pytest', passing, failing, skipped };
}

function runAndCapture(cmd: string, workdir: string): string {
  try {
    return execSync(cmd, {
      cwd: workdir,
      encoding: 'utf8',
      timeout: DEFAULT_COMMAND_TIMEOUT_MS,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err: unknown) {
    // mocha/pytest exit non-zero when tests fail; we still want the output
    if (err && typeof err === 'object') {
      const e = err as { stdout?: Buffer | string };
      if (e.stdout) return typeof e.stdout === 'string' ? e.stdout : e.stdout.toString('utf8');
    }
    throw new Error(`test capture failed: ${asMessage(err)}`, { cause: err });
  }
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
