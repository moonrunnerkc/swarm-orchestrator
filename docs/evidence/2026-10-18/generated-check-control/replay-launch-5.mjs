#!/usr/bin/env node
/**
 * Replays launch 5's sealed planned checks on the real mime project, through the product's own
 * runner, to test one explanation of why they rejected every implementation. Each planned check
 * of cases is run twice on each prepared checkout: as sealed, and with one change to its program,
 * `case_.input` written as `case_`, so the program passes the value it is called with instead of
 * reading a field of it. The inputs, the expected lines, the argv and the runner are the sealed
 * ones byte for byte. The relation check is run as sealed only: its program already takes the
 * input itself.
 *
 * Checkouts are prepared as the evaluator prepares them (`../../2026-10-17/planned-check-live/
 * verify-checks.mjs`): the base, the upstream fix and the retained faulty patch, each installed
 * and built. Nothing here reaches a model.
 *
 *   node replay-launch-5.mjs --generated <launch-5/generated-checks.json> --out <file>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

const { values } = parseArgs({
  options: { generated: { type: "string" }, out: { type: "string" } },
});
if (values.generated === undefined || values.out === undefined)
  throw new Error("usage: replay-launch-5.mjs --generated <file> --out <file>");
const evidence = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const task = tasks.find((one) => one.id === "mime-bugfix-gettype-line-terminators");
const generated = JSON.parse(readFileSync(resolve(values.generated), "utf8"));
const contract = generated.sealed?.[0]?.contract;
if (contract === undefined) throw new Error("the generated record holds no sealed contract");
const planned = contract.checks.filter((check) => check.author === "model");

/** The one edit under test: the program passes the value it is given, not a field of it. */
const wholeValue = (program) => program.replaceAll("case_.input", "case_");

const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
const upstream = spawnSync("git", ["diff", "--binary", resolved.base, resolved.upstream], {
  cwd: mirrorOf(task.repository),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).stdout;
const variants = {
  base: "",
  upstream,
  "swarm-stage-a": evidence(
    "2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch",
  ),
};

const runCheck = (checkout, behavior, stdin) => {
  const ran = spawnSync(behavior.argv[0], behavior.argv.slice(1), {
    cwd: join(checkout, behavior.cwd),
    input: stdin,
    env: taskEnvironment(task),
    encoding: "utf8",
    timeout: behavior.timeoutMs,
  });
  const expected = behavior.stdout[0]?.value ?? "";
  const want = expected.split("\n").filter((line) => line.length > 0);
  const got = (ran.stdout ?? "").split("\n");
  const wrong = want
    .map((line, index) => (line === got[index] ? null : { expected: line, observed: got[index] ?? null }))
    .filter((one) => one !== null);
  return {
    exitCode: ran.status,
    passed: ran.status === behavior.exitCode && ran.stdout === expected,
    casesPassed: want.length - wrong.length,
    cases: want.length,
    wrong,
    stderr: (ran.stderr ?? "").slice(0, 600),
  };
};

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, "replay-launch-5-"));
const rows = [];
for (const [name, patch] of Object.entries(variants)) {
  const checkout = join(scratch, name);
  await cloneAtBase(log, task, resolved.base, checkout);
  if (patch !== "" && !(await applyPatch(log, checkout, patch)))
    throw new Error(`${name}: the patch does not apply`);
  const prepared = await prepare(log, task, checkout);
  if (!prepared.ok) throw new Error(`${name}: preparation failed: ${prepared.detail}`);
  for (const argv of task.build) {
    const built = spawnSync(argv[0], argv.slice(1), { cwd: checkout, env: taskEnvironment(task), encoding: "utf8" });
    if (built.status !== 0) throw new Error(`${name}: ${argv.join(" ")} failed: ${built.stderr.slice(-800)}`);
  }
  for (const check of planned) {
    const behavior = check.behavior;
    const carried = JSON.parse(behavior.stdin);
    const sealed = runCheck(checkout, behavior, behavior.stdin);
    const row = { variant: name, check: check.id, program: carried.program, sealed };
    if (carried.relation === undefined && carried.program.includes("case_.input")) {
      const edited = { ...carried, program: wholeValue(carried.program) };
      row.editedProgram = edited.program;
      row.edited = runCheck(checkout, behavior, JSON.stringify(edited));
    }
    rows.push(row);
  }
}

const summary = rows.map((row) => ({
  variant: row.variant,
  check: row.check,
  sealed: `${row.sealed.casesPassed}/${row.sealed.cases}`,
  ...(row.edited === undefined ? {} : { wholeValue: `${row.edited.casesPassed}/${row.edited.cases}` }),
}));
writeFileSync(
  resolve(values.out),
  `${JSON.stringify(
    {
      schema: "swarm-launch-5-replay.v1",
      task: task.id,
      baseCommit: resolved.base,
      upstreamCommit: resolved.upstream,
      contractDigest: generated.sealed[0].digest,
      edit: "program text: every `case_.input` written as `case_`; inputs, expected lines, argv and runner as sealed",
      node: process.version,
      summary,
      rows,
      scratch,
    },
    null,
    2,
  )}\n`,
);
console.table(summary);
