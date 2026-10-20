import type { UnresolvedOutcome } from "./cli-plan-checks.ts";
import { digestOfBytes } from "./evidence/canonical-json.ts";
import type { OwedFollowUp } from "./gates/auto-resolve.ts";
import { inputAsRead } from "./workers/planned-check-program.ts";

/**
 * The follow-up an ordinary run owes on requested outcomes no sealed check states, built from the
 * structured outcomes planning reconciled, never from what a worker said about them.
 *
 * A launch's worker was told an outcome was unresolved, ran the task's own example, saw it fail,
 * explained the failure away and finished; every gate was green, so nothing looked again. The
 * follow-up is that second look, once: the outcomes with the task's words and its own inputs, what
 * the planner expected and what the base gave, and the choice between changing the code and
 * leaving it, since the expectation is the planner's and can be the thing that is wrong. It is an
 * attempt like a repair's: the same cap, the same ratchet and rollback, the same floor on what an
 * attempt needs. It settles nothing: the outcomes stay unresolved in the report, because no sealed
 * check states them, whatever the attempt did or said.
 *
 * The identity is the set of outcome ids, so one follow-up covers every outcome however many there
 * are and however the planner worded them; null where there is nothing to follow up.
 */
export function outcomeFollowUp(unresolved: readonly UnresolvedOutcome[]): OwedFollowUp | null {
  if (unresolved.length === 0) return null;
  const ids = unresolved.map((one) => one.id).sort();
  return {
    identity: digestOfBytes(JSON.stringify(ids)),
    brief: [
      "Requested behaviour no sealed check exercises, as the planner read it from the task (recorded readings, not verdicts):",
      ...unresolved.map(
        (one) =>
          `- ${one.id}, ${one.role === "change" ? "a change" : "behaviour to keep"} under requirement ${one.requirement}${one.quote === null ? "" : `, the task's words: ${JSON.stringify(one.quote)}`}.` +
          (one.taskInputs.length === 0
            ? ""
            : ` The task's own input: ${one.taskInputs
                .map(
                  (asked) =>
                    `${inputAsRead(asked.input)} (the planner first expected ${asked.expected}${asked.base === null ? "" : `; the unchanged base gives ${asked.base}`})`,
                )
                .join(", ")}.`) +
          ` Why no check states it: ${one.reason}.`,
      ),
      "",
      "Do this once. For each item, run the project on the task's own input, or on the task's own example where it names no input (run_check with a program, or a shell command), and compare what it gives with what the task's words ask for: not with the planner's expectation and not with what the base gave, either of which can be wrong.",
      "Where the code does not give what the task's words ask, change it. Where it already does, or where the planner's reading is what is wrong, leave the code as it is and say which in one line.",
      "These items stay reported as unresolved either way, because no sealed check states them; a change you make is judged by the gates as any repair is, and is kept only if nothing that passed now fails.",
    ].join("\n"),
  };
}
