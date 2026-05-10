import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ObligationV1 } from '../../src/contract/types';
import { verifyObligation } from '../../src/verification/run-verifier';

/**
 * Contamination guard for the Phase 3 ablation-gate fixture. Mirrors
 * Phase 1/2 guards but runs the AST-backed `verifyObligation` against a
 * fresh copy of the Phase 3 fixture (rather than executing a shell
 * predicate). Every locked Phase 3 obligation must be SATISFIED against
 * the bare fixture; if any is not satisfied, the falsifier will treat
 * the obligation as pre-tainted and either short-circuit
 * (baseline-predicate-failed) or emit meaningless yields.
 */

interface Phase3Obligation {
  id: string;
  stratum: 'I' | 'F';
  type: string;
  // Per-type fields below are loaded as-is and passed to verifyObligation.
  constraint?: string;
  scope?: string;
  file?: string;
  name?: string;
  signature?: string;
}

interface Phase3SampleFile {
  obligations: readonly Phase3Obligation[];
  fixturePath: string;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const PHASE3_SAMPLE_PATH = path.join(REPO_ROOT, 'evidence', 'fixtures', 'phase3-obligations.json');

function copyFixture(src: string, dest: string): void {
  fs.cpSync(src, dest, { recursive: true });
}

describe('phase-3 gate fixture contamination guard', () => {
  it('locates the Phase 3 obligation file', () => {
    assert.equal(
      fs.existsSync(PHASE3_SAMPLE_PATH),
      true,
      `missing phase-3 obligations file: ${PHASE3_SAMPLE_PATH}`,
    );
  });

  it('every Phase 3 obligation is satisfied against a fresh copy of the referenced fixture', () => {
    const sample = JSON.parse(fs.readFileSync(PHASE3_SAMPLE_PATH, 'utf8')) as Phase3SampleFile;
    assert.ok(Array.isArray(sample.obligations) && sample.obligations.length === 20);
    const fixtureRoot = path.resolve(REPO_ROOT, sample.fixturePath);
    assert.equal(
      fs.existsSync(fixtureRoot),
      true,
      `phase-3 obligations.json points at missing fixture: ${fixtureRoot}`,
    );

    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-fixture-guard-'));
    const workspace = path.join(tmpRoot, 'workspace');
    try {
      copyFixture(fixtureRoot, workspace);
      const failures: string[] = [];
      for (const sampleObligation of sample.obligations) {
        const verdict = verifyObligation(sampleObligation as unknown as ObligationV1, {
          repoRoot: workspace,
        });
        if (!verdict.satisfied) {
          failures.push(`${sampleObligation.id}: ${verdict.detail}`);
        }
      }
      assert.deepEqual(
        failures,
        [],
        `phase-3 fixture is contaminated; obligations that did not verify clean:\n${failures.join('\n')}`,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
