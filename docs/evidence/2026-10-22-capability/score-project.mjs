import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import { applyPatch, cloneAtBase, commitVisibleCheck, prepare, taskEnvironment, workRoot } from "../../../scripts/comparison/workspace.mjs";
const { values } = parseArgs({options: Object.fromEntries(["manifest", "task", "patch", "out"].map(name => [name, {type: "string"}]))});
for (const name of ["manifest", "task", "patch", "out"]) if (!values[name]) throw new Error(`--${name} is required`);
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; scores are never overwritten`);
mkdirSync(out, {recursive: true});
const manifest = JSON.parse(readFileSync(values.manifest));
const task = manifest.tasks.find(task => task.id === values.task);
if (!task) throw new Error("task not in manifest");
const patch = readFileSync(values.patch, "utf8"), log = commandLog(join(out, "blobs"));
mkdirSync(workRoot, {recursive: true});
const workspace = join(mkdtempSync(join(workRoot, "capability-score-")), "checkout");
await cloneAtBase(log, task, task.baseCommit, workspace);
await commitVisibleCheck(log, task, workspace);
if (!await applyPatch(log, workspace, patch)) throw new Error("patch does not apply");
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
const scripts = JSON.parse(readFileSync(join(workspace, "package.json"))).scripts ?? {};
const checks = [];
for (const [name, argv] of [["tests", task.projectTest], ["lint", scripts.lint ? ["npm", "run", "lint"] : null], ["build", scripts.build ? ["npm", "run", "build"] : null]]) {
  if (!argv) {checks.push({name, status: "not declared"}); continue;}
  const ran = await log.run(argv, {cwd: workspace, env: taskEnvironment(task), timeoutMs: 600000});
  checks.push({name, argv, exitCode: ran.exitCode, wallMs: ran.wallMs});
}
const suppressions = patch.split("\n").filter(line => /^\+(?!\+\+)/.test(line) && /eslint-disable|biome-ignore|@ts-ignore|coverage-ignore/.test(line));
writeFileSync(join(out, "record.json"), JSON.stringify({task: task.id, workspace, patch: resolve(values.patch), checks, addedSuppressionLines: suppressions, commands: log.commands}, null, 2));
console.log(JSON.stringify({task: task.id, checks, addedSuppressionLines: suppressions}));
