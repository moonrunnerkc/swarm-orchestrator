#!/usr/bin/env node
/**
 * Freezes one manifest of [protocol.md](protocol.md) (or, with --protocol, another registered protocol of this directory) for the comparison runner, which launches it
 * unchanged. The runner's own `--freeze` writes the task set, the resolved commits, the harness
 * digest and this protocol's digest; this narrows it to one task and the named arms, in the order
 * given, and pins the model, the endpoint, the frozen Swarm build and its workflow flags, and the
 * matched limits the protocol states. Nothing is launched here.
 *
 *   node freeze.mjs --out <manifest.json> --task <id> --build <commit> --arms swarm,opencode \
 *     --flags --plan-checks --first-order <n> --purpose "<text>"
 *
 * `--flags none` freezes Swarm with no workflow flag. `--first-order` numbers the launches so the
 * protocol's single order holds across two manifests.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    task: { type: "string" },
    build: { type: "string" },
    arms: { type: "string" },
    flags: { type: "string" },
    "first-order": { type: "string" },
    purpose: { type: "string" },
  },
});
for (const name of ["out", "task", "build", "arms", "flags", "first-order", "purpose"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const repository = new URL("../../../../", import.meta.url).pathname;
const out = resolve(values.out);
const build = values.build;
const swarmCli = join(homedir(), `.cache/swarm-comparison/tools/swarm-${build.slice(0, 9)}/dist/cli.js`);
const arms = values.arms.split(",");
const flags = values.flags === "none" ? [] : values.flags.split(",");

const frozen = spawnSync(
  process.execPath,
  [
    "scripts/comparison/run.mjs",
    "--freeze",
    "--out",
    out,
    "--protocol",
    "docs/evidence/2026-10-21/permissions-repair/protocol.md",
    "--swarm-revision",
    build,
  ],
  { cwd: repository, encoding: "utf8" },
);
if (frozen.status !== 0) throw new Error(`the runner did not freeze: ${frozen.stderr}`);
const manifest = JSON.parse(readFileSync(out, "utf8"));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
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
    swarmFlags: flags,
  },
  budgets: {
    ...manifest.budgets,
    // Nine minutes and half a second, so Swarm's whole minutes come to 9 however many
    // milliseconds pass between the deadline and the spawn; the kill falls at ten minutes.
    wallMsPerInvocation: 9 * 60_000 + 500,
    wallGraceMs: 59_500,
    // The product holds its final verification's reserve inside its own total now.
    swarmVerificationReserveMs: 0,
    maxCorrections: 0,
  },
  tasks: manifest.tasks.filter((one) => one.id === values.task),
  launches: arms.map((arm, index) => ({
    task: values.task,
    arm,
    order: Number(values["first-order"]) + index,
  })),
};
if (pinned.tasks.length !== 1) throw new Error(`${values.task} is not in the comparison's task set`);
writeFileSync(out, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(
  JSON.stringify(
    { out, digest: digest(readFileSync(out)), launches: pinned.launches, pins: pinned.pins, budgets: pinned.budgets },
    null,
    2,
  ),
);
