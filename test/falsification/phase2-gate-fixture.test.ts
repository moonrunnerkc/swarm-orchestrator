import { strict as assert } from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Contamination guard for the Phase 2 empirical-gate fixture. Phase 2
 * reuses the Phase 1 fixture under `evidence/fixtures/phase-1-gate/`
 * (decision recorded in DECISIONS.md 2026-05-09 entry); this test runs
 * every locked Phase 2 predicate against a fresh copy of that fixture
 * and asserts each exits 0. Mirrors the Phase 1 contamination guard at
 * `phase1-gate-fixture.test.ts` so the same "contamination caught at
 * design time" invariant covers both gates.
 */

interface Phase2Obligation {
  id: string;
  stratum: 'A' | 'B' | 'C';
  type: string;
  predicate: string;
  expectedPreApplyExit: number;
}

interface Phase2SampleFile {
  obligations: readonly Phase2Obligation[];
  fixturePath: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PHASE2_SAMPLE_PATH = path.join(REPO_ROOT, 'evidence', 'phase2', 'obligations.json');

function copyFixture(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true });
}

function runPredicate(predicate: string, cwd: string): { exitCode: number; output: string } {
  try {
    const stdout = execSync(predicate, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: stdout };
  } catch (cause) {
    const err = cause as { status?: unknown; stdout?: unknown; stderr?: unknown };
    const status = typeof err.status === 'number' ? err.status : 1;
    const stdout = typeof err.stdout === 'string' ? err.stdout : '';
    const stderr = typeof err.stderr === 'string' ? err.stderr : '';
    return { exitCode: status, output: `${stdout}${stderr}` };
  }
}

describe('phase-2 gate fixture contamination guard', () => {
  it('locates the Phase 2 obligation file', () => {
    assert.equal(
      fs.existsSync(PHASE2_SAMPLE_PATH),
      true,
      `missing phase-2 obligations file: ${PHASE2_SAMPLE_PATH}`,
    );
  });

  it('every Phase 2 predicate exits 0 against a fresh copy of the referenced fixture', () => {
    const sample = JSON.parse(fs.readFileSync(PHASE2_SAMPLE_PATH, 'utf8')) as Phase2SampleFile;
    assert.ok(Array.isArray(sample.obligations) && sample.obligations.length === 30);
    const fixtureRoot = path.resolve(REPO_ROOT, sample.fixturePath);
    assert.equal(
      fs.existsSync(fixtureRoot),
      true,
      `phase-2 obligations.json points at missing fixture: ${fixtureRoot}`,
    );

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase2-fixture-guard-'));
    const workspace = path.join(tmpRoot, 'workspace');
    try {
      copyFixture(fixtureRoot, workspace);
      const failures: string[] = [];
      for (const obligation of sample.obligations) {
        const result = runPredicate(obligation.predicate, workspace);
        if (result.exitCode !== obligation.expectedPreApplyExit) {
          failures.push(
            `${obligation.id}: exit=${result.exitCode} expected=${obligation.expectedPreApplyExit} :: ${obligation.predicate}\n` +
              `  output: ${result.output.slice(0, 400)}`,
          );
        }
      }
      assert.deepEqual(
        failures,
        [],
        `phase-2 fixture is contaminated; predicates that did not match expectedPreApplyExit:\n${failures.join('\n')}`,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
