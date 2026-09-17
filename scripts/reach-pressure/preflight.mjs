#!/usr/bin/env node
/**
 * The reach-pressure experiment end to end over the synthetic cohort: cohort, freeze, protocol,
 * trajectories, held-back scores, summary and report, through the same driver and the same
 * verifier the confirmatory run uses.
 *
 *   node scripts/reach-pressure/preflight.mjs <scratch-directory> [--scripted]
 *
 * With `--scripted` the agent is the scripted stand-in, which forces the reach path and needs no
 * model. Without it the agent is the real one, under the confirmatory protocol's own parameters.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const scratch = process.argv[2] === undefined ? null : resolve(process.argv[2]);
if (scratch === null) {
  console.error("usage: preflight.mjs <scratch-directory> [--scripted]");
  process.exit(2);
}
const scripted = process.argv.includes("--scripted");
const evidence = join(scratch, "evidence");
const corpus = join(scratch, "corpus");
const working = join(scratch, "work");
const driver = join(repositoryRoot, "scripts/reach-pressure-experiment.mjs");
const node = (args, options = {}) =>
  execFileSync(process.execPath, args, { cwd: repositoryRoot, encoding: "utf8", ...options });
const shared = [
  "--synthetic",
  "--evidence",
  evidence,
  "--corpus-root",
  corpus,
  "--working-root",
  working,
];

rmSync(scratch, { recursive: true, force: true });
mkdirSync(evidence, { recursive: true });
node([driver, "build"]);
node([
  join(repositoryRoot, "scripts/reach-pressure/synthetic-cohort.mjs"),
  corpus,
  join(evidence, "source.json"),
]);
const frozen = node([
  driver,
  "freeze",
  ...shared,
  "--source",
  join(evidence, "source.json"),
  "--cohort",
  "synthetic-preflight",
]);
const digestOf = (name) => new RegExp(`${name}\\s+(sha256:[0-9a-f]{64})`).exec(frozen)?.[1];

// The confirmatory protocol's own parameters, so the preflight exercises the budgets it will run
// under. Only the cohort and the three digests differ.
const confirmatory = /```json\n([\s\S]*?)\n```/.exec(
  readFileSync(
    join(repositoryRoot, "docs/evidence/2026-09-17/reach-pressure-experiment/protocol.md"),
    "utf8",
  ),
);
const parameters = {
  ...JSON.parse(confirmatory[1]),
  cohort: "synthetic-preflight",
  manifestDigest: digestOf("manifestDigest"),
  driverDigest: digestOf("driverDigest"),
  policyDigest: digestOf("policyDigest"),
};
writeFileSync(
  join(evidence, "protocol.md"),
  `# Synthetic preflight\n\n\`\`\`json\n${JSON.stringify(parameters, null, 2)}\n\`\`\`\n`,
);

const inherit = { stdio: "inherit", encoding: undefined };
node(
  [
    driver,
    "run",
    ...shared,
    ...(scripted ? ["--agent-command", "scripts/reach-pressure/scripted-agent.mjs"] : []),
  ],
  inherit,
);
node([driver, "score", ...shared], inherit);
node([driver, "analyze", ...shared], inherit);
