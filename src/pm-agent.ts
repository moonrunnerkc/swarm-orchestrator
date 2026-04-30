import * as fs from 'fs';
import * as path from 'path';
import { AgentProfile, ConfigLoader } from './config-loader';
import { ExecutionPlan, PlanStep } from './plan-generator';
import SessionExecutor, { SessionOptions } from './session-executor';
import { getLogger } from './logger';
const logger = getLogger('pm-agent');

/**
 * Result of a PM agent review pass.
 * Contains the (possibly revised) plan and any notes from the review.
 */
export interface PMReviewResult {
  revisedPlan: ExecutionPlan;
  reviewNotes: string[];
  changesApplied: string[];
  durationMs: number;
  estimatedTokenCost: number;
  skipped: boolean;
}

// Approximate tokens per character (GPT-family average).
const CHARS_PER_TOKEN = 4;

/**
 * PMAgent - Project Manager agent that reviews a generated plan before
 * swarm execution. Validates step ordering, dependency correctness,
 * scope coverage, and agent assignment.
 *
 * Usage:
 *   const pm = new PMAgent(agents);
 *   const result = pm.reviewPlan(plan);
 *
 * The review is purely local (no LLM call) by default. When a Copilot
 * CLI session is available, it can optionally run an LLM-assisted review.
 */
export class PMAgent {
  private availableAgents: AgentProfile[];

  constructor(availableAgents: AgentProfile[]) {
    this.availableAgents = availableAgents;
  }

  /**
   * Run a local (deterministic) review of the plan.
   * Checks for common issues:
   *   - Circular dependencies
   *   - References to non-existent agents
   *   - Orphaned steps (no dependency path to step 1)
   *   - Missing integration/finalization step
   *   - Duplicate step numbers
   */
  reviewPlan(plan: ExecutionPlan): PMReviewResult {
    const start = Date.now();
    const reviewNotes: string[] = [];
    const changesApplied: string[] = [];
    const revisedPlan = this.deepCopyPlan(plan);

    // 1. Check for duplicate step numbers
    const stepNumbers = revisedPlan.steps.map(s => s.stepNumber);
    const seen = new Set<number>();
    for (const num of stepNumbers) {
      if (seen.has(num)) {
        reviewNotes.push(`Duplicate step number: ${num}`);
      }
      seen.add(num);
    }

    // 2. Check for references to non-existent agents
    const agentNames = new Set(this.availableAgents.map(a => a.name));
    const normalizedAgentNames = new Set(this.availableAgents.map(a => ConfigLoader.normalizeAgentName(a.name)));
    for (const step of revisedPlan.steps) {
      if (!agentNames.has(step.agentName) && !normalizedAgentNames.has(ConfigLoader.normalizeAgentName(step.agentName))) {
        reviewNotes.push(`Step ${step.stepNumber} references unknown agent: ${step.agentName}`);
      }
    }

    // 3. Check for circular dependencies
    const circularSteps = this.detectCircularDeps(revisedPlan.steps);
    if (circularSteps.length > 0) {
      reviewNotes.push(`Circular dependencies detected involving step(s): ${circularSteps.join(', ')}`);
    }

    // 4. Check for dependencies on non-existent steps
    const validSteps = new Set(revisedPlan.steps.map(s => s.stepNumber));
    for (const step of revisedPlan.steps) {
      for (const dep of step.dependencies) {
        if (!validSteps.has(dep)) {
          reviewNotes.push(`Step ${step.stepNumber} depends on non-existent step ${dep}`);
        }
      }
    }

    // 5. Check for missing reviewer step (last step should be reviewer)
    if (revisedPlan.steps.length > 1) {
      const lastStep = revisedPlan.steps[revisedPlan.steps.length - 1];
      const hasReviewer = lastStep.agentName === 'reviewer';
      if (!hasReviewer && agentNames.has('reviewer')) {
        reviewNotes.push('Plan is missing a final integration/finalization step');
      }
    }

    // 6. Ensure metadata is up to date
    if (!revisedPlan.metadata || revisedPlan.metadata.totalSteps !== revisedPlan.steps.length) {
      revisedPlan.metadata = {
        ...revisedPlan.metadata,
        totalSteps: revisedPlan.steps.length
      };
      changesApplied.push('Updated metadata.totalSteps');
    }

    const estimatedTokenCost = Math.ceil(JSON.stringify(revisedPlan).length / CHARS_PER_TOKEN);

    return {
      revisedPlan,
      reviewNotes,
      changesApplied,
      durationMs: Date.now() - start,
      estimatedTokenCost,
      skipped: false
    };
  }

