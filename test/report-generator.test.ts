import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ReportGenerator, RunReport } from '../src/report-generator';

function seedRunDir(runDir: string, opts: {
  sessionState?: boolean;
  metrics?: boolean;
  costAttribution?: boolean;
  owaspCompliance?: boolean;
  falsificationBattery?: boolean;
  verification?: Record<number, { passed: boolean }>;
} = {}): void {
  const {
    sessionState = true,
    metrics = true,
    costAttribution = false,
    owaspCompliance = false,
    falsificationBattery = false,
    verification = {}
  } = opts;

  if (sessionState) {
    fs.writeFileSync(path.join(runDir, 'session-state.json'), JSON.stringify({
      sessionId: path.basename(runDir),
      graph: {
        goal: 'Add JWT authentication',
        steps: [
          { stepNumber: 1, task: 'Add JWT middleware', agent: 'worker' },
          { stepNumber: 2, task: 'Write auth tests', agent: 'worker' }
        ]
      },
      branchMap: { '1': 'swarm/step-1', '2': 'swarm/step-2' },
      transcripts: { '1': 'steps/step-1/share.md', '2': 'steps/step-2/share.md' },
      metrics: {},
      gateResults: [],
      status: 'completed',
      lastCompletedStep: 2
    }, null, 2));
  }

  if (metrics) {
    fs.writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify({
      executionId: path.basename(runDir),
      goal: 'Add JWT authentication',
      startTime: '2026-04-08T12:00:00.000Z',
      endTime: '2026-04-08T12:08:05.000Z',
      totalTimeMs: 485000,
      waveCount: 1,
      stepCount: 2,
      commitCount: 4,
      verificationsPassed: 2,
      verificationsFailed: 0,
      recoveryEvents: [],
      agentsUsed: ['worker', 'worker']
    }, null, 2));
  }

  if (costAttribution) {
    fs.writeFileSync(path.join(runDir, 'cost-attribution.json'), JSON.stringify({
      totalEstimatedPremiumRequests: 14,
      totalActualPremiumRequests: 12,
      estimateAccuracy: 0.857,
      modelUsed: 'claude-sonnet-4',
      modelMultiplier: 1.0,
      overageTriggered: false,
      perStep: [
        { stepNumber: 1, agentName: 'worker', estimatedPremiumRequests: 8, actualPremiumRequests: 7, retryCount: 0, promptTokens: 3200, fleetMode: false, durationMs: 240000 },
        { stepNumber: 2, agentName: 'worker', estimatedPremiumRequests: 6, actualPremiumRequests: 5, retryCount: 0, promptTokens: 2100, fleetMode: false, durationMs: 180000 }
      ]
    }, null, 2));
  }

  if (owaspCompliance) {
    fs.writeFileSync(path.join(runDir, 'owasp-compliance.json'), JSON.stringify({
      generatedAt: '2026-04-08T12:08:05.000Z',
      executionId: path.basename(runDir),
      toolVersion: '4.1.0',
      applicableRisks: 6,
      mitigatedRisks: 5,
      partialRisks: 1,
      notApplicableRisks: 4,
      risks: []
    }, null, 2));
  }

  if (falsificationBattery) {
    fs.writeFileSync(path.join(runDir, 'falsification-battery.json'), JSON.stringify({
      compositeScore: 0.82,
      humanReviewRequired: false,
      layers: [
        { layer: 'intent', status: 'PASS', evidenceSummary: 'differential test passed', durationMs: 20 }
      ]
    }, null, 2));
  }

  // Verification reports
  for (const [stepNum, result] of Object.entries(verification)) {
    const verDir = path.join(runDir, 'verification');
    fs.mkdirSync(verDir, { recursive: true });
    fs.writeFileSync(path.join(verDir, `step-${stepNum}-verification.md`),
      `# Verification: Step ${stepNum}\nResult: ${result.passed ? 'PASSED' : 'FAILED'}\n`
    );
  }
}

