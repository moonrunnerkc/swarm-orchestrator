#!/usr/bin/env node
/**
 * Deterministic controller verification of a relation's limit, on the real mime project, through
 * one built product with a scripted planner and worker. No model is called.
 *
 * The planner declares the newline-to-space relation over the custom-extension fixture of the
 * expanded audit (`../../../2026-10-18/checking-semantics/expanded-audit.mjs`): `pn\ng` and `pn g`
 * both registered, where that equivalence is false for a correct implementation. Beside it, a
 * check whose case `file.pn\ng` -> `application/x-newline` is kept (the base gives it), and one
 * changed case the task states. The first change is 2026-10-18 launch 4's space normalization,
 * which passes the relation and breaks the kept case; the one repair is the correct change
 * (`[\s\S]*` in both expressions, blob 54e61a8), which restores the kept case and breaks the
 * relation. The two later repairs change nothing.
 *
 * The question is what the controller keeps, and whether anything reads as accepted. The
 * delivered patch is scored afterwards, apart.
 *
 *   node relation-limit.mjs --swarm-cli <dist/cli.js> --out <dir>
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../../scripts/campaign/exec.mjs";
import { swarmContract, swarmTokenCap } from "../../../../../scripts/comparison/arms.mjs";
import {
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  prepareLaunchHome,
  resolveFull,
  swarmConfigurationText,
  taskEnvironment,
  workRoot,
} from "../../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../../scripts/pilot/tasks-2026-10-17.mjs";
import { startScriptedEndpoint } from "../../../../../src/providers/scripted-endpoint.ts";

const { values } = parseArgs({ options: { "swarm-cli": { type: "string" }, out: { type: "string" } } });
if (values["swarm-cli"] === undefined || values.out === undefined)
  throw new Error("usage: relation-limit.mjs --swarm-cli <dist/cli.js> --out <dir>");
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
if (readdirSync(out).length > 0) throw new Error(`${out} is not empty; a record is never overwritten`);
const model = "qwen3.6:35b-a3b";
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "relation-limit-"));

const fileAfter = async (name, patch) => {
  const directory = join(scratch, `content-${name}`);
  await cloneAtBase(log, task, resolved.base, directory);
  if (spawnSync("git", ["apply", "-"], { cwd: directory, input: patch, encoding: "utf8" }).status !== 0)
    throw new Error(`${name}: the patch does not apply`);
  return readFileSync(join(directory, "src/Mime.ts"), "utf8");
};
const evidence = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const normalization = await fileAfter(
  "space-normalization",
  evidence("2026-10-18/generated-check-control/launch-4/final.patch"),
);
const correct = await fileAfter(
  "correct",
  evidence("2026-10-18/checking-semantics/launch-o1/attempt-0.reconstructed.patch"),
);

const fixture =
  "import Mime from './dist/src/Mime.js';\nconst mime = new Mime({'image/png': ['png'], 'application/x-newline': ['pn\\ng'], 'application/x-space': ['pn g']});\nexport default (name) => mime.getType(name);\n";
const quote =
  "Make getType treat every line terminator like any other character when it strips the directory part and the extension's prefix; a space or tab in the name already works and must keep working.";
const requirement = "a line terminator in a name is treated like any other character";
const planner = [
  {
    toolCalls: [
      {
        name: "declare_planned_relation",
        input: {
          id: "terminator-like-space",
          purpose: "change",
          requirementId: "terminators",
          requirement,
          quote,
          program: fixture,
          seeds: ["file.png"],
          reference: " ",
          variants: ["\n"],
          why: "the planner reads 'like any other character' as a newline behaving as a space does",
        },
      },
      {
        name: "declare_planned_check",
        input: {
          id: "registered-names",
          purpose: "change",
          requirementId: "terminators",
          requirement,
          quote,
          program: fixture,
          cases: [
            { input: "LINE\nFEED.png", expected: "image/png", changed: true },
            { input: "file.pn\ng", expected: "application/x-newline", changed: false },
          ],
          why: "a terminator before the last dot is stripped; an extension registered with one keeps its type",
        },
      },
      {
        name: "declare_coverage_review",
        input: {
          id: "terminators-review",
          requirementId: "terminators",
          change: "a terminator before the last dot no longer stops the strip",
          keeps: "a registered extension keeps its type",
          wrongImplementation: "turn every terminator into a space first",
          distinguishedBy: ["terminator-like-space", "registered-names"],
          noRelation: "declared as the relation terminator-like-space",
          untested: "U+2028 and U+2029",
        },
      },
    ],
  },
  { text: "Pinned." },
];
const isPlanner = (body) => JSON.stringify(body?.messages?.[0] ?? "").includes("You write the acceptance checks");
const stageOf = (body) => {
  const match = /This is attempt (\d+) of (\d+)\./.exec(JSON.stringify(body?.messages?.[1] ?? ""));
  return match === null ? 0 : Number(match[1]);
};
const acted = new Set();
const transcript = [];
let planned = 0;
const respond = (body) => {
  if (isPlanner(body)) {
    planned += 1;
    transcript.push({ role: "planner", turn: planned });
    return planner[planned - 1] ?? { text: "Nothing more to pin." };
  }
  const stage = stageOf(body);
  const first = !acted.has(stage);
  acted.add(stage);
  transcript.push({ role: "worker", stage, first, ...(first ? { brief: body?.messages?.[1]?.content ?? null } : {}) });
  if (!first) return { text: "Done." };
  const write = (content) => ({ name: "write", input: { path: "src/Mime.ts", content } });
  if (stage === 0)
    return { toolCalls: [{ name: "declare_file_set", input: { files: ["src/Mime.ts"] } }, write(normalization)] };
  if (stage === 1) return { toolCalls: [write(correct)] };
  return { text: "I leave the code as it is." };
};
const endpoint = await startScriptedEndpoint({ modelId: model, turns: Array.from({ length: 200 }, () => respond) });

const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
prepareLaunchHome(home);
await cloneAtBase(log, task, resolved.base, workspace);
const base = await commitVisibleCheck(log, task, workspace);
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
writeFileSync(
  join(workspace, "swarm.toml"),
  swarmConfigurationText(endpoint.url, task, { lint: { command: "npm run --loglevel=error lint", severity: "advisory" } }),
);
writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", { flag: "a" });
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, `${JSON.stringify(swarmContract(task), null, 2)}\n`);
const argv = [
  process.execPath,
  resolve(values["swarm-cli"]), task.taskText.trim(),
  "--model", `local:${model}`, "--local-endpoint", endpoint.url,
  "--workspace", workspace, "--base", base,
  "--goal-contract", contractPath, "--plan-checks",
  "--install", "--lockfile", "package-lock.json",
  "--max-tokens", String(swarmTokenCap), "--max-wall-minutes", "14",
  "--approve", "auto", "--no-tui", "--no-open-evidence", "--json",
];
const child = spawn(argv[0], argv.slice(1), {
  cwd: workspace,
  env: { PATH: taskEnvironment(task).PATH, HOME: home, NO_COLOR: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => (stdout += chunk));
child.stderr.on("data", (chunk) => (stderr += chunk));
const exitCode = await new Promise((done) => child.on("close", (code) => done(code)));
await endpoint.close();
const delivered = spawnSync(
  "git",
  ["diff", base, "--", ".", ":!swarm.toml", ":!.swarm", ":!acceptance/visible"],
  { cwd: workspace, encoding: "utf8" },
).stdout;
writeFileSync(join(out, "stdout.txt"), stdout);
writeFileSync(join(out, "stderr.txt"), stderr);
writeFileSync(join(out, "transcript.json"), `${JSON.stringify(transcript, null, 2)}\n`);
writeFileSync(join(out, "delivered.patch"), delivered);
writeFileSync(
  join(out, "run.json"),
  `${JSON.stringify(
    {
      schema: "swarm-relation-limit-run.v1",
      kind: "deterministic controller verification: scripted planner and worker; no model",
      swarmCli: resolve(values["swarm-cli"]),
      task: task.id,
      baseCommit: resolved.base,
      workspaceBase: base,
      exitCode,
      plannerTurnsServed: planned,
      scratch,
      home,
    },
    null,
    2,
  )}\n`,
);
console.log(`exit ${exitCode}; records in ${out}`);
