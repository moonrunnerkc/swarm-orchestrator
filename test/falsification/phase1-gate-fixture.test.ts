import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPredicate } from './shared/run-predicate';

/**
 * Contamination guard for the Phase 1 dev-gate fixture under
 * `evidence/fixtures/phase-1-gate/`. Every locked predicate in
 * `evidence/fixtures/phase1-obligations.json` must exit 0 against
 * the bare fixture, otherwise the gate's pre-apply baseline is tainted
 * before codex is even invoked.
 *
 * This test runs the predicates from a fresh copy of the fixture (so the
 * test cannot accidentally hide breakage by picking up files from outside
 * the fixture, e.g. from the parent repo's evidence/ subtree).
 */

interface SampleObligation {
  id: string;
  type: string;
  predicate: string;
}

interface SampleFile {
  obligations: readonly SampleObligation[];
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'evidence', 'fixtures', 'phase-1-gate');
const SAMPLE_PATH = path.join(REPO_ROOT, 'evidence', 'fixtures', 'phase1-obligations.json');

function copyFixture(dest: string): void {
  fs.cpSync(FIXTURE_ROOT, dest, { recursive: true });
}

describe('phase-1 gate fixture contamination guard', () => {
  it('locates the fixture and the locked sample file', () => {
    assert.equal(fs.existsSync(FIXTURE_ROOT), true, `missing fixture root: ${FIXTURE_ROOT}`);
    assert.equal(fs.existsSync(SAMPLE_PATH), true, `missing sample file: ${SAMPLE_PATH}`);
  });

  it('every locked predicate exits 0 against a fresh copy of the fixture', () => {
    const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8')) as SampleFile;
    assert.ok(Array.isArray(sample.obligations) && sample.obligations.length > 0);

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-fixture-guard-'));
    const workspace = path.join(tmpRoot, 'workspace');
    try {
      copyFixture(workspace);
      const failures: string[] = [];
      for (const obligation of sample.obligations) {
        const result = runPredicate(obligation.predicate, workspace);
        if (result.exitCode !== 0) {
          failures.push(
            `${obligation.id}: exit=${result.exitCode} :: ${obligation.predicate}\n` +
              `  output: ${result.output.slice(0, 400)}`,
          );
        }
      }
      assert.deepEqual(
        failures,
        [],
        `fixture is contaminated; predicates that did not exit 0:\n${failures.join('\n')}`,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
