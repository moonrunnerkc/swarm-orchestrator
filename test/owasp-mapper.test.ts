import * as assert from 'assert';
import { OwaspMapper, ExecutionMetadata, OwaspComplianceReport } from '../src/owasp-mapper';
import { VerificationResult } from '../src/verifier-engine';

function buildVerificationResult(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    stepNumber: 1,
    agentName: 'backend_master',
    passed: true,
    checks: [
      { type: 'build', description: 'Build passes', required: true, passed: true, evidence: 'exit code 0' },
      { type: 'test', description: 'Tests pass', required: true, passed: true, evidence: '12 passing' },
      { type: 'commit', description: 'Git diff present', required: true, passed: true, evidence: '3 files changed' }
    ],
    unverifiedClaims: [],
    timestamp: '2026-04-08T12:00:00.000Z',
    transcriptPath: '/tmp/transcript.md',
    ...overrides
  };
}

function buildMeta(overrides: Partial<ExecutionMetadata> = {}): ExecutionMetadata {
  return {
    executionId: 'swarm-2026-04-08T12-00-00',
    toolVersion: '4.1.0',
    strictIsolation: true,
    adapterType: 'copilot',
    totalSteps: 3,
    passedSteps: 3,
    repairedSteps: 0,
    failedSteps: 0,
    retriesExhausted: 0,
    ...overrides
  };
}

describe('OwaspMapper', () => {
  const mapper = new OwaspMapper();

  describe('map', () => {
    it('produces a report with all 10 ASI risks', () => {
      const results = [buildVerificationResult()];
      const meta = buildMeta();
      const report = mapper.map(results, meta);

      assert.strictEqual(report.risks.length, 10);
      assert.strictEqual(report.executionId, 'swarm-2026-04-08T12-00-00');
      assert.strictEqual(report.toolVersion, '4.1.0');
    });

    it('counts applicable, mitigated, partial, and not_applicable correctly', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta());

      assert.strictEqual(report.applicableRisks + report.notApplicableRisks, 10);
      assert.strictEqual(report.mitigatedRisks + report.partialRisks + report.notApplicableRisks, 10);
      assert.ok(report.generatedAt.length > 0);
    });

    it('marks ASI-03 as mitigated always (branch isolation is structural)', () => {
      const report = mapper.map([], buildMeta({ strictIsolation: false }));
      const asi03 = report.risks.find(r => r.asiId === 'ASI-03');

      assert.ok(asi03);
      assert.strictEqual(asi03!.status, 'mitigated');
      assert.ok(asi03!.evidence.length > 0);
    });

    it('marks four risks as not_applicable regardless of flags', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta());
      const naRisks = report.risks.filter(r => r.status === 'not_applicable');
      const naIds = naRisks.map(r => r.asiId).sort();

      assert.deepStrictEqual(naIds, ['ASI-04', 'ASI-06', 'ASI-07', 'ASI-09']);
    });

    it('marks ASI-01 as mitigated when strict isolation is on', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ strictIsolation: true }));
      const asi01 = report.risks.find(r => r.asiId === 'ASI-01');

      assert.strictEqual(asi01!.status, 'mitigated');
    });

    it('marks ASI-01 as partial when strict isolation is off', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ strictIsolation: false }));
      const asi01 = report.risks.find(r => r.asiId === 'ASI-01');

      assert.strictEqual(asi01!.status, 'partial');
    });

    it('marks ASI-02 as mitigated when strict isolation is on', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ strictIsolation: true }));
      const asi02 = report.risks.find(r => r.asiId === 'ASI-02');

      assert.strictEqual(asi02!.status, 'mitigated');
    });

    it('marks ASI-02 as partial when strict isolation is off', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ strictIsolation: false }));
      const asi02 = report.risks.find(r => r.asiId === 'ASI-02');

      assert.strictEqual(asi02!.status, 'partial');
    });

    it('marks ASI-05 as mitigated when all steps passed without repair', () => {
      const report = mapper.map(
        [buildVerificationResult(), buildVerificationResult({ stepNumber: 2 })],
        buildMeta({ totalSteps: 2, passedSteps: 2, repairedSteps: 0 })
      );
      const asi05 = report.risks.find(r => r.asiId === 'ASI-05');

      assert.strictEqual(asi05!.status, 'mitigated');
    });

    it('marks ASI-05 as partial when any step required repair', () => {
      const report = mapper.map(
        [buildVerificationResult()],
        buildMeta({ repairedSteps: 1 })
      );
      const asi05 = report.risks.find(r => r.asiId === 'ASI-05');

      assert.strictEqual(asi05!.status, 'partial');
    });

    it('marks ASI-08 as mitigated when no retries exhausted', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ retriesExhausted: 0 }));
      const asi08 = report.risks.find(r => r.asiId === 'ASI-08');

      assert.strictEqual(asi08!.status, 'mitigated');
    });

    it('marks ASI-08 as partial when retries were exhausted', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta({ retriesExhausted: 2 }));
      const asi08 = report.risks.find(r => r.asiId === 'ASI-08');

      assert.strictEqual(asi08!.status, 'partial');
    });

    it('marks ASI-10 as mitigated when all steps verified', () => {
      const report = mapper.map(
        [buildVerificationResult()],
        buildMeta({ passedSteps: 3, failedSteps: 0 })
      );
      const asi10 = report.risks.find(r => r.asiId === 'ASI-10');

      assert.strictEqual(asi10!.status, 'mitigated');
    });

    it('marks ASI-10 as partial when steps failed', () => {
      const report = mapper.map(
        [buildVerificationResult({ passed: false })],
        buildMeta({ failedSteps: 1 })
      );
      const asi10 = report.risks.find(r => r.asiId === 'ASI-10');

      assert.strictEqual(asi10!.status, 'partial');
    });

    it('handles empty verification results', () => {
      const report = mapper.map([], buildMeta({ totalSteps: 0, passedSteps: 0 }));

      assert.strictEqual(report.risks.length, 10);
      assert.ok(report.applicableRisks >= 0);
    });

    it('every risk has a non-empty rationale', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta());

      for (const risk of report.risks) {
        assert.ok(risk.rationale.length > 0, `${risk.asiId} missing rationale`);
      }
    });

    it('every applicable risk has at least one evidence entry', () => {
      const report = mapper.map([buildVerificationResult()], buildMeta());

      for (const risk of report.risks) {
        if (risk.status !== 'not_applicable') {
          assert.ok(risk.evidence.length > 0, `${risk.asiId} missing evidence`);
        }
      }
    });
  });
});
