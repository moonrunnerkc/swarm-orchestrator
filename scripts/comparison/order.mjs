/** The frozen launch order: tasks by a seeded hash, arms alternating so neither always runs first. */
import { createHash } from "node:crypto";

export const seed = "swarm-ordinary-comparison-2026-10-11";

export function frozenOrder(taskIds) {
  return [...taskIds].sort((a, b) => {
    const ha = createHash("sha256").update(`${seed}:${a}`).digest("hex");
    const hb = createHash("sha256").update(`${seed}:${b}`).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

/** Both arms of a task run back to back, the first arm alternating with the task's position. */
export function launches(taskIds) {
  const out = [];
  frozenOrder(taskIds).forEach((task, index) => {
    const first = index % 2 === 0 ? "swarm" : "opencode";
    const second = first === "swarm" ? "opencode" : "swarm";
    out.push({ task, arm: first, order: out.length });
    out.push({ task, arm: second, order: out.length });
  });
  return out;
}
