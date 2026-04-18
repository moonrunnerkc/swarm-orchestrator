import * as fs from 'fs';
import * as path from 'path';
import { RecoveryEvent, RunMetrics } from './metrics-types';
import { SessionState } from './types';
import { getLogger } from './logger';
const logger = getLogger('metrics-collector');

/**
 * Collects metrics during orchestrator execution
 * Tracks time, commits, verifications, and recovery events
 */
export default class MetricsCollector {
  private executionId: string;
  private goal: string;
  private startTime: Date;
  private endTime?: Date;
  private waveCount: number = 0;
  private stepCount: number = 0;
  private commitCount: number = 0;
  private verificationsPassed: number = 0;
  private verificationsFailed: number = 0;
  private recoveryEvents: RecoveryEvent[] = [];
  private agentsUsed: Set<string> = new Set();

  constructor(executionId: string, goal: string) {
    this.executionId = executionId;
    this.goal = goal;
    this.startTime = new Date();
  }

  /**
   * Mark start of new wave
   */
  startWave(waveNumber: number): void {
    this.waveCount = Math.max(this.waveCount, waveNumber);
  }

  /**
   * Track step execution
   */
  trackStep(stepNumber: number, agentName: string): void {
    this.stepCount = Math.max(this.stepCount, stepNumber);
    this.agentsUsed.add(agentName);
  }

  /**
   * Track commit produced
   */
  trackCommit(agentName?: string): void {
    this.commitCount++;
    if (agentName) {
      this.agentsUsed.add(agentName);
    }
  }

  /**
   * Track verification result
   */
  trackVerification(passed: boolean): void {
    if (passed) {
      this.verificationsPassed++;
    } else {
      this.verificationsFailed++;
    }
  }

  /**
   * Track recovery event
   */
  trackRecovery(event: RecoveryEvent): void {
    this.recoveryEvents.push(event);
    this.agentsUsed.add(event.agentName);
  }

  /**
   * Mark execution end and finalize metrics
   */
  finalize(): RunMetrics {
    this.endTime = new Date();

    return {
      executionId: this.executionId,
      goal: this.goal,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime.toISOString(),
      totalTimeMs: this.endTime.getTime() - this.startTime.getTime(),
      waveCount: this.waveCount,
      stepCount: this.stepCount,
      commitCount: this.commitCount,
      verificationsPassed: this.verificationsPassed,
      verificationsFailed: this.verificationsFailed,
      recoveryEvents: this.recoveryEvents,
      agentsUsed: Array.from(this.agentsUsed).sort()
    };
  }

  /**
   * Get current metrics snapshot (without finalizing)
   */
  getSnapshot(): Partial<RunMetrics> {
    const now = new Date();

    return {
      executionId: this.executionId,
      goal: this.goal,
      startTime: this.startTime.toISOString(),
      totalTimeMs: now.getTime() - this.startTime.getTime(),
      waveCount: this.waveCount,
      stepCount: this.stepCount,
      commitCount: this.commitCount,
      verificationsPassed: this.verificationsPassed,
      verificationsFailed: this.verificationsFailed,
      recoveryEvents: this.recoveryEvents,
      agentsUsed: Array.from(this.agentsUsed).sort()
    };
  }

  /**
   * Persist full session state to runs/<id>/session-state.json.
   * Creates the directory if missing.
   */
  saveSession(id: string, state: SessionState): void {
    const dir = path.join(process.cwd(), 'runs', id);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, 'session-state.json'), JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Load a previously saved session. Returns null if not found.
   */
  loadSession(id: string): SessionState | null {
    const filePath = path.join(process.cwd(), 'runs', id, 'session-state.json');
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SessionState;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[metrics] Failed to load session ${id}: ${msg}`);
      return null;
    }
  }

  /**
   * Generate a Markdown audit report from session state.
   */
  generateAuditReport(state: SessionState): string {
    const lines: string[] = [
      `# Audit Report: ${state.sessionId}`,
      '',
      '## Timeline',
      `- Status: ${state.status}`,
      `- Last completed step: ${state.lastCompletedStep}`,
      `- Total steps: ${state.graph.steps.length}`,
      '',
      '## Cost Breakdown',
      `- Steps executed: ${state.lastCompletedStep}`,
      `- Branches: ${Object.keys(state.branchMap).length}`,
      `- Transcripts: ${Object.keys(state.transcripts).length}`,
      '',
      '## Diffs Summary',
      ...state.graph.steps.map(s => {
        const branch = state.branchMap[String(s.stepNumber)] || 'no branch';
        return `- Step ${s.stepNumber} (${s.agent}): branch \`${branch}\``;
      }),
      '',
      '## Gates',
      ...state.gateResults.map(g => `- ${g.title}: ${g.status} (${g.issues.length} issue(s))`),
      '',
      '## Evidence',
      ...state.graph.steps.map(s => {
        const transcript = state.transcripts[String(s.stepNumber)];
        if (transcript) {
          const lineCount = transcript.split('\n').length;
          return `- Step ${s.stepNumber} (${s.agent}): transcript present (${lineCount} lines)`;
        }
        return `- Step ${s.stepNumber} (${s.agent}): no transcript`;
      }),
      '',
      '## Steps',
      ...state.graph.steps.map(s => `- Step ${s.stepNumber}: ${s.task} (${s.agent})`),
    ];
    return lines.join('\n');
  }
}
