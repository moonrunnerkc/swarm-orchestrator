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

/**
 * Repetitions of a task set: each runs every task once per arm in the seeded order, a task's
 * first arm alternating with its position as above and flipping from one repetition to the next,
 * so across two repetitions each arm goes first on each task exactly once.
 */
export function repeatedLaunches(taskIds, suffixes) {
  const out = [];
  suffixes.forEach((suffix, repetition) => {
    frozenOrder(taskIds).forEach((task, index) => {
      const first = (index + repetition) % 2 === 0 ? "swarm" : "opencode";
      const second = first === "swarm" ? "opencode" : "swarm";
      out.push({ task: `${task}${suffix}`, arm: first, order: out.length });
      out.push({ task: `${task}${suffix}`, arm: second, order: out.length });
    });
  });
  return out;
}
