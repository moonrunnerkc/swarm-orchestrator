import { resolve } from "node:path";

/** Entry point for `npm run dev`. The agent loop replaces the body of this file. */
const scratchWorkspace = resolve(process.argv[2] ?? ".swarm-dev-workspace");

console.log("swarm v13: module boundaries only, no agent loop yet");
console.log(`scratch workspace: ${scratchWorkspace}`);
