// Alternative intra-wave executor using Copilot CLI's native /fleet dispatch.
// Instead of spawning N independent copilot -p subprocesses per wave, this sends
// a single /fleet prompt containing all wave subtasks. The model decides how to
// parallelize internally. Falls back to subprocess mode if /fleet fails.

import * as fs from 'fs';
import * as path from 'path';
import { AgentProfile } from './config-loader';
import { FleetWrapper } from './fleet-wrapper';
import { PlanStep } from './plan-generator';
import SessionExecutor, { SessionOptions, SessionResult } from './session-executor';

/**
 * A single subtask within a fleet dispatch, mapping to one plan step.
 */
export interface FleetSubtask {
  stepNumber: number;
  agentName: string;
  task: string;
  scope: string[];
  boundaries: string[];
  expectedOutputs: string[];
}

/**
 * Result of a fleet dispatch for an entire wave.
 */
export interface FleetWaveResult {
  success: boolean;
  mode: 'fleet' | 'fallback';
  sessionResult: SessionResult;
  subtaskResults: FleetSubtaskResult[];
  prompt: string;
}

/**
 * Per-subtask result parsed from the fleet session output.
 */
export interface FleetSubtaskResult {
  stepNumber: number;
  agentName: string;
  completed: boolean;
  outputFragment: string;
}

/**
 * Dispatches an entire wave of steps via a single /fleet prompt.
 * The orchestrator retains control of inter-wave scheduling, verification,
 * quality gates, and merge. This executor only handles intra-wave dispatch.
 */
