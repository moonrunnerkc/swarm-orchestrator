/**
 * The task set of the 2026-10-17 planned-check development assignment.
 *
 * Two exposed development cases, reused unchanged from earlier sets: the mime line-terminator bug
 * fix (2026-10-15) and the node-tar negative-size bug fix (2026-10-16). Their faulty outcomes, the
 * mime audit's counterexamples and the tar failure are known to the people developing Swarm, so
 * nothing recorded from them is fresh or comparative evidence. Both reuse the task text, base,
 * upstream commit and visible check exactly; the scoring adds an expanded audit of each task's
 * stated rules as an evaluator-only hidden check, written into the scoring checkout at scoring time
 * and never into a workspace a model reads
 * (docs/evidence/2026-10-17/planned-check-live/audits/).
 *
 * Stages `plan-on` and `plan-off` are the ablation's two arms of one Swarm build: each task under
 * two repetition ids, Swarm only, with `--plan-checks` frozen in the first manifest's pins and
 * nothing in the second. The launch order across the two is frozen in the ablation protocol.
 */
import { readFileSync } from "node:fs";
import { tasks as october15 } from "./tasks-2026-10-15.mjs";
import { tasks as october16, wrongPatches as october16WrongPatches } from "./tasks-2026-10-16.mjs";

const audit = (name) =>
  readFileSync(
    new URL(`../../docs/evidence/2026-10-17/planned-check-live/audits/${name}`, import.meta.url),
    "utf8",
  );

const find = (set, id) => {
  const task = set.find((one) => one.id === id);
  if (task === undefined) throw new Error(`no task ${id}`);
  return task;
};

const mime = find(october15, "mime-bugfix-gettype-line-terminators");
const tar = find(october16, "tar-bugfix-negative-size");

export const tasks = [
  {
    ...mime,
    hidden: {
      ...mime.hidden,
      files: [{ path: "acceptance/hidden/mime-audit.mjs", source: audit("mime-audit.mjs") }],
      extraArgv: [["node", "acceptance/hidden/mime-audit.mjs"]],
    },
  },
  {
    ...tar,
    hidden: {
      ...tar.hidden,
      files: [
        ...tar.hidden.files,
        { path: "acceptance/hidden/tar-audit.mjs", source: audit("tar-audit.mjs") },
      ],
      extraArgv: [...tar.hidden.extraArgv, ["node", "acceptance/hidden/tar-audit.mjs"]],
    },
  },
];

/** Each task twice per arm, under these suffixes. */
export const repetitions = ["-r1", "-r2"];

export const stagePurposes = {
  "plan-on":
    "ablation arm with --plan-checks on two exposed development tasks (mime, node-tar), Swarm only, two repetitions; not comparative evidence",
  "plan-off":
    "ablation arm without --plan-checks on the same two exposed development tasks and build, Swarm only, two repetitions; not comparative evidence",
};

export function stageTasks(stage) {
  if (stage in stagePurposes)
    return repetitions.flatMap((suffix) =>
      tasks.map((task) => ({ ...task, id: `${task.id}${suffix}` })),
    );
  throw new Error(`unknown stage ${stage}`);
}

/** The retained faulty outcomes the validator must see refused: Swarm's own earlier patches. */
const retained = (path) =>
  readFileSync(new URL(`../../docs/evidence/${path}`, import.meta.url), "utf8");
const faulty = {
  "mime-bugfix-gettype-line-terminators": retained(
    "2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
  ),
  "tar-bugfix-negative-size": retained(
    "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r2.swarm.patch",
  ),
};
export const wrongPatches = Object.fromEntries(
  repetitions.flatMap((suffix) =>
    tasks.map((task) => [`${task.id}${suffix}`, faulty[task.id] ?? october16WrongPatches[task.id]]),
  ),
);
