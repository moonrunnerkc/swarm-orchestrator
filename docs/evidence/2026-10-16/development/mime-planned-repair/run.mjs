#!/usr/bin/env node
/**
 * A scripted demonstration, not a discovery: the planned-check path on the real mime task, through
 * the ordinary command line, with no model. The planned checks are the audit's own counterexamples
 * (docs/evidence/2026-10-16/comparison/correctness-amendment/), supplied by the person running this
 * script; the first candidate is Swarm's retained stage A patch, which those cases refute; the
 * repair turn answers only if its brief carries the concrete mismatch. What it shows is that the
 * product admits such checks by their base control, blocks the wrong patch on them, hands the
 * failure to repair and accepts the corrected tree, not that anything found the cases on its own.
 *
 *   node docs/evidence/2026-10-16/development/mime-planned-repair/run.mjs --swarm-cli <dist/cli.js> --out <dir>
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { commandLog } from "../../../../../scripts/campaign/exec.mjs";
import { swarmContract } from "../../../../../scripts/comparison/arms.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  prepare,
  resolveFull,
  swarmConfigurationText,
  taskEnvironment,
  workRoot,
} from "../../../../../scripts/comparison/workspace.mjs";
import { stageTasks } from "../../../../../scripts/pilot/tasks-2026-10-16.mjs";

const { values } = parseArgs({ options: { "swarm-cli": { type: "string" }, out: { type: "string" } } });
if (values["swarm-cli"] === undefined || values.out === undefined)
  throw new Error("usage: run.mjs --swarm-cli <dist/cli.js> --out <dir>");
const swarmCli = resolve(values["swarm-cli"]);
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
);

const [task] = stageTasks("dev-mime");
const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "mime-planned-repair-"));
const workspace = join(scratch, "workspace");
const home = join(scratch, "home");
mkdirSync(home, { recursive: true, mode: 0o700 });
await cloneAtBase(log, task, resolved.base, workspace);
const base = await commitVisibleCheck(log, task, workspace);
const prepared = await prepare(log, task, workspace);
if (!prepared.ok) throw new Error(`preparation failed: ${prepared.detail}`);
writeFileSync(join(workspace, "swarm.toml"), swarmConfigurationText("http://127.0.0.1:1/v1", task, {
  lint: { command: "npm run --loglevel=error lint", severity: "advisory" },
}));
writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", { flag: "a" });
const contractPath = join(scratch, "contract.json");
writeFileSync(contractPath, `${JSON.stringify(swarmContract(task), null, 2)}\n`);

/** What src/Mime.ts reads after a patch, from a throwaway copy of the base. */
async function sourceAfter(patch) {
  const copy = join(scratch, `copy-${Math.random().toString(16).slice(2)}`);
  await cloneAtBase(log, task, resolved.base, copy);
  if (!(await applyPatch(log, copy, patch))) throw new Error("the patch did not apply");
  return readFileSync(join(copy, "src", "Mime.ts"), "utf8");
}
const retained = readFileSync(
  new URL("../../comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch", import.meta.url),
  "utf8",
);
const wrongSource = await sourceAfter(retained);
const correctSource = readFileSync(join(workspace, "src", "Mime.ts"), "utf8")
  .replace("path.replace(/^.*[/\\\\]/, '')", "path.replace(/^.*[/\\\\]/s, '')")
  .replace("last.replace(/^.*\\./, '')", "last.replace(/^.*\\./s, '')");
if (correctSource === readFileSync(join(workspace, "src", "Mime.ts"), "utf8"))
  throw new Error("the corrected source did not change; the base differs from what this script expects");

