#!/usr/bin/env node
/**
 * Shows, with no model, that the frozen Swarm build can start on the task's base: the product's
 * gate-plan preflight that the runner performs inside a launch (`swarm check` on a fresh
 * checkout, the effective tests gate read back), called directly as the runner calls it, so a
 * setup problem is found here and not by spending a task launch. OpenCode's start is shown by its
 * version. Nothing here reaches a model.
 *
 *   node preflight.mjs --manifest <manifest.json> --out <json>
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import { swarmGatePlanVerdict } from "../../../../scripts/comparison/checks.mjs";
import { comparisonRoot, prepareLaunchHome, workRoot } from "../../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({ options: { manifest: { type: "string" }, out: { type: "string" } } });
if (values.manifest === undefined || values.out === undefined)
  throw new Error("usage: preflight.mjs --manifest <manifest.json> --out <json>");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const task = manifest.tasks[0];
const log = commandLog(join(comparisonRoot, "blobs"));
const scratch = mkdtempSync(join(workRoot, "preflight-"));
// The runner hands the preflight the home's path and prepares the directory apart.
const home = join(scratch, "home");
prepareLaunchHome(home);
const started = Date.now();
const gatePlan = await swarmGatePlanVerdict(
  log,
  task,
  task.baseCommit,
  manifest.pins,
  home,
  manifest.swarmGates?.[task.id] ?? {},
);
const opencode = spawnSync("opencode", ["--version"], { encoding: "utf8" });
const result = {
  at: new Date().toISOString(),
  manifestDigest: null,
  task: task.id,
  swarm: { cli: manifest.pins.swarmCli, gatePlan, wallMs: Date.now() - started },
  opencode: { version: opencode.stdout.trim(), exitCode: opencode.status, expected: manifest.pins.opencode },
};
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ gatePlanOk: gatePlan.ok, effective: gatePlan.effective, status: gatePlan.status, opencode: result.opencode }, null, 2));
