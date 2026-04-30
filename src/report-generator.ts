import * as fs from 'fs';
import * as path from 'path';
import { RunMetrics, CostAttribution, StepCostRecord } from './metrics-types';
import { SessionState } from './types';

export interface StepSummary {
  stepNumber: number;
  agentName: string;
  task: string;
  verificationStatus: 'passed' | 'failed' | 'repaired';
  checksPassed: string[];
  checksFailed: string[];
  repairAttempts: number;
  estimatedCost: number | null;
  actualCost: number | null;
  durationMs: number;
}

export interface RunReport {
  executionId: string;
  goal: string;
  tool: string;
  model: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: StepSummary[];
  results: {
    attempted: number;
    passed: number;
    failed: number;
    repaired: number;
  };
  waves: {
    count: number;
  };
  cost: {
    estimatedPremiumRequests: number;
    actualPremiumRequests: number;
    accuracy: number;
    modelMultiplier: number;
    overageTriggered: boolean;
  } | null;
  owaspSummary: {
    applicableRisks: number;
    mitigatedRisks: number;
    partialRisks: number;
  } | null;
  verification: {
    totalGitDiffs: number;
    buildPasses: number;
    testPasses: number;
    transcriptMatches: number;
  };
  falsificationBattery: FalsificationBatteryReport | null;
}

export interface FalsificationBatteryReport {
  compositeScore: number;
  humanReviewRequired: boolean;
  layers: Array<{
    layer: string;
    status: string;
    evidenceSummary: string;
    durationMs: number;
  }>;
}

function readJsonSafe<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readJsonRequired<T>(filePath: string, label: string): T {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export class ReportGenerator {
  generate(runDir: string): RunReport {
    if (!fs.existsSync(runDir)) {
      throw new Error(`Run directory not found: ${runDir}`);
    }

    const sessionState = readJsonRequired<SessionState>(
      path.join(runDir, 'session-state.json'),
      'session-state.json'
    );
    const metrics = readJsonRequired<RunMetrics>(
      path.join(runDir, 'metrics.json'),
      'metrics.json'
    );
    const costAttribution = readJsonSafe<CostAttribution>(
      path.join(runDir, 'cost-attribution.json')
    );
    const owaspRaw = readJsonSafe<{
      applicableRisks: number;
      mitigatedRisks: number;
      partialRisks: number;
    }>(path.join(runDir, 'owasp-compliance.json'));
    const falsificationBattery = readJsonSafe<FalsificationBatteryReport>(
      path.join(runDir, 'falsification-battery.json')
    );

    // Build a lookup for per-step cost data
    const costByStep = new Map<number, StepCostRecord>();
    if (costAttribution?.perStep) {
      for (const record of costAttribution.perStep) {
        costByStep.set(record.stepNumber, record);
      }
    }

    // Identify repaired steps from recovery events
    const repairedSteps = new Set<number>();
    if (metrics.recoveryEvents) {
      for (const event of metrics.recoveryEvents) {
        repairedSteps.add(event.stepNumber);
      }
    }

    const steps: StepSummary[] = sessionState.graph.steps.map(step => {
      const costRecord = costByStep.get(step.stepNumber);
      const wasRepaired = repairedSteps.has(step.stepNumber);

      // Determine verification status from session state
      let verificationStatus: 'passed' | 'failed' | 'repaired' = 'passed';
      if (wasRepaired) {
        verificationStatus = 'repaired';
      } else if (sessionState.status === 'failed' && step.stepNumber > sessionState.lastCompletedStep) {
        verificationStatus = 'failed';
      }

      return {
        stepNumber: step.stepNumber,
        agentName: step.agent,
        task: step.task,
        verificationStatus,
        checksPassed: [],
        checksFailed: [],
        repairAttempts: wasRepaired ? 1 : 0,
        estimatedCost: costRecord?.estimatedPremiumRequests ?? null,
        actualCost: costRecord?.actualPremiumRequests ?? null,
        durationMs: costRecord?.durationMs ?? 0
      };
    });

    const failedCount = steps.filter(s => s.verificationStatus === 'failed').length;
    const repairedCount = steps.filter(s => s.verificationStatus === 'repaired').length;
    const passedCount = steps.length - failedCount - repairedCount;

    return {
      executionId: path.basename(runDir),
      goal: sessionState.graph.goal,
      tool: 'swarm-orchestrator',
      model: costAttribution?.modelUsed ?? 'unknown',
      startedAt: metrics.startTime,
      completedAt: metrics.endTime,
      durationMs: metrics.totalTimeMs,
      steps,
      results: {
        attempted: steps.length,
        passed: passedCount,
        failed: failedCount,
        repaired: repairedCount
      },
      waves: {
        count: metrics.waveCount
      },
      cost: costAttribution ? {
        estimatedPremiumRequests: costAttribution.totalEstimatedPremiumRequests,
        actualPremiumRequests: costAttribution.totalActualPremiumRequests,
        accuracy: costAttribution.estimateAccuracy,
        modelMultiplier: costAttribution.modelMultiplier,
        overageTriggered: costAttribution.overageTriggered
      } : null,
      owaspSummary: owaspRaw ? {
        applicableRisks: owaspRaw.applicableRisks,
        mitigatedRisks: owaspRaw.mitigatedRisks,
        partialRisks: owaspRaw.partialRisks
      } : null,
      verification: {
        totalGitDiffs: metrics.commitCount,
        buildPasses: metrics.verificationsPassed,
        testPasses: metrics.verificationsPassed,
        transcriptMatches: 0
      },
      falsificationBattery
    };
  }
}
