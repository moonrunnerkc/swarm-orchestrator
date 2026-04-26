import * as assert from 'assert';
import { OwaspReportRenderer } from '../src/owasp-report-renderer';
import { OwaspComplianceReport } from '../src/owasp-mapper';

function buildReport(overrides: Partial<OwaspComplianceReport> = {}): OwaspComplianceReport {
  return {
    generatedAt: '2026-04-08T12:00:00.000Z',
    executionId: 'swarm-2026-04-08T12-00-00',
    toolVersion: '4.1.0',
    applicableRisks: 6,
    mitigatedRisks: 5,
    partialRisks: 1,
    notApplicableRisks: 4,
    risks: [
      {
        asiId: 'ASI-01',
        riskName: 'Agent Goal Hijack',
        status: 'mitigated',
        evidence: ['Strict isolation enabled', 'Bounded worker and reviewer roles'],
        rationale: 'Strict isolation and bounded role prompts reduce goal-hijack blast radius.'
      },
      {
        asiId: 'ASI-03',
        riskName: 'Privilege Escalation',
        status: 'mitigated',
        evidence: ['Branch isolation is structural'],
        rationale: 'Each agent operates in a dedicated worktree.'
      },
      {
        asiId: 'ASI-04',
        riskName: 'Data Leakage',
        status: 'not_applicable',
        evidence: [],
        rationale: 'Agents are stateless subprocesses on local branches.'
      },
      {
        asiId: 'ASI-05',
        riskName: 'Uncontrolled Code Execution',
        status: 'partial',
        evidence: ['1 step required repair'],
        rationale: 'Outcome verification gates in place, but repairs were needed.'
      }
    ],
    ...overrides
  };
}

describe('OwaspReportRenderer', () => {
  describe('toMarkdown', () => {
    it('includes the report header with run info', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());

      assert.ok(md.includes('# OWASP ASI Compliance Report'));
      assert.ok(md.includes('swarm-2026-04-08T12-00-00'));
      assert.ok(md.includes('4.1.0'));
      assert.ok(md.includes('2026-04-08T12:00:00.000Z'));
    });

    it('includes the summary counts', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());

      assert.ok(md.includes('Applicable risks: 6/10'));
      assert.ok(md.includes('Mitigated: 5'));
      assert.ok(md.includes('Partial: 1'));
      assert.ok(md.includes('Not applicable: 4'));
    });

    it('renders each risk with its status', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());

      assert.ok(md.includes('### ASI-01: Agent Goal Hijack'));
      assert.ok(md.includes('Status: MITIGATED'));
      assert.ok(md.includes('### ASI-04: Data Leakage'));
      assert.ok(md.includes('Status: NOT APPLICABLE'));
      assert.ok(md.includes('### ASI-05: Uncontrolled Code Execution'));
      assert.ok(md.includes('Status: PARTIAL'));
    });

    it('includes evidence for applicable risks', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());

      assert.ok(md.includes('Strict isolation enabled'));
      assert.ok(md.includes('Bounded worker and reviewer roles'));
    });

    it('omits evidence section for not_applicable risks', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());
      const asi04Section = md.split('### ASI-04')[1].split('###')[0];

      assert.ok(!asi04Section.includes('Evidence:'));
    });

    it('includes rationale for every risk', () => {
      const md = OwaspReportRenderer.toMarkdown(buildReport());

      assert.ok(md.includes('Strict isolation and bounded role prompts reduce goal-hijack blast radius.'));
      assert.ok(md.includes('Agents are stateless subprocesses on local branches.'));
    });
  });

  describe('toJson', () => {
    it('returns valid pretty-printed JSON', () => {
      const json = OwaspReportRenderer.toJson(buildReport());
      const parsed = JSON.parse(json);

      assert.strictEqual(parsed.executionId, 'swarm-2026-04-08T12-00-00');
      assert.strictEqual(parsed.risks.length, 4);
    });

    it('preserves all report fields', () => {
      const report = buildReport();
      const parsed = JSON.parse(OwaspReportRenderer.toJson(report));

      assert.strictEqual(parsed.applicableRisks, 6);
      assert.strictEqual(parsed.mitigatedRisks, 5);
      assert.strictEqual(parsed.partialRisks, 1);
      assert.strictEqual(parsed.notApplicableRisks, 4);
    });

    it('uses 2-space indentation', () => {
      const json = OwaspReportRenderer.toJson(buildReport());
      // 2-space indent means lines should start with "  " not "    " at first level
      const lines = json.split('\n');
      const firstIndented = lines.find(l => l.startsWith('  "'));

      assert.ok(firstIndented, 'Expected 2-space indented lines');
    });
  });
});
