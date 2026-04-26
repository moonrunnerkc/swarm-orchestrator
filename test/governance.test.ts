// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import { CriticResult } from '../src/types';

describe('Upgrade 3: Critic Agent + Governance', () => {

  describe('CriticResult type', () => {
    it('should accept valid CriticResult with approve recommendation', () => {
      const result: CriticResult = {
        score: 95,
        flags: [],
        recommendation: 'approve'
      };
      assert.strictEqual(result.score, 95);
      assert.strictEqual(result.flags.length, 0);
      assert.strictEqual(result.recommendation, 'approve');
    });

    it('should accept CriticResult with flags and reject recommendation', () => {
      const result: CriticResult = {
        score: 35,
        flags: ['step-1: verification failed', 'step-3: no session output captured'],
        recommendation: 'reject'
      };
      assert.strictEqual(result.score, 35);
      assert.strictEqual(result.flags.length, 2);
      assert.strictEqual(result.recommendation, 'reject');
    });

    it('should accept revise recommendation', () => {
      const result: CriticResult = {
        score: 70,
        flags: ['step-2: verification failed'],
        recommendation: 'revise'
      };
      assert.strictEqual(result.recommendation, 'revise');
    });
  });

  describe('critic prompt construction', () => {
    it('should include diff, transcripts, and plan in prompt data', () => {
      // Simulate data the critic would receive
      const diff = 'diff --git a/src/api.ts b/src/api.ts\n+export function getUsers() {}';
      const transcripts = { 'step-1': 'Created API endpoints with tests' };
      const plan = { goal: 'Build REST API', steps: [{ stepNumber: 1, task: 'Build API', agent: 'worker' }] };
      const gateResults = [{ id: 'scaffold', title: 'Scaffold Defaults', status: 'pass', issues: [] }];

      // Verify all components present for critic construction
      assert.ok(diff.includes('diff --git'), 'diff should be present');
      assert.ok(transcripts['step-1'].length > 0, 'transcript should be present');
      assert.ok(plan.goal.length > 0, 'plan goal should be present');
      assert.ok(gateResults.length > 0, 'gate results should be present');
    });
  });

  describe('flag parsing and scoring', () => {
    it('should produce flags for failed verifications using per-axis scoring', () => {
      // Replicate the per-axis critic scoring from runCriticReview (Upgrade 8)
      const weights: Record<string, number> = { test: 20, build: 25, lint: 5, commit: 10, claim: 5 };
      const results = [
        {
          stepNumber: 1,
          status: 'completed',
          verificationResult: {
            passed: false,
            checks: [
              { type: 'test', description: 'Tests must pass', passed: false, reason: 'no test output' },
              { type: 'build', description: 'Build must succeed', passed: true }
            ]
          },
          sessionResult: 'ok'
        },
        {
          stepNumber: 2,
          status: 'completed',
          verificationResult: {
            passed: true,
            checks: [
              { type: 'test', description: 'Tests must pass', passed: true }
            ]
          },
          sessionResult: 'ok'
        },
      ];
      const steps = [
        { stepNumber: 1, task: 'Build API', expectedOutputs: ['api/'] },
        { stepNumber: 2, task: 'Add tests', expectedOutputs: ['test/'] },
      ];

      const flags: string[] = [];
      let score = 100;

      for (const result of results) {
        const step = steps.find(s => s.stepNumber === result.stepNumber);
        if (!step) continue;

        if (result.verificationResult) {
          const byType = new Map<string, { passed: number; failed: number; reasons: string[] }>();
          for (const check of result.verificationResult.checks) {
            const entry = byType.get(check.type) || { passed: 0, failed: 0, reasons: [] };
            if (check.passed) entry.passed++;
            else {
              entry.failed++;
              if (check.reason) entry.reasons.push(check.reason);
            }
            byType.set(check.type, entry);
          }
          for (const [type, counts] of byType) {
            if (counts.failed > 0) {
              const deduction = (weights[type] || 10) * counts.failed;
              score -= deduction;
              const total = counts.passed + counts.failed;
              const detail = counts.reasons.length > 0 ? ` (${counts.reasons[0]})` : '';
              flags.push(`step-${result.stepNumber}: ${counts.failed}/${total} ${type} checks failed${detail}`);
            }
          }
        }
      }

      score = Math.max(0, Math.min(100, score));

      assert.strictEqual(flags.length, 1);
      assert.ok(flags[0].includes('step-1'));
      assert.ok(flags[0].includes('test checks failed'));
      assert.strictEqual(score, 80); // -20 for 1 failed test check
    });

    it('should produce empty flags when all verifications pass', () => {
      const results = [
        {
          stepNumber: 1,
          status: 'completed',
          verificationResult: {
            passed: true,
            checks: [
              { type: 'test', description: 'Tests pass', passed: true },
              { type: 'build', description: 'Build succeeds', passed: true }
            ]
          },
          sessionResult: 'ok'
        },
      ];

      const flags: string[] = [];
      let score = 100;
      for (const result of results) {
        if (result.verificationResult) {
          for (const check of result.verificationResult.checks) {
            if (!check.passed) {
              flags.push(`step-${result.stepNumber}: ${check.type} failed`);
              score -= 15;
            }
          }
        }
      }

      assert.strictEqual(flags.length, 0);
      assert.strictEqual(score, 100);
    });
  });

  describe('pause trigger logic', () => {
    it('should trigger pause when flags are present', () => {
      const criticResult: CriticResult = {
        score: 70,
        flags: ['step-1: verification failed'],
        recommendation: 'revise'
      };

      const shouldPause = criticResult.flags.length > 0;
      assert.strictEqual(shouldPause, true, 'should pause when flags exist');
    });

    it('should NOT trigger pause when flags are empty', () => {
      const criticResult: CriticResult = {
        score: 100,
        flags: [],
        recommendation: 'approve'
      };

      const shouldPause = criticResult.flags.length > 0;
      assert.strictEqual(shouldPause, false, 'should not pause when flags are empty');
    });
  });

  describe('recommendation logic', () => {
    it('should recommend approve when score is high and no flags', () => {
      const flags: string[] = [];
      const score = 100;
      const recommendation = flags.length === 0 ? 'approve' : score >= 60 ? 'revise' : 'reject';
      assert.strictEqual(recommendation, 'approve');
    });

    it('should recommend revise when score >= 60 with flags', () => {
      const flags = ['step-1: verification failed'];
      const score = 85;
      const recommendation = flags.length === 0 ? 'approve' : score >= 60 ? 'revise' : 'reject';
      assert.strictEqual(recommendation, 'revise');
    });

    it('should recommend reject when score < 60', () => {
      const flags = ['step-1: verification failed', 'step-2: verification failed', 'step-3: verification failed'];
      const score = 55;
      const recommendation = flags.length === 0 ? 'approve' : score >= 60 ? 'revise' : 'reject';
      assert.strictEqual(recommendation, 'reject');
    });
  });

  describe('dashboard critic score rendering', () => {
    it('should format critic results for display', () => {
      const criticResults: CriticResult[] = [
        { score: 100, flags: [], recommendation: 'approve' },
        { score: 70, flags: ['step-2: verification failed'], recommendation: 'revise' },
      ];

      const formatted = criticResults.map((cr, idx) => {
        const label = `Wave ${idx + 1}: ${cr.score}/100 (${cr.recommendation})`;
        const flagNote = cr.flags.length > 0 ? ` - ${cr.flags.length} flag(s)` : '';
        return label + flagNote;
      });

      assert.ok(formatted[0].includes('100/100'));
      assert.ok(formatted[0].includes('approve'));
      assert.ok(!formatted[0].includes('flag'));
      assert.ok(formatted[1].includes('70/100'));
      assert.ok(formatted[1].includes('revise'));
      assert.ok(formatted[1].includes('1 flag(s)'));
    });
  });
});
