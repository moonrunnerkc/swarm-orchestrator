/**
 * The task set of the 2026-10-16 follow-up assignment.
 *
 * Development stages reuse two tasks of the 2026-10-15 set unchanged under new ids, so no cell
 * here can be read as a cell of that comparison: `dev` is the mime bug fix and the pako refactor,
 * `dev-mime` the mime bug fix alone. Both are exposed development cases (their outcomes and the
 * mime audit's counterexamples are known), so nothing recorded from them is comparative evidence.
 */
import { tasks as earlier, wrongPatches as earlierWrongPatches } from "./tasks-2026-10-15.mjs";

const reuse = (id, suffix) => {
  const task = earlier.find((one) => one.id === id);
  if (task === undefined) throw new Error(`no task ${id} in the 2026-10-15 set`);
  return { ...task, id: `${id}${suffix}` };
};

export const developmentTasks = {
  dev: [
    reuse("mime-bugfix-gettype-line-terminators", "-dev"),
    reuse("pako-refactor-options-default-param", "-dev"),
  ],
  "dev-mime": [reuse("mime-bugfix-gettype-line-terminators", "-dev-plan")],
};

export const stagePurposes = {
  dev: "development measurement on two exposed tasks: the mime bug fix and the pako refactor, Swarm only, under one named product configuration per manifest; not comparative evidence",
  "dev-mime":
    "development demonstration on the exposed mime bug fix under --plan-checks, Swarm only; the planner sees the task text and the repository, never the audit's counterexamples; not comparative evidence",
};

export function stageTasks(stage) {
  const development = developmentTasks[stage];
  if (development !== undefined) return development;
  throw new Error(`unknown stage ${stage}`);
}

export const wrongPatches = Object.fromEntries(
  Object.values(developmentTasks)
    .flat()
    .map((task) => [task.id, earlierWrongPatches[task.id.replace(/-dev(?:-plan)?$/, "")]]),
);
