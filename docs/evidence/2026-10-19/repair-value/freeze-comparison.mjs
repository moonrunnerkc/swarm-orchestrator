#!/usr/bin/env node
/**
 * Freezes the paired comparison of [protocol.md](protocol.md) (amendment 1) as a manifest the
 * comparison runner launches unchanged. The runner's own `--freeze` writes the task set, the
 * resolved commits, the harness digest and the protocol digest; this narrows it to the one
 * registered task, in the runner's own launch order, and pins the model, the endpoint, Swarm's
 * frozen build and workflow flag, and the matched limits the amendment states. Nothing is
 * launched here.
 *
 *   node freeze-comparison.mjs --out <manifest.json>
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { launches } from "../../../../scripts/comparison/order.mjs";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: freeze-comparison.mjs --out <manifest.json>");
const repository = new URL("../../../../", import.meta.url).pathname;
const out = resolve(values.out);
const task = "marked-bugfix-www-case";
const build = "e2b0fe77cd075be439adace698b8bfe5b7201a00";
const swarmCli = join(homedir(), ".cache/swarm-comparison/tools/swarm-e2b0fe77c/dist/cli.js");

const frozen = spawnSync(
  process.execPath,
  [
    "scripts/comparison/run.mjs",
    "--freeze",
    "--out",
    out,
    "--protocol",
    "docs/evidence/2026-10-19/repair-value/protocol.md",
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
  purpose:
    "repair-value protocol, amendment 1: one fresh paired comparison on a task from a repository not used to develop this work",
  pins: {
    ...manifest.pins,
    model: "qwen3.6:35b-a3b",
    endpoint: "http://127.0.0.1:11434/v1",
    swarmCli,
    swarmRevision: build,
    swarmCliDigest: digest(readFileSync(swarmCli)),
    swarmFlags: ["--plan-checks"],
  },
  budgets: {
    ...manifest.budgets,
    wallMsPerInvocation: 14 * 60_000,
    wallGraceMs: 60_000,
    swarmVerificationReserveMs: 60_000,
    maxCorrections: 0,
  },
  tasks: manifest.tasks.filter((one) => one.id === task),
  launches: launches([task]),
};
if (pinned.tasks.length !== 1) throw new Error(`${task} is not in the comparison's task set`);
writeFileSync(out, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(JSON.stringify({ out, launches: pinned.launches, pins: pinned.pins, budgets: pinned.budgets }, null, 2));
