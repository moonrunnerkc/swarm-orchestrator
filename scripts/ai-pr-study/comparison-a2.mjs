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
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  const checkFile = join(clone, check.path);
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
    // The verifier clones the workspace into its own checkout, and a clone carries no
    // untracked file, so the check is committed on top of the head on a throwaway branch and
    // that commit is what the verifier is given: the pull request's patch plus the one file it
    // is judged by. The row records that the patch A2 saw includes the check.
    run("git", ["checkout", "--quiet", "--force", "--detach", row.head], { cwd: clone });
    mkdirSync(join(checkFile, ".."), { recursive: true });
    writeFileSync(checkFile, check.contents);
    run("git", ["add", "--force", "--", check.path], { cwd: clone });
    run(
      "git",
      [
        "-c",
        "user.name=study",
        "-c",
        "user.email=study@example.test",
        "commit",
        "-q",
        "--no-verify",
        "-m",
        "study: the held-back check, for the A2 oracle run",
      ],
      { cwd: clone },
    );
    const withCheck = run("git", ["rev-parse", "HEAD"], { cwd: clone }).stdout.trim();
    run("git", ["update-ref", "refs/heads/study-a2", withCheck], { cwd: clone });
    const image = row.execution?.isolation?.replace(/^docker:/, "") ?? "node:24-bookworm";
    const bundle = join(workingRoot, "bundles-a2", String(row.index).padStart(2, "0"));
    mkdirSync(join(workingRoot, "bundles-a2"), { recursive: true });
    const verified = run(
      "npx",
      [
        "--yes",
        `swarm-verify@${version}`,
        "ci",
        "--workspace",
        clone,
        "--branch",
        withCheck,
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
        check.command,
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
      patchIncludesCheck: true,
      commitWithCheck: withCheck,
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
  } finally {
    run("git", ["checkout", "--quiet", "--force", "--detach", row.head], { cwd: clone });
    rmSync(checkFile, { force: true });
  }
}
console.log(`${done} row(s) run through A2; results in ${rowsRoot}`);