export class FleetExecutor {
  private workingDir: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
  }

  /**
   * Check if fleet dispatch is available by verifying the copilot CLI version.
   */
  isAvailable(): boolean {
    return FleetWrapper.isFleetAvailable(this.workingDir);
  }

  /**
   * Execute a wave of steps as a single /fleet dispatch.
   * Returns structured results mapped back to individual steps.
   */
  async executeWave(
    steps: PlanStep[],
    agents: Map<string, AgentProfile>,
    options: {
      model?: string | undefined;
      runDir: string;
      executionId: string;
      mainBranch: string;
      transcriptDir: string;
    }
  ): Promise<FleetWaveResult> {
    const subtasks = this.buildSubtasks(steps, agents);
    const prompt = this.buildFleetPrompt(subtasks, options.executionId);

    // Ensure transcript directory exists
    if (!fs.existsSync(options.transcriptDir)) {
      fs.mkdirSync(options.transcriptDir, { recursive: true });
    }

    const transcriptPath = path.join(
      options.transcriptDir,
      `fleet-wave-${Date.now()}.md`
    );

    const executor = new SessionExecutor(this.workingDir);
    const sessionOptions: SessionOptions = {
      allowAllTools: true,
      shareToFile: transcriptPath,
      logPrefix: '[fleet]',
      ...(options.model && { model: options.model })
    };

    const sessionResult = await executor.executeSession(
      `/fleet ${prompt}`,
      sessionOptions
    );

    const subtaskResults = this.parseSubtaskResults(
      sessionResult.output,
      subtasks
    );

    return {
      success: sessionResult.success,
      mode: 'fleet',
      sessionResult,
      subtaskResults,
      prompt
    };
  }

  /**
   * Build subtask descriptors from plan steps and agent profiles.
   */
  buildSubtasks(
    steps: PlanStep[],
    agents: Map<string, AgentProfile>
  ): FleetSubtask[] {
    return steps.map(step => {
      const agent = agents.get(step.agentName);
      return {
        stepNumber: step.stepNumber,
        agentName: step.agentName,
        task: step.task,
        scope: agent?.scope || [],
        boundaries: agent?.boundaries || [],
        expectedOutputs: step.expectedOutputs
      };
    });
  }

  /**
   * Construct a single /fleet prompt that contains all wave subtasks.
   * Each subtask is clearly delimited with its step number, agent assignment,
   * and scope boundaries so the fleet model can distribute work properly.
   */
  buildFleetPrompt(subtasks: FleetSubtask[], executionId: string): string {
    const sections: string[] = [];

    sections.push('=== FLEET DISPATCH: Parallel Subtasks ===');
    sections.push(`Execution: ${executionId}`);
    sections.push(`Total subtasks: ${subtasks.length}`);
    sections.push('');
    sections.push('Execute all of the following subtasks in parallel.');
    sections.push('Each subtask must be completed independently.');
    sections.push('Commit changes with descriptive messages after each subtask.');
    sections.push('Report completion status for each subtask by number.');
    sections.push('');

    for (const sub of subtasks) {
      sections.push(`--- Subtask ${sub.stepNumber} (${sub.agentName}) ---`);
      sections.push(`Task: ${sub.task}`);

      if (sub.scope.length > 0) {
        sections.push('Scope:');
        for (const s of sub.scope) {
          sections.push(`  - ${s}`);
        }
      }

      if (sub.boundaries.length > 0) {
        sections.push('Boundaries:');
        for (const b of sub.boundaries) {
          sections.push(`  - ${b}`);
        }
      }

      if (sub.expectedOutputs.length > 0) {
        sections.push('Expected outputs:');
        for (const o of sub.expectedOutputs) {
          sections.push(`  - ${o}`);
        }
      }

      sections.push('');
    }

    sections.push('=== END FLEET DISPATCH ===');
    return sections.join('\n');
  }

  /**
   * Parse the fleet session output to determine per-subtask completion status.
   * Uses heuristics since /fleet output format is not strictly defined.
   */
  parseSubtaskResults(
    output: string,
    subtasks: FleetSubtask[]
  ): FleetSubtaskResult[] {
    const outputLower = output.toLowerCase();

    return subtasks.map(sub => {
      // Look for completion signals for this subtask
      const stepRef = `subtask ${sub.stepNumber}`;
      const stepDone = `step ${sub.stepNumber}`;

      const completionSignals = [
        `${stepRef} complete`,
        `${stepRef} done`,
        `${stepRef}: complete`,
        `${stepRef}: done`,
        `${stepDone} complete`,
        `${stepDone} done`,
        `completed subtask ${sub.stepNumber}`,
        `finished step ${sub.stepNumber}`,
        // Fleet often uses checkmark or success emoji patterns
        `subtask ${sub.stepNumber} ✅`,
        `subtask ${sub.stepNumber} ✓`,
        `**subtask ${sub.stepNumber} ✅**`,
        `**subtask ${sub.stepNumber}**`,
        `subtask ${sub.stepNumber}:`,
      ];

      // Also match markdown-formatted completion like "**Subtask 1 (worker):** ... ✅"
      // The agent name, parentheses, colons, and other text may appear between
      // the step number and the completion indicator.
      const checkmarkPattern = new RegExp(
        `(?:subtask|step)\\s*${sub.stepNumber}\\b[^\\n]*(?:✅|✓|complete|done|finished)`,
        'i'
      );

      const completed = completionSignals.some(signal =>
        outputLower.includes(signal.toLowerCase())
      ) || checkmarkPattern.test(output);

      // Extract the output fragment around this subtask's references
      const fragment = this.extractSubtaskFragment(output, sub.stepNumber);

      return {
        stepNumber: sub.stepNumber,
        agentName: sub.agentName,
        completed,
        outputFragment: fragment
      };
    });
  }

  /**
   * Extract the portion of output that references a specific subtask number.
   * Returns up to 500 chars around the first mention.
   */
  private extractSubtaskFragment(output: string, stepNumber: number): string {
    const patterns = [
      new RegExp(`(?:subtask|step)\\s*${stepNumber}`, 'i'),
      new RegExp(`#${stepNumber}\\b`, 'i')
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match && match.index !== undefined) {
        const start = Math.max(0, match.index - 100);
        const end = Math.min(output.length, match.index + 400);
        return output.slice(start, end);
      }
    }

    return '';
  }

  /**
   * Estimate the cost multiplier for fleet mode vs subprocess mode.
   * Fleet subagents typically use lower-cost models by default.
   */
  static estimateCostMultiplier(stepCount: number): number {
    // Fleet dispatch uses ~1 premium request for the coordinator,
    // plus subagents which may use cheaper models. Estimate 60% of
    // the subprocess cost for plans with 3+ steps.
    if (stepCount >= 3) return 0.6;
    if (stepCount >= 2) return 0.8;
    return 1.0; // Single step: no benefit from fleet
  }
}

export default FleetExecutor;
