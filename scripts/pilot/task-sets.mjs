/**
 * The frozen task sets the pilot helpers can be pointed at. The 2026-10-14 set stays the default
 * so every earlier command line means what it meant; a later set is named by its date with
 * `--set <date>`, and the manifest records which one it froze.
 */
export async function taskSet(name) {
  if (name === undefined || name === "2026-10-14") {
    const module = await import("./tasks.mjs");
    return {
      setName: "real-task pilot 2026-10-14",
      stageTasks: module.stageTasks,
      wrongPatches: module.wrongPatches,
    };
  }
  if (name === "2026-10-15") {
    const module = await import("./tasks-2026-10-15.mjs");
    return {
      setName: "comparison 2026-10-15",
      stageTasks: module.stageTasks,
      wrongPatches: module.wrongPatches,
    };
  }
  if (name === "2026-10-16") {
    const module = await import("./tasks-2026-10-16.mjs");
    return {
      setName: "follow-up 2026-10-16",
      stageTasks: module.stageTasks,
      wrongPatches: module.wrongPatches,
      // This set names its own stages and what each is for; the pilot's do not apply to it.
      stagePurposes: module.stagePurposes,
      // Stage A repeats each task under these suffixes, ordered so each arm leads each task once.
      repetitions: {
        A: { tasks: module.tasks.map((task) => task.id), suffixes: module.repetitions },
      },
    };
  }
  if (name === "2026-10-17") {
    const module = await import("./tasks-2026-10-17.mjs");
    return {
      setName: "planned-check development 2026-10-17",
      stageTasks: module.stageTasks,
      wrongPatches: module.wrongPatches,
      stagePurposes: module.stagePurposes,
      repetitions: Object.fromEntries(
        Object.keys(module.stagePurposes).map((stage) => [
          stage,
          { tasks: module.tasks.map((task) => task.id), suffixes: module.repetitions },
        ]),
      ),
    };
  }
  throw new Error(
    `unknown task set ${name}; known: 2026-10-14, 2026-10-15, 2026-10-16, 2026-10-17`,
  );
}
