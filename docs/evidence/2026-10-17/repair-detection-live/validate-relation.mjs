#!/usr/bin/env node
/**
 * A development test of the relation check on the exposed mime fixture, with no model: a relation
 * the developers wrote from the task's own sentence ("treat every line terminator like any other
 * character ...; a space or tab in the name already works"), built by the product's own planned
 * contract and run exactly as the goal verifier runs it, on prepared checkouts of the base, the
 * base with the retained faulty patch, and the upstream fix.
 *
 * Because developers chose the property and its seeds knowing the omission, a result here is
 * engineered test coverage of the mechanism, not discovery by a model, and one fixture is not
 * evidence the mechanism generalizes.
 *
 *   node validate-relation.mjs --out <file>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { commandLog } from "../../../../scripts/campaign/exec.mjs";
import {
  applyPatch,
  cloneAtBase,
  comparisonRoot,
  mirrorOf,
  prepare,
  resolveFull,
  taskEnvironment,
  workRoot,
} from "../../../../scripts/comparison/workspace.mjs";
import { tasks } from "../../../../scripts/pilot/tasks-2026-10-17.mjs";
import {
  plannedContract,
  plannedRelation,
  relationAgreedSomewhere,
  withPlannedCheck,
} from "../../../../src/workers/planned-check-program.ts";

const { values } = parseArgs({ options: { out: { type: "string" } } });
if (values.out === undefined) throw new Error("usage: validate-relation.mjs --out <file>");
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const declaration = withPlannedCheck(null, {
  id: "terminator-like-space",
  purpose: "change",
  requirementId: "terminators-ordinary",
  requirement: "a line terminator in a name behaves like a space",
  quote: "Make getType treat every line terminator like any other character",
  program: "import mime from './dist/src/index.js';\nexport default (name) => mime.getType(name);\n",
  // The task's own example name, a name with a directory and two extensions, and an extensionless
  // name the base already types alike whatever is inserted (the control).
  seeds: ["LINEFEED.png", "dir/photo.png.jpg", "README"],
  reference: " ",
  variants: ["\n", "\r", " ", " "],
  why: "the task says a line terminator is treated like any other character, as a space already is",
});
const contract = plannedContract(task.taskText, declaration, undefined);
const [check] = contract.checks;
const relation = plannedRelation(check);

const log = commandLog(join(comparisonRoot, "blobs"));
const { base, upstream } = await resolveFull(log, task);
const faulty = readFileSync(
  new URL(
    "../../2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
    import.meta.url,
  ),
  "utf8",
);
const upstreamPatch = spawnSync("git", ["diff", base, upstream, "--", "src"], {
  cwd: mirrorOf(task.repository),
  encoding: "utf8",
}).stdout;

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "relation-"));
const results = [];
for (const [name, patch, expected] of [
  ["base", "", "fails, controlled"],
  ["retained faulty patch", faulty, "fails"],
  ["upstream fix", upstreamPatch, "holds"],
]) {
  const directory = join(scratch, name.replace(/\W+/g, "-"));
  await cloneAtBase(log, task, base, directory);
  if (!(await applyPatch(log, directory, patch))) throw new Error(`${name} does not apply`);
  const prepared = await prepare(log, task, directory);
  if (!prepared.ok) throw new Error(`${name} does not prepare: ${prepared.detail}`);
  const built = spawnSync("npm", ["run", "build"], {
    cwd: directory,
    env: taskEnvironment(task),
    encoding: "utf8",
  });
  if (built.status !== 0) throw new Error(`${name} does not build`);
  const [program, ...args] = check.behavior.argv;
  const started = Date.now();
  const ran = spawnSync(program, args, {
    cwd: directory,
    input: check.behavior.stdin,
    encoding: "utf8",
    timeout: check.behavior.timeoutMs,
  });
  const holds = ran.status === 0 && ran.stdout === check.behavior.stdout[0].value;
  const observed = holds
    ? "holds"
    : relationAgreedSomewhere(relation, ran.stdout)
      ? "fails, controlled"
      : "fails";
  results.push({
    checkout: name,
    expected,
    // The faulty patch is controlled as well; what matters for it is that it fails.
    met: expected === "fails" ? !holds : observed === expected,
    observed,
    exitCode: ran.status,
    durationMs: Date.now() - started,
    lines: ran.stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line)),
  });
}
const record = {
  schema: "swarm-relation-development-test.v1",
  kind: "engineered test coverage: a developer-written relation on the exposed fixture, no model",
  task: task.id,
  base,
  upstream,
  relation,
  calls: check.command,
  results,
  met: results.every((one) => one.met),
};
writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify({ met: record.met, results: results.map(({ lines, ...rest }) => rest) }, null, 2));
process.exit(record.met ? 0 : 1);
