// Prints the allowed-change policy verdict for one patch against a task-shaped stub.
import { readFileSync } from "node:fs";
const { changePolicyVerdict, describePolicy } = await import("/Users/brad/projects/swarm-progress-2026-10-23/scripts/comparison/change-policy.mjs");
const patch = readFileSync(process.argv[2], "utf8");
const task = { visible: { path: "acceptance/visible/check.mjs" }, immutable: [] };
const verdict = await changePolicyVerdict(patch, task, { readBase: async () => null, readAfter: async () => null });
console.log(describePolicy(verdict));
