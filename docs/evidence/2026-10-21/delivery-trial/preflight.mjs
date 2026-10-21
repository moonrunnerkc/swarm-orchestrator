#!/usr/bin/env node
/**
 * Shows, with no model, that the frozen Swarm build can start on the task's base: the product's
 * gate-plan preflight the runner performs inside a launch (`swarm check` on a fresh checkout,
 * the effective tests gate read back), called directly as the runner calls it. Nothing here
 * reaches a model.
 *
 *   node preflight.mjs --manifest <manifest.json> --out <json>
 */
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
const log = commandLog(join(comparisonRoot, "blobs"));
const tasks = [];
for (const task of manifest.tasks) {
  const scratch = mkdtempSync(join(workRoot, "preflight-"));
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
  tasks.push({ task: task.id, gatePlan, wallMs: Date.now() - started });
  console.log(
    JSON.stringify({ task: task.id, gatePlanOk: gatePlan.ok, effective: gatePlan.effective, status: gatePlan.status, detail: gatePlan.ok ? undefined : gatePlan.detail }),
  );
}
const result = { at: new Date().toISOString(), swarmCli: manifest.pins.swarmCli, tasks };
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
