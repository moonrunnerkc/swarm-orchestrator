#!/usr/bin/env node
/**
 * Comparison A's third arm: swarm-verify over the identical patch with the adjudication arm's
 * held-back check as its oracle (`ci --oracle`), so the requirement-level decision is measured
 * by the verifier rather than only by the check run apart. Runs only over rows whose truth is
 * adjudicated, writes the check into the clone under the reviewer's path for the run and
 * removes it after, and records the verdict fields the frozen rule reads.
 *
 *   node scripts/ai-pr-study/comparison-a2.mjs <rows directory> <verifier version>
 *        [--only <index,index>] [--limit <n>]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const positional = [];
const flags = new Map();
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg.startsWith("--")) {
    flags.set(arg.slice(2), args[index + 1]);
    index += 1;
  } else positional.push(arg);
}
const [rowsDirectory, version] = positional;
if (!rowsDirectory || !version) {
  console.error(
    "usage: comparison-a2.mjs <rows directory> <verifier version> [--only <indexes>] [--limit <n>]",
  );
  process.exit(2);
}
const rowsRoot = resolve(rowsDirectory);
const only = flags.has("only") ? new Set(String(flags.get("only")).split(",").map(Number)) : null;
const limit = Number(flags.get("limit") ?? "1000");
const workingRoot = join(homedir(), ".cache", "swarm-ai-pr-study");
const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 64_000_000, ...options });

let done = 0;
for (const name of readdirSync(rowsRoot)
  .filter((file) => /^\d+\.json$/.test(file))
  .sort()) {
  if (done >= limit) break;
  const rowPath = join(rowsRoot, name);
  const row = JSON.parse(readFileSync(rowPath, "utf8"));
  if (only !== null && !only.has(row.index)) continue;
  const truth = row.adjudication?.status;
  if (!["requirement-met", "requirement-violated"].includes(truth) || row.comparisonA2) continue;
  if (row.outcome !== "executed") continue;
  done += 1;
  const clone = join(workingRoot, `${row.repository.replace("/", "__")}-${row.number}`);
  const check = row.adjudication.check;
  const startedAt = Date.now();
  const finish = (result) => {
    row.comparisonA2 = {
      ...result,
      verifier: { package: "swarm-verify", version },
      wallMs: Date.now() - startedAt,
    };
    writeFileSync(rowPath, `${JSON.stringify(row, null, 2)}\n`);
    console.log(
      `${row.index} ${row.repository}#${row.number}: A2 ${result.outcome} ${result.verified === true ? "verified" : result.refusal ? "refused" : (result.task ?? "")}`,
    );
  };
  try {
    // The check travels inside the oracle command and is decoded into place when the oracle
    // runs, so the verifier judges exactly the pull request's patch, the one A0 and A1 judge.
    // Committing it on top of the head (the previous design) put the reviewer's file in front of
    // the repository's own lint and format checks, which then failed on the reviewer's style and
    // read as a regression. base64 keeps the file's bytes out of the shell's quoting.
    const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;
    const directory = check.path.includes("/")
      ? check.path.slice(0, check.path.lastIndexOf("/"))
      : ".";
    const oracle = `mkdir -p ${quote(directory)} && printf %s ${quote(Buffer.from(check.contents).toString("base64"))} | base64 -d > ${quote(check.path)} && ${check.command}`;
    const image = row.execution?.isolation?.replace(/^docker:/, "") ?? "node:24-bookworm";
    const bundle = join(workingRoot, "bundles-a2", version, String(row.index).padStart(2, "0"));
    mkdirSync(join(workingRoot, "bundles-a2", version), { recursive: true });
    const verified = run(
      "npx",
      [
        "--yes",
        `swarm-verify@${version}`,
        "ci",
        "--workspace",
        clone,
        "--branch",
        row.head,
        "--base",
        row.base,
        "--json",
        "--bundle",
        bundle,
        "--isolation",
        `docker:${image}`,
        "--require-isolation",
        "--install",
        "--oracle",
        oracle,
      ],
      {
        cwd: workingRoot,
        env: { PATH: process.env.PATH ?? "", HOME: homedir(), NO_COLOR: "1" },
        timeout: 3_600_000,
      },
    );
    let report = null;
    try {
      report = JSON.parse(verified.stdout.trim().split("\n").at(-1) ?? "");
    } catch {
      report = null;
    }
    if (report === null) {
      finish({
        outcome: "blocked",
        reason: `the verifier exited ${verified.status} without a report: ${(verified.stderr ?? "").trim().split("\n").at(-1) ?? ""}`,
      });
      continue;
    }
    finish({
      outcome: "executed",
      patchIncludesCheck: false,
      checkDelivery: "decoded into place by the oracle command at run time",
      oracleRuns: report.oracleRuns ?? null,
      verified: report.verified ?? null,
      refusal: report.refusal ?? null,
      task: report.task ?? null,
      regression: report.regression ?? null,
      oracleReach: report.oracleReach ?? null,
      oracleBond: report.oracleBond ?? null,
      exit: verified.status,
    });
  } catch (cause) {
    finish({ outcome: "blocked", reason: `harness error: ${cause.message.split("\n")[0]}` });
  }
}
console.log(`${done} row(s) run through A2; results in ${rowsRoot}`);
