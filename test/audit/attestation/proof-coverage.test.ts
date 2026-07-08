import { strict as assert } from 'node:assert';
import {
  buildProofCoverage,
  serializeProofCoverage,
  renderProofCoverageSummary,
} from '../../../src/audit/attestation/proof-coverage';
import type { ExecutionGroundedOutcome } from '../../../src/audit/execution-grounded';

/** An empty execution-grounded outcome with every array present. Tests override
 *  the fields they exercise; casting to the outcome type keeps the fixture small
 *  without reconstructing every engine's full record shape. */
function emptyOutcome(over: Partial<ExecutionGroundedOutcome> = {}): ExecutionGroundedOutcome {
  const base = {
    findings: [],
    mutationRuns: [],
    coverageRuns: [],
    repros: [],
    restorations: [],
    mockRestorations: [],
    noOpRestorations: [],
    typeSuppressionRestorations: [],
    fakeRefactorRestorations: [],
    deadBranchRestorations: [],
    claimDifferentials: [],
    skipped: [],
  };
  return { ...base, ...over } as unknown as ExecutionGroundedOutcome;
}

function restoration(verdict: string, controls: Record<string, boolean | null>, findingFile = 'src/a.ts') {
  return { verdict, findingFile, reproduceCommand: 'npx mocha a', controls } as unknown;
}

describe('buildProofCoverage', () => {
  it('returns the empty attestation when the layer did not run', () => {
    const att = buildProofCoverage(undefined);
    assert.equal(att.provisioning.attempted, false);
    assert.equal(att.engines.length, 0);
    assert.equal(att.summary.enginesApplicable, 0);
  });

  it('projects a proven restoration as an executed finding', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        restorations: [
          restoration('proven', {
            baseTestPasses: true,
            tamperedSuitePasses: true,
            restoredFailsTwiceSameIdentity: true,
          }),
        ] as never,
      }),
    );
    const engine = att.engines.find((e) => e.engine === 'test-restoration');
    assert.ok(engine);
    assert.equal(engine.applicable, true);
    assert.equal(engine.executed, true);
    assert.equal(engine.records[0]?.outcome, 'finding');
    assert.equal(engine.records[0]?.controlsEvaluated, 3);
    assert.equal(att.summary.findings, 1);
  });

  it('classifies a no-workspace abstain as not-provisioned and not executed', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        restorations: [
          restoration('not-proven:no-workspace', {
            baseTestPasses: null,
            tamperedSuitePasses: null,
            restoredFailsTwiceSameIdentity: null,
          }),
        ] as never,
      }),
    );
    const record = att.engines.find((e) => e.engine === 'test-restoration')?.records[0];
    assert.equal(record?.outcome, 'abstain');
    assert.equal(record?.abstainClass, 'not-provisioned');
    assert.equal(att.engines.find((e) => e.engine === 'test-restoration')?.executed, false);
  });

  it('classifies a suite-already-failing abstain as a control clause', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        noOpRestorations: [
          restoration('not-proven:suite-already-failing', {
            prClaimsFix: true,
            suitePassesAsSubmitted: false,
            affectedTestsCoverRevertedLines: null,
            revertedSuiteStillPassesTwice: null,
          }),
        ] as never,
      }),
    );
    const record = att.engines.find((e) => e.engine === 'no-op-fix-restoration')?.records[0];
    assert.equal(record?.abstainClass, 'control-clause');
    // one control ran (prClaimsFix), so this abstain still counts as executed.
    assert.equal(record?.controlsEvaluated, 2);
  });

  it('classifies a structural not-proven as structurally-inapplicable', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        fakeRefactorRestorations: [
          restoration('not-proven:no-rename', {
            oldSymbolResolved: null,
            oldSymbolDeclarationRemoved: null,
            oldSymbolStillReferenced: null,
          }),
        ] as never,
      }),
    );
    const record = att.engines.find((e) => e.engine === 'fake-refactor-restoration')?.records[0];
    assert.equal(record?.abstainClass, 'structurally-inapplicable');
  });

  it('projects a claim-differential abstain with its precise verdict', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        claimDifferentials: [
          {
            verdict: 'abstain:no-pass-capability-evidence',
            reason: 'no reference implementation',
            baseRuns: ['fail', 'fail', 'fail'],
            headRuns: ['fail', 'fail', 'fail'],
            witness: { witnessHash: 'abc123' },
          },
        ] as never,
      }),
    );
    const engine = att.engines.find((e) => e.engine === 'claim-differential');
    assert.equal(engine?.executed, true);
    assert.equal(engine?.records[0]?.verdict, 'abstain:no-pass-capability-evidence');
    assert.equal(engine?.records[0]?.abstainClass, 'control-clause');
    assert.equal(engine?.records[0]?.controlsEvaluated, 6);
  });

  it('reports the sandbox provisioning failure from the skip log', () => {
    const att = buildProofCoverage(emptyOutcome({ skipped: ['provision: no lockfile'] }));
    assert.equal(att.provisioning.attempted, true);
    assert.equal(att.provisioning.provisioned, false);
    assert.equal(att.provisioning.reason, 'no lockfile');
  });

  it('reports provisioned when the layer ran with no provision skip', () => {
    const att = buildProofCoverage(emptyOutcome({ skipped: ['mutation[pkg]: capped'] }));
    assert.equal(att.provisioning.provisioned, true);
  });

  it('is byte-stable across two serializations of the same input', () => {
    const outcome = emptyOutcome({
      restorations: [
        restoration('refuted', {
          baseTestPasses: true,
          tamperedSuitePasses: true,
          restoredFailsTwiceSameIdentity: false,
        }),
      ] as never,
      skipped: ['provision: not a Node project'],
    });
    const first = serializeProofCoverage(buildProofCoverage(outcome));
    const second = serializeProofCoverage(buildProofCoverage(outcome));
    assert.equal(first, second);
    assert.match(first, /"schema": "swarm-proof-coverage\/v1"/);
  });
});

describe('renderProofCoverageSummary', () => {
  it('renders a judgment-free roll-up with the abstain breakdown', () => {
    const att = buildProofCoverage(
      emptyOutcome({
        restorations: [
          restoration('proven', {
            baseTestPasses: true,
            tamperedSuitePasses: true,
            restoredFailsTwiceSameIdentity: true,
          }),
        ] as never,
        mockRestorations: [
          restoration('not-proven:no-workspace', {
            tamperedSuitePasses: null,
            restoredFailsTwiceSameIdentity: null,
            mockReturnsAssertedValue: null,
          }),
        ] as never,
      }),
    );
    const rendered = renderProofCoverageSummary(att);
    assert.match(rendered, /Proof coverage \(provisioned\)/);
    assert.match(rendered, /findings 1/);
    assert.match(rendered, /1 not-provisioned/);
    assert.match(rendered, /test-restoration: executed/);
    // No verdict language a policy should own.
    assert.doesNotMatch(rendered, /PASS|BLOCK|merge/i);
  });
});