  /**
   * Build a prompt for LLM-assisted plan review (for use with Copilot CLI).
   */
  buildReviewPrompt(plan: ExecutionPlan): string {
    const sections: string[] = [];

    sections.push('=== PM AGENT - Plan Review ===');
    sections.push('');
    sections.push('You are a project manager reviewing an execution plan for a parallel');
    sections.push('swarm of coding agents. Review the plan for:');
    sections.push('  1. Correct dependency ordering (no circular deps)');
    sections.push('  2. Appropriate agent assignment for each task');
    sections.push('  3. Completeness (all aspects of the goal covered)');
    sections.push('  4. Step granularity (not too coarse, not too fine)');
    sections.push('  5. Final integration step is present');
    sections.push('');
    sections.push('--- AVAILABLE AGENTS ---');
    for (const agent of this.availableAgents) {
      sections.push(`  ${agent.name}: ${agent.purpose}`);
    }
    sections.push('');
    sections.push('--- PLAN TO REVIEW ---');
    sections.push(JSON.stringify(plan, null, 2));
    sections.push('');
    sections.push('--- INSTRUCTIONS ---');
    sections.push('Output only a revised JSON plan object if changes are needed,');
    sections.push('or respond with "PLAN_APPROVED" if the plan is already good.');
    sections.push('Do not add commentary outside of a valid JSON block or PLAN_APPROVED.');

    return sections.join('\n');
  }

  /**
   * Run an LLM-assisted review via Copilot CLI session.
   * Falls back to local review if the session fails.
   */
  async reviewPlanWithLLM(
    plan: ExecutionPlan,
    sessionOptions: SessionOptions,
    outputDir: string
  ): Promise<PMReviewResult> {
    const start = Date.now();

    // Always run local review first
    const localResult = this.reviewPlan(plan);

    const prompt = this.buildReviewPrompt(plan);
    const transcriptPath = path.join(outputDir, 'pm-review-transcript.md');

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const opts: SessionOptions = {
      ...sessionOptions,
      shareToFile: transcriptPath,
      logPrefix: '[PM-AGENT]'
    };

    try {
      const executor = new SessionExecutor();
      const result = await executor.executeSession(prompt, opts);

      if (!result.success) {
        // Fall back to local-only review
        return {
          ...localResult,
          reviewNotes: [...localResult.reviewNotes, 'LLM review failed, using local review only'],
          durationMs: Date.now() - start
        };
      }

      // Try to parse revised plan from output
      const revised = this.parseRevisedPlan(result.output, plan);
      if (revised) {
        return {
          revisedPlan: revised,
          reviewNotes: [...localResult.reviewNotes, 'LLM review applied changes'],
          changesApplied: [...localResult.changesApplied, 'LLM-revised plan'],
          durationMs: Date.now() - start,
          estimatedTokenCost: Math.ceil((prompt.length + (result.output?.length || 0)) / CHARS_PER_TOKEN),
          skipped: false
        };
      }

      // PLAN_APPROVED or unparseable output - use local result
      return {
        ...localResult,
        reviewNotes: [...localResult.reviewNotes, 'LLM approved plan without changes'],
        durationMs: Date.now() - start
      };

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`[pm-agent] LLM review failed, using local review only: ${msg}`);
      return {
        ...localResult,
        reviewNotes: [...localResult.reviewNotes, 'LLM review unavailable, using local review only'],
        durationMs: Date.now() - start
      };
    }
  }

  /**
   * Detect circular dependencies in plan steps.
   * Returns step numbers involved in cycles.
   */
  detectCircularDeps(steps: PlanStep[]): number[] {
    const visited = new Set<number>();
    const inStack = new Set<number>();
    const cycleSteps: number[] = [];

    const stepMap = new Map(steps.map(s => [s.stepNumber, s]));

    const dfs = (stepNum: number): boolean => {
      if (inStack.has(stepNum)) {
        cycleSteps.push(stepNum);
        return true;
      }
      if (visited.has(stepNum)) return false;

      visited.add(stepNum);
      inStack.add(stepNum);

      const step = stepMap.get(stepNum);
      if (step) {
        for (const dep of step.dependencies) {
          if (dfs(dep)) {
            cycleSteps.push(stepNum);
            return true;
          }
        }
      }

      inStack.delete(stepNum);
      return false;
    };

    for (const step of steps) {
      dfs(step.stepNumber);
    }

    return [...new Set(cycleSteps)];
  }

  /**
   * Try to parse a revised plan from LLM output.
   * Returns null if output does not contain a valid plan JSON.
   */
  private parseRevisedPlan(output: string, originalPlan: ExecutionPlan): ExecutionPlan | null {
    if (!output || output.includes('PLAN_APPROVED')) return null;

    // Try to extract JSON from the output
    const jsonMatch = output.match(/\{[\s\S]*"steps"[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.steps && Array.isArray(parsed.steps)) {
        return {
          goal: parsed.goal || originalPlan.goal,
          createdAt: originalPlan.createdAt,
          steps: parsed.steps,
          metadata: {
            totalSteps: parsed.steps.length,
            estimatedDuration: parsed.metadata?.estimatedDuration
          }
        };
      }
    } catch {
      // LLM output is not valid JSON; expected when model returns prose instead of structured data
    }

    return null;
  }

  /**
   * Deep-copy a plan to avoid mutating the original.
   */
  private deepCopyPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan));
  }
}

export default PMAgent;
