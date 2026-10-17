#!/usr/bin/env node
/**
 * The evaluator's own reading of model-authored planned checks, outside the product: each planned
 * check of a sealed contract, run against prepared checkouts of the base, the task-compliant
 * controls and the retained faulty patch. It answers two questions the product's base control
 * cannot: does a check accept task-compliant implementations (so its expectation is not simply
 * wrong), and does it reject the retained faulty patch (so it covers the omission that patch
 * made)? The controls are known only to this evaluator; nothing here reaches a model.
 *
 * A check is run exactly as the product's goal verifier runs it: its argv from the repository
 * root, its stdin, and the captured stdout compared with its one expected text. Each checkout is
 * prepared as the scorer prepares it (the task's install, then its build).
 *
 *   node verify-checks.mjs --task mime|tar --generated <generated-checks.json> --out <file>
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
  options: { task: { type: "string" }, generated: { type: "string" }, out: { type: "string" } },
});
const evidence = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const controls = {
  mime: {
    id: "mime-bugfix-gettype-line-terminators",
    // Both tools' retained mime patches are refuted by the task's rule, so the upstream commit is
    // the one task-compliant control.
    compliant: {},
    faulty: { "swarm-stage-a": "2026-10-16/comparison/stage-a/patches/mime-bugfix-gettype-line-terminators.swarm.patch" },
  },
  tar: {
    id: "tar-bugfix-negative-size",
    // The three retained node-tar patches the expanded audit accepts.
    compliant: {
      "swarm-r1": "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r1.swarm.patch",
      "opencode-r1": "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r1.opencode.patch",
      "opencode-r2": "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r2.opencode.patch",
    },
    faulty: { "swarm-r2": "2026-10-16/fresh-comparison/stage-a/patches/tar-bugfix-negative-size-r2.swarm.patch" },
  },
};
const chosen = controls[values.task ?? ""];
if (chosen === undefined || values.generated === undefined || values.out === undefined)
  throw new Error("usage: verify-checks.mjs --task mime|tar --generated <file> --out <file>");
const task = tasks.find((one) => one.id === chosen.id);
const generated = JSON.parse(readFileSync(resolve(values.generated), "utf8"));
const contract = generated.sealed?.[0]?.contract;
if (contract === undefined) throw new Error("the generated record holds no sealed contract");
const planned = contract.checks.filter((check) => check.author === "model");

const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);
const reference = spawnSync("git", ["diff", "--binary", resolved.base, resolved.upstream], {
  cwd: mirrorOf(task.repository),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
}).stdout;
const variants = {
  base: { role: "base", patch: "" },
  upstream: { role: "compliant", patch: reference },
  ...Object.fromEntries(Object.entries(chosen.compliant).map(([name, path]) => [name, { role: "compliant", patch: evidence(path) }])),
  ...Object.fromEntries(Object.entries(chosen.faulty).map(([name, path]) => [name, { role: "faulty", patch: evidence(path) }])),
};

mkdirSync(workRoot, { recursive: true });
const scratch = mkdtempSync(join(workRoot, `verify-checks-${values.task}-`));
const rows = [];
for (const [name, variant] of Object.entries(variants)) {
  const checkout = join(scratch, name);
  await cloneAtBase(log, task, resolved.base, checkout);
  if (variant.patch !== "" && !(await applyPatch(log, checkout, variant.patch)))
    throw new Error(`${name}: the patch does not apply`);
  const prepared = await prepare(log, task, checkout);
  if (!prepared.ok) throw new Error(`${name}: preparation failed: ${prepared.detail}`);
  for (const argv of task.build) {
    const built = spawnSync(argv[0], argv.slice(1), { cwd: checkout, env: taskEnvironment(task), encoding: "utf8" });
    if (built.status !== 0) throw new Error(`${name}: ${argv.join(" ")} failed: ${built.stderr.slice(-800)}`);
  }
  for (const check of planned) {
    const behavior = check.behavior;
    const ran = spawnSync(behavior.argv[0], behavior.argv.slice(1), {
      cwd: join(checkout, behavior.cwd),
      input: behavior.stdin,
      env: taskEnvironment(task),
      encoding: "utf8",
      timeout: behavior.timeoutMs,
    });
    const expected = behavior.stdout[0]?.value ?? "";
    const want = expected.split("\n");
    const got = (ran.stdout ?? "").split("\n");
    rows.push({
      variant: name,
      role: variant.role,
      check: check.id,
      atBase: check.atBase,
      passed: ran.status === behavior.exitCode && ran.stdout === expected,
      exitCode: ran.status,
      wrongCases: want
        .map((line, index) => (line === got[index] ? null : { expected: line, observed: got[index] ?? null }))
        .filter((one) => one !== null && one.expected !== ""),
      stderr: (ran.stderr ?? "").slice(0, 600),
    });
  }
}
const byCheck = Object.fromEntries(
  planned.map((check) => {
    const mine = rows.filter((row) => row.check === check.id);
    return [
      check.id,
      {
        atBase: check.atBase,
        cases: (check.behavior.stdout[0]?.value ?? "").split("\n").filter(Boolean).length,
        acceptsEveryCompliant: mine.filter((row) => row.role === "compliant").every((row) => row.passed),
        rejectsFaulty: mine.filter((row) => row.role === "faulty").map((row) => ({ variant: row.variant, rejected: !row.passed })),
        base: mine.find((row) => row.role === "base")?.passed ? "passes" : "fails",
      },
    ];
  }),
);
const result = {
  schema: "swarm-planned-check-verification.v1",
  task: task.id,
  baseCommit: resolved.base,
  upstreamCommit: resolved.upstream,
  contractDigest: generated.sealed[0].digest,
  variants: Object.fromEntries(Object.entries(variants).map(([name, one]) => [name, one.role])),
  byCheck,
  rows,
  scratch,
};
writeFileSync(resolve(values.out), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(byCheck, null, 2));
