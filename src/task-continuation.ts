import { digestOfBytes } from "./evidence/canonical-json.ts";
import type { OwedFollowUp } from "./gates/auto-resolve.ts";

/**
 * The continuation a run owes its task when the loop that worked it stopped at its step limit
 * before it reported the task done.
 *
 * Launch 2 of the 2026-10-21 development trial spent its 40 steps reading, implementing and
 * running the checks, and reached the cap as it went to write the regression test the task
 * required. The repair loop that followed fixed one lint error and finished; nothing resumed the
 * task, and the run was reported as completed with the deliverable absent. A loop that ends at
 * its cap is not a loop that said it was done, and a repair finishing is the repair's completion,
 * not the task's.
 *
 * The continuation is an attempt like a repair's: given once the gates are green, from the same
 * attempt cap, inside the run's wall and token allowances, under the same ratchet and rollback,
 * with the same floor on what an attempt needs. It carries the task, the interrupted loop's
 * account and the change as it stands; the brief below is the part that says why. The step cap
 * itself is not raised: what the continuation adds is one more bounded loop, and only where the
 * first one was cut off. Nothing here names a project, a file or a kind of deliverable; the task's
 * own words are what the continuation is held to.
 */
export function taskContinuation(input: {
  readonly task: string;
  readonly steps: number;
  readonly maxSteps: number;
}): OwedFollowUp {
  return {
    identity: digestOfBytes(
      JSON.stringify({ rule: "task-continuation-v1", task: input.task, maxSteps: input.maxSteps }),
    ),
    brief: [
      `The loop that worked this task stopped at its step limit (${input.steps} of ${input.maxSteps} steps) before it reported the task done, so the task may be unfinished. This attempt continues it, once, from the workspace as it is now; the account above says what that loop read and edited, and the change above is what it left.`,
      "Compare what the task asks for, every deliverable it names, with the change as it stands, and finish what is missing. Do not redo what is done; do not start over.",
      "If the change already does everything the task asks for, say so in one line and make no edit.",
      "A change you make is judged by the gates as any repair is, and is kept only if nothing that passed now fails and no test is weakened.",
    ].join("\n"),
  };
}