describe('ReportGenerator', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'report-gen-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('generate', () => {
    it('assembles a complete report from all artifacts', () => {
      const runDir = path.join(tmpDir, 'swarm-test-run');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, {
        sessionState: true,
        metrics: true,
        costAttribution: true,
        owaspCompliance: true,
        verification: { 1: { passed: true }, 2: { passed: true } }
      });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.executionId, 'swarm-test-run');
      assert.strictEqual(report.goal, 'Add JWT authentication');
      assert.strictEqual(report.startedAt, '2026-04-08T12:00:00.000Z');
      assert.strictEqual(report.durationMs, 485000);
      assert.strictEqual(report.steps.length, 2);
      assert.strictEqual(report.results.attempted, 2);
      assert.strictEqual(report.results.passed, 2);
      assert.strictEqual(report.waves.count, 1);
      assert.ok(report.cost !== null);
      assert.strictEqual(report.cost!.estimatedPremiumRequests, 14);
      assert.strictEqual(report.cost!.actualPremiumRequests, 12);
      assert.ok(report.owaspSummary !== null);
      assert.strictEqual(report.owaspSummary!.applicableRisks, 6);
      assert.strictEqual(report.falsificationBattery, null);
    });

    it('includes falsification battery results when present', () => {
      const runDir = path.join(tmpDir, 'swarm-falsification');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { falsificationBattery: true });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.ok(report.falsificationBattery !== null);
      assert.strictEqual(report.falsificationBattery!.compositeScore, 0.82);
      assert.ok(report.falsificationBattery!.layers);
      assert.strictEqual(report.falsificationBattery!.layers[0].layer, 'intent');
    });

    it('returns null cost when cost-attribution.json is missing', () => {
      const runDir = path.join(tmpDir, 'swarm-no-cost');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { costAttribution: false });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.cost, null);
    });

    it('returns null owaspSummary when owasp-compliance.json is missing', () => {
      const runDir = path.join(tmpDir, 'swarm-no-owasp');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { owaspCompliance: false });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.owaspSummary, null);
    });

    it('throws when session-state.json is missing', () => {
      const runDir = path.join(tmpDir, 'swarm-missing-state');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { sessionState: false, metrics: true });

      const gen = new ReportGenerator();
      assert.throws(() => gen.generate(runDir), /session-state\.json not found/);
    });

    it('throws when metrics.json is missing', () => {
      const runDir = path.join(tmpDir, 'swarm-missing-metrics');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { sessionState: true, metrics: false });

      const gen = new ReportGenerator();
      assert.throws(() => gen.generate(runDir), /metrics\.json not found/);
    });

    it('throws when run directory does not exist', () => {
      const gen = new ReportGenerator();
      assert.throws(() => gen.generate('/nonexistent/path'), /Run directory not found/);
    });

    it('builds step summaries from session state and cost attribution', () => {
      const runDir = path.join(tmpDir, 'swarm-steps');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { costAttribution: true });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.steps[0].stepNumber, 1);
      assert.strictEqual(report.steps[0].agentName, 'worker');
      assert.strictEqual(report.steps[0].task, 'Add JWT middleware');
      assert.strictEqual(report.steps[0].estimatedCost, 8);
      assert.strictEqual(report.steps[0].actualCost, 7);
      assert.strictEqual(report.steps[0].durationMs, 240000);
    });

    it('step summaries have null costs when cost attribution is missing', () => {
      const runDir = path.join(tmpDir, 'swarm-no-step-cost');
      fs.mkdirSync(runDir);
      seedRunDir(runDir, { costAttribution: false });

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.steps[0].estimatedCost, null);
      assert.strictEqual(report.steps[0].actualCost, null);
    });

    it('handles malformed cost-attribution.json gracefully', () => {
      const runDir = path.join(tmpDir, 'swarm-bad-cost');
      fs.mkdirSync(runDir);
      seedRunDir(runDir);
      fs.writeFileSync(path.join(runDir, 'cost-attribution.json'), 'not json');

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.cost, null);
    });

    it('handles malformed owasp-compliance.json gracefully', () => {
      const runDir = path.join(tmpDir, 'swarm-bad-owasp');
      fs.mkdirSync(runDir);
      seedRunDir(runDir);
      fs.writeFileSync(path.join(runDir, 'owasp-compliance.json'), '{broken');

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.owaspSummary, null);
    });

    it('extracts verification stats from metrics', () => {
      const runDir = path.join(tmpDir, 'swarm-ver-stats');
      fs.mkdirSync(runDir);
      seedRunDir(runDir);

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.verification.buildPasses + report.verification.testPasses >= 0, true);
    });

    it('computes repaired count from recovery events', () => {
      const runDir = path.join(tmpDir, 'swarm-repaired');
      fs.mkdirSync(runDir);
      seedRunDir(runDir);
      // Override metrics with recovery events
      const metricsRaw = JSON.parse(fs.readFileSync(path.join(runDir, 'metrics.json'), 'utf8'));
      metricsRaw.recoveryEvents = [
        { stepNumber: 1, agentName: 'worker', failedAt: '2026-04-08T12:01:00Z', recoveredAt: '2026-04-08T12:03:00Z', recoveryMethod: 'retry' }
      ];
      fs.writeFileSync(path.join(runDir, 'metrics.json'), JSON.stringify(metricsRaw, null, 2));

      const gen = new ReportGenerator();
      const report = gen.generate(runDir);

      assert.strictEqual(report.results.repaired, 1);
    });
  });
});
