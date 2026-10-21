#!/usr/bin/env node
/**
 * Freezes the manifest of [protocol.md](protocol.md) for the comparison runner, which launches it
 * unchanged: the runner's own `--freeze` writes the task set, the resolved commits, the harness
 * digest and this protocol's digest; this narrows it to the named tasks, in the runner's own
 * counterbalanced order (`scripts/comparison/order.mjs`), and pins the model, the endpoint, the
 * frozen Swarm build and the matched limits the protocol states. Nothing is launched here.
 *
 *   node freeze.mjs --out <manifest.json> --tasks <id,id,id> --build <commit> --purpose "<text>"
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launches } from "../../../../scripts/comparison/order.mjs";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    tasks: { type: "string" },
    build: { type: "string" },
    purpose: { type: "string" },
  },
});
for (const name of ["out", "tasks", "build", "purpose"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const repository = new URL("../../../../", import.meta.url).pathname;
const out = resolve(values.out);
const build = values.build;
const swarmCli = join(homedir(), `.cache/swarm-comparison/tools/swarm-${build.slice(0, 9)}/dist/cli.js`);
const taskIds = values.tasks.split(",");

const frozen = spawnSync(
  process.execPath,
  [
    "scripts/comparison/run.mjs",
    "--freeze",
    "--out",
    out,
    "--protocol",
    "docs/evidence/2026-10-21/fresh-comparison/protocol.md",
    "--swarm-revision",
    build,
  ],
  { cwd: repository, encoding: "utf8" },
);
if (frozen.status !== 0) throw new Error(`the runner did not freeze: ${frozen.stderr}`);
const manifest = JSON.parse(readFileSync(out, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const tasks = manifest.tasks.filter((one) => taskIds.includes(one.id));
if (tasks.length !== taskIds.length)
  throw new Error(`${taskIds.join(", ")}: not every task is in the comparison's task set`);
const pinned = {
  ...manifest,
  purpose: values.purpose,
  pins: {
    ...manifest.pins,
    model: "qwen3.6:35b-a3b",
    endpoint: "http://127.0.0.1:11434/v1",
    swarmCli,
    swarmRevision: build,
    swarmCliDigest: digest(readFileSync(swarmCli)),
    swarmFlags: [],
  },
  budgets: {
    ...manifest.budgets,
    wallMsPerInvocation: 9 * 60_000 + 500,
    wallGraceMs: 59_500,
    swarmVerificationReserveMs: 0,
    maxCorrections: 0,
  },
  tasks,
  launches: launches(taskIds),
};
writeFileSync(out, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(
  JSON.stringify(
    { out, digest: digest(readFileSync(out)), launches: pinned.launches, pins: pinned.pins, budgets: pinned.budgets },
    null,
    2,
  ),
);
