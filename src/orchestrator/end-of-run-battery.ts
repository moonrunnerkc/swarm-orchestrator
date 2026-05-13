import { execFileSync } from 'child_process';
import { ConfigLoader } from '../config-loader';
import type { ExecutionPlan } from '../plan-generator';
import type { GateResult } from '../quality-gates';
import {
  runBatteryVerification,
  type BatteryCommandRunner,
  type BatteryResult,
} from '../verification/battery-runner';
import type {
  DifferentialOverlayFile,
  MutationCommandRunner,
  PropertyCommandRunner,
} from '../verification';

export interface EndOfRunBatteryContext {
  baselineSnapshot?: { headCommit: string } | undefined;
  finalGateResults?: GateResult[] | undefined;
}

export interface ProductionStepRoleSummary {
  workerSteps: number[];
  reviewerSteps: number[];
  otherSteps: Array<{ stepNumber: number; agentName: string }>;
  hookPoint: string;
}

export interface EndOfRunBatteryOptions {
  differentialTestCommand?: string;
  regressionCommand?: string;
  changedFiles?: string[];
  diffText?: string;
  regressionCommandRunner?: BatteryCommandRunner;
  mutationCommandRunner?: MutationCommandRunner;
  propertyCommandRunner?: PropertyCommandRunner;
  /**
   * Files the differential-gate must overlay onto its detached base
   * and patch worktrees. The pre-worker-synthesized regression test
   * is the canonical case: it lives in the orchestrator's run scratch
   * directory rather than in either branch's history, and without the
   * overlay the test command exits non-zero because the file is
   * missing — not because the regression test caught the bug.
   */
  differentialOverlayFiles?: readonly DifferentialOverlayFile[];
}

export interface EndOfRunBatteryArgs {
  workingDir: string;
  plan: ExecutionPlan;
  context: EndOfRunBatteryContext;
  options?: EndOfRunBatteryOptions;
}

function gitHead(repoPath: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
    },
  }).trim();
}

/**
 * Summarize the production step-role model used by the battery hook.
 *
 * @param plan - Execution plan whose step agent names encode worker/reviewer roles.
 * @returns Worker, reviewer, and other step numbers plus the end-of-run hook description.
 */
export function summarizeProductionStepRoles(plan: ExecutionPlan): ProductionStepRoleSummary {
  const workerSteps: number[] = [];
  const reviewerSteps: number[] = [];
  const otherSteps: Array<{ stepNumber: number; agentName: string }> = [];

  for (const step of plan.steps) {
    const role = ConfigLoader.normalizeAgentName(step.agentName);
    if (role === 'worker') {
      workerSteps.push(step.stepNumber);
    } else if (role === 'reviewer') {
      reviewerSteps.push(step.stepNumber);
    } else {
      otherSteps.push({ stepNumber: step.stepNumber, agentName: step.agentName });
    }
  }

  return {
    workerSteps,
    reviewerSteps,
    otherSteps,
    hookPoint: 'after scheduler completion, failed-step retry, cleanup, and dependency install; before final quality gates',
  };
}

/**
 * Run the end-of-run falsification battery for the production orchestrator path.
 *
 * @param args - Working directory, execution plan, run context, and optional test controls.
 * @returns Aggregated battery result for the final patch state.
 */
export async function runEndOfRunBattery(args: EndOfRunBatteryArgs): Promise<BatteryResult> {
  const baseCommit = args.context.baselineSnapshot?.headCommit ?? '';
  const patchCommit = gitHead(args.workingDir);
  return runBatteryVerification({
    repoPath: args.workingDir,
    baseCommit,
    patchCommit,
    goalText: args.plan.goal,
    ...(args.context.finalGateResults !== undefined ? { advisoryGateResults: args.context.finalGateResults } : {}),
    ...(args.options?.differentialTestCommand !== undefined
      ? { differentialTestCommand: args.options.differentialTestCommand }
      : {}),
    ...(args.options?.regressionCommand !== undefined ? { regressionCommand: args.options.regressionCommand } : {}),
    ...(args.options?.changedFiles !== undefined ? { changedFiles: args.options.changedFiles } : {}),
    ...(args.options?.diffText !== undefined ? { diffText: args.options.diffText } : {}),
    ...(args.options?.regressionCommandRunner !== undefined
      ? { regressionCommandRunner: args.options.regressionCommandRunner }
      : {}),
    ...(args.options?.mutationCommandRunner !== undefined ? { mutationCommandRunner: args.options.mutationCommandRunner } : {}),
    ...(args.options?.propertyCommandRunner !== undefined ? { propertyCommandRunner: args.options.propertyCommandRunner } : {}),
    ...(args.options?.differentialOverlayFiles !== undefined
      ? { differentialOverlayFiles: args.options.differentialOverlayFiles }
      : {}),
  });
}
