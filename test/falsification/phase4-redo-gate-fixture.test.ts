import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPredicate } from './shared/run-predicate';

/**
 * Contamination guard for the Phase 4 redo obligation set
 * (audit-and-corrections, DECISIONS.md 2026-05-09). Reuses the Phase 1
 * fixture; this test runs every locked Phase 4 redo predicate against a
 * fresh copy of the fixture and asserts each exits 0 (the property
 * holds against the bare fixture). Same shape as the Phase 1 / 2 / 3
 * contamination guards.
 */

interface Phase4RedoObligation {
  id: string;
  stratum: 'A' | 'B' | 'C';
  type: string;
  target: string;
  predicate: string;
  expectedPreApplyExit: number;
}

interface Phase4RedoSampleFile {
  obligations: readonly Phase4RedoObligation[];
  fixturePath: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SAMPLE_PATH = path.join(REPO_ROOT, 'evidence', 'fixtures', 'phase4-redo-obligations.json');

function copyFixture(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true });
}

describe('phase-4-redo gate fixture contamination guard', () => {
  it('locates the Phase 4 redo obligations file', () => {
    assert.equal(
      fs.existsSync(SAMPLE_PATH),
      true,
      `missing phase-4-redo obligations file: ${SAMPLE_PATH}`,
    );
  });

  it('every Phase 4 redo predicate exits 0 against a fresh copy of the referenced fixture', function () {
    this.timeout(30_000);
    const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')) as Phase4RedoSampleFile;
    const fixtureRoot = path.resolve(REPO_ROOT, sample.fixturePath);
    assert.equal(fs.existsSync(fixtureRoot), true, `missing fixture: ${fixtureRoot}`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-redo-fixture-test-'));
    const work = path.join(tmp, 'fixture');
    copyFixture(fixtureRoot, work);
    const failures: string[] = [];
    for (const o of sample.obligations) {
      const got = runPredicate(o.predicate, work);
      if (got.exitCode !== o.expectedPreApplyExit) {
        failures.push(
          `${o.id} (${o.stratum}/${o.target}): expected exit ${o.expectedPreApplyExit}, ` +
            `got ${got.exitCode}; output:\n${got.output.slice(0, 320)}`,
        );
      }
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    assert.equal(failures.length, 0, `pre-apply contamination:\n${failures.join('\n')}`);
  });
});

