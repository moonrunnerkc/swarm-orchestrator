// Author: Bradley R. Kinnard
import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import MetricsCollector from '../src/metrics-collector';
import { SessionState } from '../src/types';

describe('Upgrade 2: Persistent Sessions + Audit', () => {
  const testSessionId = 'test-session-upgrade2';
  const sessionDir = path.join(process.cwd(), 'runs', testSessionId);

  const sampleState: SessionState = {
    sessionId: testSessionId,
    graph: {
      goal: 'Build REST API',
      steps: [
        { stepNumber: 1, task: 'Scaffold project', agent: 'worker' },
        { stepNumber: 2, task: 'Add auth', agent: 'worker' },
        { stepNumber: 3, task: 'Write tests', agent: 'worker' },
        { stepNumber: 4, task: 'Add docs', agent: 'worker' },
        { stepNumber: 5, task: 'Deploy', agent: 'worker' },
        { stepNumber: 6, task: 'Final review', agent: 'worker' },
      ]
    },
    branchMap: { 'step-1': 'swarm/exec-1/step-1', 'step-2': 'swarm/exec-1/step-2' },
    transcripts: { 'step-1': '/runs/exec-1/steps/step-1/share.md' },
    metrics: { totalTimeMs: 120000, commitCount: 5 },
    gateResults: [
      { id: 'scaffold', title: 'Scaffold Defaults', status: 'pass', issues: [] },
      { id: 'dupes', title: 'Duplicate Blocks', status: 'fail', issues: [{ message: 'found duplication' }] }
    ],
    status: 'paused',
    lastCompletedStep: 3
  };

  afterEach(() => {
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }
  });

  describe('save/load roundtrip', () => {
    it('should save and load session state with deep equality', () => {
      const collector = new MetricsCollector('roundtrip-test', 'test');
      collector.saveSession(testSessionId, sampleState);

      const loaded = collector.loadSession(testSessionId);
      assert.deepStrictEqual(loaded, sampleState);
    });

    it('should return null for missing session', () => {
      const collector = new MetricsCollector('missing-test', 'test');
      const loaded = collector.loadSession('nonexistent-session-id');
      assert.strictEqual(loaded, null);
    });
  });

  describe('resume from checkpoint', () => {
    it('should load session at step 3 with lastCompletedStep=3', () => {
      const collector = new MetricsCollector('resume-test', 'test');
      collector.saveSession(testSessionId, sampleState);

      const loaded = collector.loadSession(testSessionId);
      assert.ok(loaded);
      assert.strictEqual(loaded.lastCompletedStep, 3);
      assert.strictEqual(loaded.status, 'paused');
      // execution would resume from step 4 (lastCompletedStep + 1)
      const nextStep = loaded.lastCompletedStep + 1;
      assert.strictEqual(nextStep, 4);
      assert.strictEqual(loaded.graph.steps.length, 6);
    });
  });

  describe('audit report', () => {
    it('should produce Markdown with timeline, cost, and gates sections', () => {
      const collector = new MetricsCollector('audit-test', 'test');
      const report = collector.generateAuditReport(sampleState);

      assert.ok(report.includes('# Audit Report:'), 'should have title');
      assert.ok(report.includes('## Timeline'), 'should have timeline section');
      assert.ok(report.includes('## Cost Breakdown'), 'should have cost section');
      assert.ok(report.includes('## Gates'), 'should have gates section');
      assert.ok(report.includes('Scaffold Defaults: pass'), 'should list gate results');
      assert.ok(report.includes('Duplicate Blocks: fail'), 'should list failed gates');
      assert.ok(report.includes('1 issue(s)'), 'should show issue count');
      assert.ok(report.includes('Step 1: Scaffold project'), 'should list steps');
    });
  });

});
