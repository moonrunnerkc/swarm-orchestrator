import type { SamplingSettings } from "../core/model-client.ts";
import { calibrationSampling, seedForRepeat } from "../select/calibration-run.ts";

export interface PlannedAttempt {
  readonly workerId: string;
  readonly taskId: string;
  readonly task: string;
  readonly attemptIndex: number;
  /** Null where the task is tried once, which is the run the single-attempt path had. */
  readonly sampling: SamplingSettings | null;
}

/** What a run has already planned, so a later layer numbers on from it rather than over it. */
export interface AlreadyPlanned {
  readonly tasks: number;
  readonly workers: number;
}

/**
 * Which workers a run starts, and what makes them differ.
 *
 * Trying a task several ways buys nothing unless the attempts can diverge: one model, one
 * prompt and a temperature of zero is the same answer written down N times. So an attempt
 * carries a seed of its own, derived from the task, the model and the attempt number rather
 * than drawn from the run's shared random source. Derived, because a report has to be able to
 * re-derive the seeds a run used after the process is gone; and not shared, because one
 * source handed to every worker correlates exactly the thing being paid for.
 *
 * Worker ids stay a flat sequence, so a run that tries each task once names its workers and
 * its branches exactly as it did before any of this, and passes no sampling at all. The task
 * and attempt an id belongs to travel as fields rather than encoded in the name.
 */
export function planAttempts(
  tasks: readonly string[],
  redundancy: number,
  modelSpec: string,
  alreadyPlanned: AlreadyPlanned = { tasks: 0, workers: 0 },
): readonly PlannedAttempt[] {
  const tries = Math.max(1, Math.trunc(redundancy));
  const planned: PlannedAttempt[] = [];

  for (const [taskIndex, task] of tasks.entries()) {
    const taskId = `task-${alreadyPlanned.tasks + taskIndex + 1}`;
    for (let attemptIndex = 0; attemptIndex < tries; attemptIndex += 1) {
      planned.push({
        workerId: `worker-${alreadyPlanned.workers + planned.length + 1}`,
        taskId,
        task,
        attemptIndex,
        sampling:
          tries === 1
            ? null
            : { ...calibrationSampling, seed: seedForRepeat(taskId, modelSpec, attemptIndex) },
      });
    }
  }

  return planned;
}
