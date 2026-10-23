/**
 * Whether a delivered patch's own tests are sensitive to its change, with no model: the patch is
 * split into its test files and its other files, and each test command named on the command line
 * runs twice on fresh checkouts of the base, once with only the patch's test files applied and once
 * with the whole patch. A test counts as sensitive when it fails on the first tree and passes on
 * the second. Test names come from TAP output only; a command whose output carries no TAP lines is
 * reported by exit status alone.
 *
 *   node test-sensitivity.mjs --manifest <manifest.json> --task <id> --patch <file> --out <json> \
 *     --test-file test.js --test-file index.test-d.ts --command "npx ava test.js --tap" --command "npx tsd"
 */
import { existsSync, readFileSync, rmSync, writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../scripts/campaign/exec.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  prepare,
  taskEnvironment,
  workRoot,
} from "../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: {
    manifest: { type: "string" },
    task: { type: "string" },
    patch: { type: "string" },
    out: { type: "string" },
    "test-file": { type: "string", multiple: true },
    command: { type: "string", multiple: true },
  },
});
if (existsSync(values.out)) throw new Error(`${values.out} exists; results are never overwritten`);
const manifest = JSON.parse(readFileSync(values.manifest, "utf8"));
const task = manifest.tasks.find((one) => one.id === values.task);
const patch = readFileSync(values.patch, "utf8");
const testFiles = new Set(values["test-file"]);

// One section per file, split at each "diff --git a/<path> b/<path>" header.
const sections = patch.split(/^(?=diff --git )/m).filter((section) => section.startsWith("diff --git "));
const pathOf = (section) => /^diff --git a\/(\S+) b\/(\S+)/.exec(section)?.[2] ?? "";
const testsOnly = sections.filter((section) => testFiles.has(pathOf(section))).join("");
const touched = sections.map(pathOf);

const log = commandLog(join(values.out, "..", "sensitivity-blobs"));
const tapResults = (text) => {
  const results = new Map();
  for (const line of text.split("\n")) {
    const match = /^\s*(not ok|ok) \d+ - (.*?)(?:\s+#\s+(SKIP|TODO).*)?$/.exec(line);
    if (match !== null && match[3] === undefined) results.set(match[2].trim(), match[1] === "ok");
  }
  return results;
};

async function readTree(label, change) {
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `sensitivity-${label}-${task.id}-`));
  const checkout = join(scratch, "checkout");
  try {
    await cloneAtBase(log, task, task.baseCommit, checkout);
    await commitVisibleCheck(log, task, checkout);
    if (change.length > 0 && !(await applyPatch(log, checkout, change)))
      return { applied: false };
    const prepared = await prepare(log, task, checkout);
    if (!prepared.ok) return { applied: true, prepared: false, detail: prepared.detail };
    const commands = [];
    for (const command of values.command) {
      const ran = await log.run(["sh", "-c", command], { cwd: checkout, timeoutMs: 900_000, env: taskEnvironment(task) });
      const text = `${ran.stdout.toString()}\n${ran.stderr.toString()}`;
      commands.push({ command, exitCode: ran.exitCode, results: Object.fromEntries(tapResults(text)) });
    }
    return { applied: true, prepared: true, commands };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const baseWithTests = await readTree("tests-on-base", testsOnly);
const delivered = await readTree("delivered", patch);
const commands = values.command.map((command, index) => {
  const before = baseWithTests.commands?.[index];
  const after = delivered.commands?.[index];
  const sensitive = Object.entries(before?.results ?? {})
    .filter(([name, passed]) => !passed && after?.results?.[name] === true)
    .map(([name]) => name);
  return {
    command,
    exitOnBaseWithTests: before?.exitCode ?? null,
    exitOnDelivered: after?.exitCode ?? null,
    failingOnBaseWithTests: Object.entries(before?.results ?? {}).filter(([, passed]) => !passed).map(([name]) => name),
    failingOnDelivered: Object.entries(after?.results ?? {}).filter(([, passed]) => !passed).map(([name]) => name),
    sensitive,
  };
});
const result = {
  task: task.id,
  patchFiles: touched,
  testFilesInPatch: touched.filter((path) => testFiles.has(path)),
  baseWithTests: { applied: baseWithTests.applied, prepared: baseWithTests.prepared ?? null },
  delivered: { applied: delivered.applied, prepared: delivered.prepared ?? null },
  commands,
};
writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify(result));
