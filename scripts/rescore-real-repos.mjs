#!/usr/bin/env node
// Re-scores the 2026-09-04 real-repository runs from the patches they recorded.
//
// Those eighteen runs were scored with the standalone `swarm gates`, which at the time failed
// the file-set gate on every changed repository: nothing had declared an intended file set,
// because there was no planner in a scoring run to declare one. Every run therefore read as not
// green, including the eleven whose change passed the hidden acceptance test. That is a false
// red per run, and it came from the harness rather than from the work.
//
// This re-scores the same patches with `swarm ci`, which applies each to a fresh checkout of the
// pinned base and runs the checks there. No model is called: the patches are already recorded,
// so this is arithmetic over evidence rather than a new campaign.
import { execFile } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { wilsonInterval } from "../dist/eval/statistics.js";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;
const evidenceRoot = join(repositoryRoot, "docs/evidence/2026-09-04/real-repos");

/**
 * The hidden acceptance test as the task oracle: written before any run, never shown to either
 * arm, and the only thing here that says whether the task was done rather than whether anything
 * broke. Each declares its own destination in its first line; the runner is the project's own.
 *
 * The command copies it in and runs that one file, which is what the 09-04 harness did.
 */
const oracles = {
  "ts-pattern": { into: "tests/object-empty.hidden.test.ts", runner: "npx jest --" },
  purify: { into: "src/List.partition.hidden.test.ts", runner: "npx vitest run" },
  darkreader: { into: "tests/unit/utils/array-chunk.hidden.tests.ts", runner: "npx jest --" },
};

function oracleCommand(name) {
  const oracle = oracles[name];
  const source = join(evidenceRoot, name, "hidden");
  const file = readdirSync(source)[0];
  return (
    `mkdir -p "$(dirname ${oracle.into})" && cp ${JSON.stringify(join(source, file))} ` +
    `${oracle.into} && ${oracle.runner} ${oracle.into}`
  );
}

const clones = {
  "ts-pattern": join(repositoryRoot, "campaign/work/gvergnaud__ts-pattern"),
  purify: join(repositoryRoot, "campaign/work/gigobyte__purify"),
  darkreader: join(repositoryRoot, "campaign/work/darkreader__darkreader"),
};

const runs = readFileSync(join(evidenceRoot, "runs.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

console.log(`re-scoring ${runs.length} recorded patches, no model calls\n`);

const rescored = [];
for (const record of runs) {
  const patchPath = join(evidenceRoot, record.name, record.arm, `run-${record.run}`, "diff.patch");
  const workspace = clones[record.name];

  let verified = false;
  let checks = [];
  let refusal = null;
  try {
    const { stdout } = await run(
      process.execPath,
      [
        join(repositoryRoot, "dist/cli.js"),
        "ci",
        "--patch",
        patchPath,
        "--workspace",
        workspace,
        "--base",
        record.commit,
        "--install",
        "--oracle",
        oracleCommand(record.name),
        "--json",
      ],
      { timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim().split("\n").at(-1));
    verified = parsed.verified === true;
    checks = parsed.checks ?? [];
    refusal = parsed.refusal ?? (parsed.unmeasured === true ? "nothing measured" : null);
  } catch (cause) {
    const output = `${cause.stdout ?? ""}`.trim().split("\n").at(-1) ?? "";
    try {
      const parsed = JSON.parse(output);
      verified = parsed.verified === true;
      checks = parsed.checks ?? [];
      refusal = parsed.refusal ?? (parsed.unmeasured === true ? "nothing measured" : null);
    } catch {
      refusal = (cause.stderr ?? cause.message ?? "").slice(0, 200);
    }
  }

  // The hidden acceptance test is the oracle: written before any run and never shown to either
  // arm. `verified` is what this tool concluded. The two together are the only thing that says
  // whether the tool was right.
  // The recorded hidden-test result from the 09-04 run, which is the ground truth this is
  // scored against. `verified` is now what this tool concludes with the same test wired in as
  // its oracle, so the two agreeing is the property under test.
  const oracle = record.hiddenTest?.passed === true;
  const corner = verified
    ? oracle
      ? "true-green"
      : "false-green"
    : oracle
      ? "false-red"
      : "true-red";

  rescored.push({
    name: record.name,
    arm: record.arm,
    run: record.run,
    wasGreen: record.score?.green === true,
    verified,
    oracle,
    corner,
    refusal,
    failedChecks: checks.filter((check) => check.status === "failed").map((check) => check.id),
  });

  console.log(
    `${record.name.padEnd(12)} ${record.arm.padEnd(9)} run ${record.run}  ` +
      `then=${record.score?.green ? "green" : "not-green"}  now=${verified ? "verified" : "refused "}  ` +
      `oracle=${oracle ? "passed" : "failed"}  -> ${corner}`,
  );
}

console.log("\n=== the four corners, on a corpus with hidden oracles ===");
for (const arm of ["swarm", "baseline"]) {
  const mine = rescored.filter((entry) => entry.arm === arm);
  const count = (name) => mine.filter((entry) => entry.corner === name).length;
  const falseGreenRate = wilsonInterval(count("false-green"), mine.length);
  console.log(
    `${arm.padEnd(9)} ${mine.length} runs: ${count("true-green")} true green, ` +
      `${count("false-green")} FALSE GREEN, ${count("false-red")} false red, ` +
      `${count("true-red")} true red`,
  );
  console.log(
    `${"".padEnd(9)} false-green rate ${(falseGreenRate.point * 100).toFixed(1)}% ` +
      `[${(falseGreenRate.lower * 100).toFixed(1)}, ${(falseGreenRate.upper * 100).toFixed(1)}]`,
  );
}

const before = rescored.filter((entry) => !entry.wasGreen && entry.oracle).length;
const after = rescored.filter((entry) => entry.corner === "false-red").length;
console.log(
  `\nfalse reds under the old standalone scoring: ${before}\n` +
    `false reds under swarm ci: ${after}`,
);

writeFileSync(
  join(evidenceRoot, "rescored.json"),
  `${JSON.stringify({ at: new Date().toISOString(), runs: rescored }, null, 2)}\n`,
);
console.log(`\nwritten: ${join(evidenceRoot, "rescored.json")}`);
