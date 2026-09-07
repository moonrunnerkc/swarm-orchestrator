#!/usr/bin/env node
/**
 * Scores the eighteen recorded real-repository patches against a second oracle that the tool is
 * never given.
 *
 * A false-green rate needs two oracles. With one, the number is arithmetic: the same test is
 * handed to the tool as `--oracle`, so `verified` cannot be true unless it passes, and is then
 * used as the ground truth `verified` is compared against. That agreed on 18 of 18 and measured
 * reproducibility, which is why the 0.0% it produced was withdrawn.
 *
 * So each patch is verified twice. The first invocation carries the sealed oracle and produces
 * the tool's claim. The second carries the held-back oracle and is read only for its `task`
 * verdict, which the first invocation's verdict cannot depend on. The corner is the tool's claim
 * against the held-back verdict.
 *
 *   node scripts/second-oracle-pass.mjs [--only <repo,repo>]
 *
 * No model is called: the patches are recorded, so this is arithmetic over evidence.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  classifyAgainstHeldBackOracle,
  heldBackOracleLooksBroken,
} from "../dist/eval/campaign-run.js";
import { wilsonInterval } from "../dist/eval/statistics.js";
import { repositories } from "./real-repos.mjs";

const run = promisify(execFile);
const repositoryRoot = new URL("..", import.meta.url).pathname;
const evidenceRoot = join(repositoryRoot, "docs/evidence/2026-09-04/real-repos");

const only = (() => {
  const at = process.argv.indexOf("--only");
  return at === -1 ? null : new Set(process.argv[at + 1].split(","));
})();

const clones = {
  "ts-pattern": join(repositoryRoot, "campaign/work/gvergnaud__ts-pattern"),
  purify: join(repositoryRoot, "campaign/work/gigobyte__purify"),
  darkreader: join(repositoryRoot, "campaign/work/darkreader__darkreader"),
};

/**
 * Both oracles are invoked the same way, from the definitions `real-repos.mjs` holds, so the two
 * differ in which test they copy in and in nothing else. A held-back oracle run differently from
 * the sealed one would put the difference in the harness rather than in the test.
 */
function oracleCommand(spec, root) {
  const source = join(repositoryRoot, root, spec.file);
  return (
    `mkdir -p "$(dirname ${spec.destination})" && cp ${JSON.stringify(source)} ` +
    `${spec.destination} && ${spec.argv.join(" ")}`
  );
}

async function verify(patchPath, workspace, commit, oracle) {
  const argv = [
    join(repositoryRoot, "dist/cli.js"),
    "ci",
    "--patch",
    patchPath,
    "--workspace",
    workspace,
    "--base",
    commit,
    "--install",
    "--oracle",
    oracle,
    "--json",
  ];
  const read = (text) => JSON.parse(text.trim().split("\n").at(-1));
  try {
    const { stdout } = await run(process.execPath, argv, {
      timeout: 15 * 60_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    return read(stdout);
  } catch (cause) {
    try {
      return read(`${cause.stdout ?? ""}`);
    } catch {
      return { verified: false, task: "unjudged", regression: "unmeasured", failure: true };
    }
  }
}

const runs = readFileSync(join(evidenceRoot, "runs.jsonl"), "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((record) => only === null || only.has(record.name));

console.log(`second-oracle pass over ${runs.length} recorded patches, no model calls\n`);

const scored = [];
for (const record of runs) {
  const repository = repositories[record.name];
  const patchPath = join(evidenceRoot, record.name, record.arm, `run-${record.run}`, "diff.patch");
  const workspace = clones[record.name];

  const sealed = await verify(
    patchPath,
    workspace,
    record.commit,
    oracleCommand(repository.hidden, "docs/evidence/2026-09-04/real-repos"),
  );
  const heldBack = await verify(
    patchPath,
    workspace,
    record.commit,
    oracleCommand(repository.secondHidden, repository.secondHidden.root),
  );

  const verified = sealed.verified === true;
  const heldBackAccepted = heldBack.task === "accepted";
  const corner = classifyAgainstHeldBackOracle({
    verifiedWithFirstOracle: verified,
    heldBackAccepted,
  });

  scored.push({
    name: record.name,
    arm: record.arm,
    run: record.run,
    regression: sealed.regression,
    firstOracle: sealed.task,
    heldBackOracle: heldBack.task,
    verified,
    corner,
  });

  console.log(
    `${record.name.padEnd(11)} ${record.arm.padEnd(9)} run ${record.run}  ` +
      `regression=${String(sealed.regression).padEnd(10)} ` +
      `sealed=${String(sealed.task).padEnd(9)} held-back=${String(heldBack.task).padEnd(9)} ` +
      `-> ${corner}`,
  );
}

// Read before any rate is: a held-back oracle that refuses everything the sealed one accepted is
// a miswritten test far more often than six runs all cheating.
console.log("\n=== is the held-back oracle sound? ===");
let broken = false;
for (const name of new Set(scored.map((entry) => entry.name))) {
  const mine = scored.filter((entry) => entry.name === name);
  const accepted = mine.filter((entry) => entry.firstOracle === "accepted");
  const also = accepted.filter((entry) => entry.heldBackOracle === "accepted");
  const suspect = heldBackOracleLooksBroken({
    firstOracleAccepted: accepted.length,
    heldBackAlsoAccepted: also.length,
  });
  broken ||= suspect;
  console.log(
    `${name.padEnd(11)} sealed accepted ${accepted.length}, held-back also accepted ${also.length}` +
      (suspect
        ? "  <- SUSPECT: refuses everything the sealed oracle passed, read as an instrument defect"
        : accepted.length === 0
          ? "  (sealed accepted nothing here, so nothing to disagree with)"
          : ""),
  );
}

console.log("\n=== the four corners, against an oracle the tool was never given ===");
for (const arm of ["swarm", "baseline"]) {
  const mine = scored.filter((entry) => entry.arm === arm);
  if (mine.length === 0) continue;
  const count = (corner) => mine.filter((entry) => entry.corner === corner).length;
  const rate = wilsonInterval(count("false-green"), mine.length);
  console.log(
    `${arm.padEnd(9)} ${mine.length} runs: ${count("true-green")} true green, ` +
      `${count("false-green")} FALSE GREEN, ${count("false-red")} false red, ` +
      `${count("true-red")} true red`,
  );
  console.log(
    `${"".padEnd(9)} false-green rate ${(rate.point * 100).toFixed(1)}% ` +
      `[${(rate.lower * 100).toFixed(1)}, ${(rate.upper * 100).toFixed(1)}]`,
  );
}

if (broken) {
  console.log(
    "\nAt least one held-back oracle refused every patch its sealed oracle accepted. Treat the\n" +
      "rate above as unmeasured until that oracle is shown to pass a correct implementation.",
  );
}

const destination = join(repositoryRoot, "docs/evidence/2026-09-06/second-oracle/scored.json");
writeFileSync(
  destination,
  `${JSON.stringify({ at: new Date().toISOString(), heldBackOracleSuspect: broken, runs: scored }, null, 2)}\n`,
);
console.log(`\nwritten: ${destination}`);
