import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyErrorSwallowRestorationToFinding,
  errorSwallowBudgetExhaustedRecords,
  noWorkspaceErrorSwallowRecords,
  runProofRestorations,
  type ProofRestorationInput,
} from '../../../src/audit/execution-grounded';
import type { Finding } from '../../../src/audit/types';
import type { ErrorSwallowProofRecord } from '../../../src/audit/execution-grounded/error-swallow-restoration';

// Wiring of the error-swallow restoration engine into the execution-grounded
// orchestrator: a `block` error-swallow structural finding is selected as a proof
// candidate and dispatched (gated by the config flag), the outcome carries the
// proof record, qualifying findings still produce honest no-workspace /
// budget-exhausted records when the layer cannot run, and a verdict rides back
// onto its structural finding (refuted demotes, proven corroborates, everything
// else record-only). The engine's own soundness is measured by
// `error-swallow:measure`; this file pins the wiring, not the proof.

const tempDirs: string[] = [];

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swarm-es-wiring-'));
  tempDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function swallowFinding(file: string, severity: Finding['severity'] = 'block'): Finding {
  return {
    category: 'error-swallow',
    severity,
    message: 'A bare empty catch block was added',
    location: { file, line: 3 },
    evidence: 'catch (e) {}',
  };
}

function baseInput(over: Partial<ProofRestorationInput> = {}): ProofRestorationInput {
  return {
    prDiff: '',
    prRef: 'owner/repo#1',
    prHeadSha: 'a'.repeat(40),
    structuralFindings: [],
    preWorkspacePath: null,
    postWorkspacePath: tempWorkspace(),
    testRunner: null,
    packageManager: 'npm',
    deadline: Date.now() + 60_000,
    ...over,
  };
}

describe('execution-grounded / error-swallow wiring', () => {
  it('selects a block error-swallow finding and dispatches the engine (config on)', () => {
    const finding = swallowFinding('src/mod.ts');
    const out = runProofRestorations(
      baseInput({ structuralFindings: [finding], errorSwallow: true }),
    );
    assert.equal(out.errorSwallowRestorations.length, 1, 'one record for one block finding');
    // No runner in the bare temp workspace, so the engine abstains deterministically
    // rather than proving; the point here is that the candidate was dispatched.
    assert.equal(out.errorSwallowRestorations[0]?.verdict, 'not-proven:runner-unsupported');
    assert.equal(out.errorSwallowRestorations[0]?.category, 'error-swallow');
  });

  it('does not dispatch when the config flag is off', () => {
    const finding = swallowFinding('src/mod.ts');
    const out = runProofRestorations(
      baseInput({ structuralFindings: [finding], errorSwallow: false }),
    );
    assert.equal(out.errorSwallowRestorations.length, 0, 'flag off => no dispatch');
  });

  it('ignores non-block (info) error-swallow findings', () => {
    const finding = swallowFinding('src/mod.ts', 'info');
    const out = runProofRestorations(
      baseInput({ structuralFindings: [finding], errorSwallow: true }),
    );
    assert.equal(out.errorSwallowRestorations.length, 0, 'comment-only info swallow is not a candidate');
  });

  it('records without executing when the wall-clock budget is exhausted', () => {
    const finding = swallowFinding('src/mod.ts');
    const out = runProofRestorations(
      baseInput({ structuralFindings: [finding], errorSwallow: true, deadline: Date.now() - 1 }),
    );
    assert.equal(out.errorSwallowRestorations.length, 1);
    assert.equal(out.errorSwallowRestorations[0]?.verdict, 'not-proven:execution-error');
    assert.match(out.skipped.join(' '), /error-swallow-restoration: wall-clock budget exhausted/);
  });
});

describe('execution-grounded / error-swallow honesty records', () => {
  it('emits one no-workspace record per candidate', () => {
    const records = noWorkspaceErrorSwallowRecords([swallowFinding('src/a.ts')], 'no lockfile');
    assert.equal(records.length, 1);
    assert.equal(records[0]?.verdict, 'not-proven:no-workspace');
    assert.equal(records[0]?.findingFile, 'src/a.ts');
    assert.equal(records[0]?.controls.suitePassesAsSubmitted, null);
    assert.match(records[0]?.reason ?? '', /no sandbox workspace was provisioned/);
  });

  it('emits one budget-exhausted record per candidate', () => {
    const records = errorSwallowBudgetExhaustedRecords([swallowFinding('src/a.ts')]);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.verdict, 'not-proven:execution-error');
    assert.match(records[0]?.reason ?? '', /wall-clock budget exhausted/);
  });
});

describe('execution-grounded / applyErrorSwallowRestorationToFinding', () => {
  function record(verdict: ErrorSwallowProofRecord['verdict'], failingTests: string[] = []): ErrorSwallowProofRecord {
    return {
      schemaVersion: 1,
      verdict,
      category: 'error-swallow',
      findingFile: 'src/mod.ts',
      testFiles: ['test/mod.test.ts'],
      failingTests,
      controls: {
        suitePassesAsSubmitted: true,
        neutralizedFailsTwiceSameIdentity: verdict === 'proven',
        neutralizationApplied: true,
      },
      neutralization: 'catch-binding',
    };
  }

  it('demotes a refuted finding to info and clears runtime backing', () => {
    const finding = swallowFinding('src/mod.ts');
    applyErrorSwallowRestorationToFinding(finding, record('refuted'));
    assert.equal(finding.severity, 'info');
    assert.equal(finding.confidence, 'structural-only');
    assert.match(finding.evidence, /not masking a test-visible failure/);
  });

  it('corroborates a proven finding without changing severity (stays advisory)', () => {
    const finding = swallowFinding('src/mod.ts');
    applyErrorSwallowRestorationToFinding(finding, record('proven', ['mod › throws on bad input']));
    assert.equal(finding.severity, 'block', 'proven does not escalate; it is advisory, never a gate trigger');
    assert.deepEqual(finding.runtimeCorroboration, {
      signal: 'error-swallow-load-bearing',
      failingTests: ['mod › throws on bad input'],
    });
  });

  it('leaves the finding untouched for a record-only verdict', () => {
    const finding = swallowFinding('src/mod.ts');
    const before = { ...finding };
    applyErrorSwallowRestorationToFinding(finding, record('not-proven:no-swallow-located'));
    assert.equal(finding.severity, before.severity);
    assert.equal(finding.runtimeCorroboration, undefined);
  });
});
