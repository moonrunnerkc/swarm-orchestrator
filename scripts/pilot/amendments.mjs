/**
 * The dated amendment to the pilot's frozen task set. The frozen set in `tasks.mjs` and the
 * manifests that embed it are not changed: stage A was scored under them and its records stand.
 * What changes here applies to development records written after the amendment and to
 * retrospective rechecks, each reported under its own file.
 *
 * Amendment of 2026-10-15, the upgrade task: the task text requires c8 to be declared exactly
 * "12.0.0" in package.json and in the lockfile's root entry, the test-node script and the
 * overrides block to stay as they were, and no other file to change. The frozen hidden oracle
 * checked only that the lockfile resolved and installed 12.0.0, and the frozen validation ran the
 * maintainer's own commit as the reference. That commit declares `^12.0.0`, so the reference the
 * validation passed does not satisfy the task's own wording; the two patches the pilot recorded
 * (identical bytes from both arms) do. The amended oracle enforces the declaration, the unchanged
 * fields and the closed file set, and the task-compliant reference is the maintainer's change
 * with its two range declarations rewritten to the exact version, labelled as such.
 *
 * The development stages reuse the frozen tasks under new ids so no cell can be mistaken for a
 * pilot cell: `dev` is the upgrade and the feature (both arms) and the bug fix (Swarm only is
 * launched from it); `dev2` is a second, independent bug-fix cell, launched only under the
 * condition the protocol states.
 */
import { tasks, wrongPatches } from "./tasks.mjs";

export const amendmentDate = "2026-10-15";

const upgradeId = "chai-upgrade-c8-v12";

function amend(task) {
  if (task.id !== upgradeId) return task;
  return {
    ...task,
    hidden: {
      ...task.hidden,
      upgrade: (task.hidden.upgrade ?? []).map((one) => ({ ...one, declared: one.version })),
      unchanged: ["scripts.test-node", "overrides"],
      allowedPaths: ["package.json", "package-lock.json"],
    },
  };
}

/** The frozen tasks with the amendment applied; ids unchanged, for rechecks of recorded patches. */
export const amendedTasks = tasks.map(amend);

/** The frozen wrong patches, which the amended oracle must still reject. */
export const amendedWrongPatches = wrongPatches;

/**
 * The maintainer's reference with its two `^12.0.0` declarations (package.json and the
 * lockfile's root entry) rewritten to the exact version the task requires. Nothing else in the
 * diff changes, so the resolved and installed version, the integrity hashes and the dependency
 * tree are the maintainer's own.
 */
export function taskCompliantReference(referencePatch) {
  const rewritten = referencePatch.replace(/^(\+\s+"c8": )"\^12\.0\.0",$/gm, '$1"12.0.0",');
  const count = (referencePatch.match(/^\+\s+"c8": "\^12\.0\.0",$/gm) ?? []).length;
  if (count !== 2)
    throw new Error(
      `the reference patch carries ${count} range declaration(s) of c8, not the 2 the amendment rewrites`,
    );
  return rewritten;
}

const byId = (id) => {
  const task = amendedTasks.find((one) => one.id === id);
  if (task === undefined) throw new Error(`no task ${id}`);
  return task;
};

/**
 * The development-validation stages, by name. Each stage freezes exactly the cells it launches,
 * so a published stage is complete when every frozen cell has a record: `dev` is the upgrade
 * and the feature under both arms; `dev-bugfix` and `dev-bugfix2` are one bug-fix cell each,
 * under Swarm only, the second launched only under the condition the development protocol
 * states.
 */
export const developmentStages = {
  dev: { ids: [upgradeId, "chai-feature-deep-contain-oneof"], suffix: "-dev", arms: null },
  "dev-bugfix": { ids: ["csstree-bugfix-raw-value-whitespace"], suffix: "-dev", arms: ["swarm"] },
  "dev-bugfix2": {
    ids: ["csstree-bugfix-raw-value-whitespace"],
    suffix: "-dev2",
    arms: ["swarm"],
  },
};

export function developmentTasks(stage) {
  const definition = developmentStages[stage];
  if (definition === undefined) throw new Error(`unknown development stage ${stage}`);
  return definition.ids.map((id) => ({ ...byId(id), id: `${id}${definition.suffix}` }));
}
