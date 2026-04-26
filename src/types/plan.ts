import type { PlanStep } from '../plan-generator';

/**
 * A step assigned to a worker agent: full file access, writes implementation code.
 * The worker receives the goal, curated file list, and (when available) a synthesized
 * failing acceptance test as its done criterion.
 */
export interface WorkerStep extends PlanStep {
  /** Discriminator for the worker role. */
  role: 'worker';
  /**
   * Files the worker is expected to touch.
   * Derived from the goal during planning; the actual diff may differ.
   */
  targetFiles?: string[];
  /**
   * Synthesized acceptance test produced by the reviewer before the worker runs.
   * Present when layer 1 intent verification is active. The worker is NOT shown
   * this value during execution (to prevent targeted cheating); it is used only
   * by the differential gate after the patch is produced.
   */
  acceptanceTest?: {
    testFilePath: string;
    testCommand: string;
  };
  /** Per-step timeout override in milliseconds. Falls back to adapter default. */
  timeout?: number;
}

/**
 * A step assigned to a reviewer agent: read-only access, critiques diffs.
 * The reviewer either (a) generates a synthesized failing test before a worker step,
 * or (b) reviews a worker's completed diff and produces advisory findings.
 */
export interface ReviewerStep extends PlanStep {
  /** Discriminator for the reviewer role. */
  role: 'reviewer';
  /**
   * The step number of the worker output this reviewer step targets.
   * For pre-worker test synthesis, this is the upcoming worker step number.
   * For post-worker review, this is the completed worker step number.
   */
  reviewScope: number;
  /**
   * Domain policy for the review pass.
   * 'general'      - standard code quality and correctness review
   * 'security'     - focus on OWASP-class vulnerabilities
   * 'accessibility' - WCAG / ARIA compliance in UI diffs
   */
  reviewPolicy: 'general' | 'security' | 'accessibility';
  /**
   * Where the reviewer writes its synthesized test artifact.
   * Populated after the reviewer completes; consumed by the differential gate.
   */
  outputFormat?: {
    testFilePath: string;
    testCommand: string;
  };
}

/**
 * Discriminated union covering both executable step roles.
 * Use this type when code needs to branch on worker vs reviewer behavior.
 */
export type RoleStep = WorkerStep | ReviewerStep;

/**
 * Type guard: returns true if the step is a WorkerStep.
 *
 * @param step - Any PlanStep, including untyped steps from legacy plans.
 * @returns True when step.role === 'worker'.
 */
export function isWorkerStep(step: PlanStep): step is WorkerStep {
  return (step as WorkerStep).role === 'worker';
}

/**
 * Type guard: returns true if the step is a ReviewerStep.
 *
 * @param step - Any PlanStep, including untyped steps from legacy plans.
 * @returns True when step.role === 'reviewer'.
 */
export function isReviewerStep(step: PlanStep): step is ReviewerStep {
  return (step as ReviewerStep).role === 'reviewer';
}

/**
 * Coerce a legacy PlanStep (no role field) to a WorkerStep.
 * Used during the migration period when existing serialized plans lack role fields.
 * Once all plan-generator code emits role fields, this function can be removed.
 *
 * @param step - A PlanStep missing the role discriminator.
 * @returns The same object cast as a WorkerStep with role set to 'worker'.
 */
export function coerceToWorkerStep(step: PlanStep): WorkerStep {
  return { ...step, role: 'worker' };
}
