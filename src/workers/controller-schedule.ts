export type TaskState =
  | "pending"
  | "running"
  | "candidate"
  | "accepted"
  | "blocked"
  | "failed"
  | "cancelled";
export interface ScheduledTask {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly files: readonly string[];
}

/** Dependencies decide readiness; active overlapping files reserve their writer until integration. */
export function readyTasks(
  tasks: readonly ScheduledTask[],
  states: ReadonlyMap<string, TaskState>,
): readonly string[] {
  const occupied = new Set(
    tasks
      .filter((task) => ["running", "candidate"].includes(states.get(task.id) ?? "pending"))
      .flatMap((task) => task.files),
  );
  const ready: string[] = [];
  for (const task of [...tasks].sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      states.get(task.id) !== "pending" ||
      !task.dependsOn.every((dependency) => states.get(dependency) === "accepted") ||
      task.files.some((path) => occupied.has(path))
    )
      continue;
    ready.push(task.id);
    for (const path of task.files) occupied.add(path);
  }
  return ready;
}
