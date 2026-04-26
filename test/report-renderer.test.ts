import * as assert from 'assert';
import { ReportRenderer } from '../src/report-renderer';
import { RunReport } from '../src/report-generator';

function buildRunReport(overrides: Partial<RunReport> = {}): RunReport {
  return {
    executionId: 'swarm-2026-04-08T12-00-00',
    goal: 'Add JWT authentication',
    tool: 'swarm-orchestrator',
    model: 'claude-sonnet-4',
    startedAt: '2026-04-08T12:00:00.000Z',
    completedAt: '2026-04-08T12:08:05.000Z',
    durationMs: 485000,
    steps: [
      {
        stepNumber: 1,
        agentName: 'worker',
        task: 'Add JWT middleware',
        verificationStatus: 'passed',
        checksPassed: ['git_diff', 'build', 'test'],
        checksFailed: [],
        repairAttempts: 0,
        estimatedCost: 8,
        actualCost: 7,
        durationMs: 240000
      },
      {
        stepNumber: 2,
        agentName: 'worker',
        task: 'Write auth tests',
        verificationStatus: 'passed',
        checksPassed: ['git_diff', 'test'],
        checksFailed: [],
        repairAttempts: 0,
        estimatedCost: 6,
        actualCost: 5,
        durationMs: 180000
      }
    ],
    results: { attempted: 2, passed: 2, failed: 0, repaired: 0 },
    waves: { count: 1, maxParallelism: 2 },
    cost: {
      estimatedPremiumRequests: 14,
      actualPremiumRequests: 12,
      accuracy: 0.857,
      modelMultiplier: 1.0,
      overageTriggered: false
    },
    owaspSummary: { applicableRisks: 6, mitigatedRisks: 5, partialRisks: 1 },
    verification: { totalGitDiffs: 4, buildPasses: 2, testPasses: 2, transcriptMatches: 0 },
    falsificationBattery: null,
    ...overrides
  };
}

describe('ReportRenderer', () => {
  describe('toMarkdown', () => {
    it('includes the report header with run metadata', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('# Swarm Orchestrator Run Report'));
      assert.ok(md.includes('swarm-2026-04-08T12-00-00'));
      assert.ok(md.includes('Add JWT authentication'));
      assert.ok(md.includes('claude-sonnet-4'));
    });

    it('includes the results summary', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('2 attempted'));
      assert.ok(md.includes('2 passed'));
      assert.ok(md.includes('0 failed'));
    });

    it('includes the per-step table', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('| Step | Agent | Task | Status | Checks Passed | Repairs | Cost (est/actual) |'));
      assert.ok(md.includes('worker'));
      assert.ok(md.includes('Add JWT middleware'));
      assert.ok(md.includes('passed'));
    });

    it('includes cost attribution section when cost data exists', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('## Cost Attribution'));
      assert.ok(md.includes('Estimated: 14'));
      assert.ok(md.includes('Actual: 12'));
      assert.ok(md.includes('85.7%'));
    });

    it('omits cost section when cost is null', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport({ cost: null }));

      assert.ok(!md.includes('## Cost Attribution'));
    });

    it('includes OWASP section when summary is present', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('## OWASP Compliance'));
      assert.ok(md.includes('6/10'));
      assert.ok(md.includes('Mitigated: 5'));
    });

    it('omits OWASP section when summary is null', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport({ owaspSummary: null }));

      assert.ok(!md.includes('## OWASP Compliance'));
    });

    it('includes verification evidence section', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport());

      assert.ok(md.includes('## Verification Evidence'));
      assert.ok(md.includes('Git diffs: 4'));
      assert.ok(md.includes('Build passes: 2'));
    });

    it('includes falsification battery section when present', () => {
      const md = ReportRenderer.toMarkdown(buildRunReport({
        falsificationBattery: {
          compositeScore: 0.82,
          humanReviewRequired: false,
          layers: [
            { layer: 'intent', status: 'PASS', evidenceSummary: 'differential test passed', durationMs: 20 }
          ],
        },
      }));

      assert.ok(md.includes('## Falsification Battery'));
      assert.ok(md.includes('Composite score: 0.82'));
      assert.ok(md.includes('intent: PASS'));
    });
  });

  describe('toJson', () => {
    it('returns valid pretty-printed JSON', () => {
      const json = ReportRenderer.toJson(buildRunReport());
      const parsed = JSON.parse(json);

      assert.strictEqual(parsed.executionId, 'swarm-2026-04-08T12-00-00');
      assert.strictEqual(parsed.steps.length, 2);
    });
  });

  describe('toSummaryLine', () => {
    it('produces a single-line summary with step results', () => {
      const line = ReportRenderer.toSummaryLine(buildRunReport());

      assert.ok(line.includes('swarm-2026-04-08T12-00-00'));
      assert.ok(line.includes('2/2 steps passed'));
      assert.ok(line.includes('1 waves'));
    });

    it('includes cost info when available', () => {
      const line = ReportRenderer.toSummaryLine(buildRunReport());

      assert.ok(line.includes('12 premium requests'));
      assert.ok(line.includes('est 14'));
    });

    it('omits cost info when null', () => {
      const line = ReportRenderer.toSummaryLine(buildRunReport({ cost: null }));

      assert.ok(!line.includes('premium requests'));
    });

    it('includes OWASP summary when available', () => {
      const line = ReportRenderer.toSummaryLine(buildRunReport());

      assert.ok(line.includes('OWASP 5/6 mitigated'));
    });

    it('omits OWASP info when null', () => {
      const line = ReportRenderer.toSummaryLine(buildRunReport({ owaspSummary: null }));

      assert.ok(!line.includes('OWASP'));
    });
  });
});
