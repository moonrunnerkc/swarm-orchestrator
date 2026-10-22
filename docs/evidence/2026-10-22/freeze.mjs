#!/usr/bin/env node
/**
 * Freezes one manifest of [protocol.md](protocol.md) for the comparison runner, which launches it
 * unchanged: the runner's own `--freeze` writes the task set, the resolved commits, the harness
 * digest and the protocol's digest; this narrows it to the two fresh tasks, pins the model, the
 * endpoint, the frozen Swarm build, the Swarm workflow flags of this cohort and the matched limits,
 * and lists the launches this manifest carries, numbered in the protocol's order. Nothing is
 * launched here.
 *
 *   node freeze.mjs --out <manifest.json> --build <commit> --cohort control|trace
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { out: { type: "string" }, build: { type: "string" }, cohort: { type: "string" } },
});
for (const name of ["out", "build", "cohort"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
if (!["control", "trace"].includes(values.cohort)) throw new Error("--cohort is control or trace");
const repository = new URL("../../../", import.meta.url).pathname;
const out = resolve(values.out);
const swarmCli = join(homedir(), `.cache/swarm-comparison/tools/swarm-${values.build}/dist/cli.js`);
const taskIds = ["acorn-bugfix-member-target-pattern-errors", "entities-bugfix-restore-get-code-point"];
const frozen = spawnSync(
  process.execPath,
  [
    "scripts/comparison/run.mjs",
    "--freeze",
    "--out",
    out,
    "--protocol",
    "docs/evidence/2026-10-22/protocol.md",
    "--swarm-revision",
    values.build,
  ],
  { cwd: repository, encoding: "utf8" },
);
if (frozen.status !== 0) throw new Error(`the runner did not freeze: ${frozen.stderr}`);
const manifest = JSON.parse(readFileSync(out, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const tasks = manifest.tasks.filter((one) => taskIds.includes(one.id));
if (tasks.length !== taskIds.length) throw new Error("a fresh task is not in the runner's task set");
const [acorn, entities] = taskIds;
const launches =
  values.cohort === "control"
    ? [
        { task: acorn, arm: "swarm", order: 2 },
        { task: acorn, arm: "opencode", order: 4 },
        { task: entities, arm: "opencode", order: 5 },
        { task: entities, arm: "swarm", order: 7 },
      ]
    : [
        { task: acorn, arm: "swarm", order: 3 },
        { task: entities, arm: "swarm", order: 6 },
      ];
const pinned = {
  ...manifest,
  purpose: `2026-10-22 repair-trace trial, ${values.cohort} cohort; protocol docs/evidence/2026-10-22/protocol.md`,
  pins: {
    ...manifest.pins,
    model: "qwen3.6:35b-a3b",
    endpoint: "http://127.0.0.1:11434/v1",
    swarmCli,
    swarmRevision: values.build,
    swarmCliDigest: digest(readFileSync(swarmCli)),
    swarmFlags: values.cohort === "trace" ? ["--repair-trace"] : [],
  },
  budgets: {
    ...manifest.budgets,
    wallMsPerInvocation: 9 * 60_000 + 500,
    wallGraceMs: 59_500,
    swarmVerificationReserveMs: 0,
    maxCorrections: 0,
  },
  tasks,
  launches,
};
writeFileSync(out, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(JSON.stringify({ out, digest: digest(readFileSync(out)), launches, pins: pinned.pins }, null, 2));