/** A planned check: an inline script printing getType over fixed inputs as one JSON line. */
function plannedCheck(id, atBase, inputs, expected) {
  const script = `import mime from './dist/src/index.js';\nconsole.log(JSON.stringify(${JSON.stringify(inputs)}.map((input) => mime.getType(input))));`;
  const argv = ["node", "--input-type=module", "-e", script];
  return {
    id,
    command: argv.join(" "),
    author: "model",
    exposure: "shared",
    atBase,
    artifacts: [],
    behavior: {
      kind: "cli",
      cwd: ".",
      timeoutMs: 20_000,
      maxOutputBytes: 4096,
      toolchain: "Node",
      network: "inherit",
      argv,
      exitCode: 0,
      stdout: [{ kind: "equals", value: `${JSON.stringify(expected)}\n` }],
      stderr: [],
    },
  };
}
// The audit's counterexamples, with the task's answer to each (supplied, not discovered).
const terminators = plannedCheck(
  "terminators-before-extension",
  "fails",
  ["photo.png\n.jpg", "dir/photo.png .jpg", "a\nb\nc.png", "\n.png", "LINE\r\nFEED.png"],
  ["image/jpeg", "image/jpeg", "image/png", "image/png", "image/png"],
);
const ordinary = plannedCheck(
  "ordinary-names",
  "passes",
  ["report.html", "/path/to/.config.json", "/path/to/file", "a.b.c.png", "SPACE .png", "TAB\t.png"],
  ["text/html", "application/json", null, "image/png", "image/png", "image/png"],
);

const repairs = (request) =>
  JSON.stringify(request).includes("should equal") && JSON.stringify(request).includes("terminators-before-extension")
    ? { toolCalls: [{ name: "write", input: { path: "src/Mime.ts", content: correctSource } }] }
    : { text: "The repair brief named no concrete failure." };
const endpoint = await startScriptedEndpoint({
  modelId: "stub",
  turns: [
    {
      toolCalls: [
        {
          name: "declare_planned_checks",
          input: {
            requirements: [
              { id: "terminators-before-extension", description: "a line terminator anywhere before the extension is an ordinary character", checks: ["terminators-before-extension"] },
              { id: "ordinary-names", description: "ordinary names, spaces and tabs keep working", checks: ["ordinary-names"] },
            ],
            checks: [terminators, ordinary],
          },
        },
      ],
    },
    { text: "Pinned." },
    { text: "Plan: fix getType.", toolCalls: [{ name: "declare_file_set", input: { files: ["src/Mime.ts"] } }] },
    // Swarm's own stage A patch, which the audit refutes.
    { toolCalls: [{ name: "write", input: { path: "src/Mime.ts", content: wrongSource } }] },
    { text: "Done." },
    repairs,
    { text: "Repaired." },
  ],
});
const argv = [
  "node", swarmCli, task.taskText.trim(),
  "--model", "local:stub", "--local-endpoint", endpoint.url,
  "--workspace", workspace, "--base", base,
  "--goal-contract", contractPath, "--plan-checks",
  "--install", "--lockfile", "package-lock.json",
  "--max-wall-minutes", "15", "--approve", "auto", "--no-tui", "--no-open-evidence", "--json",
];
const ran = await log.run(argv, {
  cwd: workspace,
  timeoutMs: 20 * 60_000,
  env: { PATH: taskEnvironment(task).PATH, HOME: home, NO_COLOR: "1" },
});
await endpoint.close();
const stdout = ran.stdout.toString();
const stderr = ran.stderr.toString();
writeFileSync(join(out, "stdout.txt.gz"), gzipSync(stdout));
writeFileSync(join(out, "stderr.txt.gz"), gzipSync(stderr));
const result = stdout.split("\n").filter((line) => line.startsWith('{"schema":"swarm.result.v1"')).map((line) => JSON.parse(line))[0];
const summary = {
  schema: "swarm-mime-planned-repair.v1",
  kind: "scripted demonstration from supplied counterexamples; not discovery and not a live launch",
  swarmCli,
  exitCode: ran.exitCode,
  acceptable: result?.verdict?.acceptable ?? null,
  requirements: result?.outcome?.requirements ?? null,
  repairAttempts: result?.outcome?.interventions?.repairAttempts ?? null,
  turnsPlayed: endpoint.played(),
  admission: stderr.split("\n").filter((line) => /admitted|dropped|planned checks/.test(line)),
  scratch,
};
writeFileSync(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
