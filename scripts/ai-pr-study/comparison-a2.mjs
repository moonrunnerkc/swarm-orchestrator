#!/usr/bin/env node
/**
 * Comparison A's third arm: swarm-verify over the identical patch with the adjudication arm's
 * held-back checks as its oracle (`ci --oracle`), so the requirement-level decision is measured
 * by the verifier rather than only by the checks run apart. Runs only over rows whose truth is
 * scored as behavioural, after the arms that must not see the checks (suite, verifier) have
 * their standing results, and writes each run as an immutable attempt of the run's `a2` arm.
 *
 * This arm hands the checks to the verifier by design; it is the only place they leave the
 * adjudication arm, it never feeds anything back to a solver, and its checkout is its own.
 *
 *   node scripts/ai-pr-study/comparison-a2.mjs --run <runId> [--only <index,index>] [--limit <n>]
 *        [--working-root <dir>]
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { harnessIdentity, listAttempts, openRun, standingAttempt } from "./attempts.mjs";
import { resolveWriteTargetInside } from "./containment.mjs";
import { bundleEvidence } from "./plain-ci.mjs";
import {
  attemptDirectory,
  defaultWorkingRoot,
  freshCheckout,
  parseArguments,
  repositoryRoot,
  run,
  runArm,
  standingFetch,
} from "./study-run.mjs";

const { flags } = parseArguments(process.argv.slice(2));
if (!flags.has("run")) {
  console.error("usage: comparison-a2.mjs --run <runId> [--only <indexes>] [--limit <n>]");
  process.exit(2);
}
const workingRoot = flags.get("working-root") ?? defaultWorkingRoot;
const runRecord = {
  ...openRun(workingRoot, {
    resume: String(flags.get("run")),
    identity: { harnessCommit: harnessIdentity(repositoryRoot).commit },
  }),
  workingRoot,
};
const version = runRecord.verifierVersion;
const only = flags.has("only") ? new Set(String(flags.get("only")).split(",").map(Number)) : null;
const limit = Number(flags.get("limit") ?? "1000");
const frame = JSON.parse(readFileSync(runRecord.framePath, "utf8"));
const quote = (text) => `'${text.replaceAll("'", "'\\''")}'`;

/** The checks that decided the row's behavioural truth: accepted by both reviewers and executed validly. */
function scoredChecks(adjudication) {
  const ids = new Set();
  for (const requirement of adjudication.truth?.requirements ?? [])
    for (const check of requirement.checks ?? [])
      if (
        check.valid === "valid" &&
        check.decision !== "unjudged" &&
        check.truthClass === "behavioural-executed"
      )
        ids.add(check.id);
  return (adjudication.author?.requirements ?? [])
    .flatMap((requirement) => requirement.checks)
    .filter((check) => ids.has(check.id));
}

let done = 0;
for (const selected of frame.selected) {
  if (done >= limit) break;
  if (only !== null && !only.has(selected.index)) continue;
  const fetch = standingFetch(runRecord, selected.index);
  const adjudication = standingAttempt(
    listAttempts(runRecord.paths.rows, selected.index, "adjudication"),
  ).standing?.adjudication;
  if (fetch === null || fetch.failure || adjudication === undefined) continue;
  if (adjudication.truth?.class !== "behavioural-executed" || adjudication.truth.status === null)
    continue;
  const checks = scoredChecks(adjudication);
  if (checks.length === 0) continue;
  done += 1;
  const { pr } = fetch;
  await runArm(
    runRecord,
    selected.index,
    "a2",
    { diff: pr.diff.digest, checks: checks.map((check) => check.digest) },
    async (attempt) => {
      const startedAt = Date.now();
      const work = attemptDirectory(runRecord.paths.work, pr.index, "a2", attempt);
      const workspace = freshCheckout(pr.execution.objectClone, join(work, "workspace"), pr.head);
      // Each path is the check author's: held to what the head checkout would contain before the
      // oracle's shell writes it inside the verifier's own checkout. Nothing is written here.
      const files = new Map(checks.map((check) => [check.path, check.contents]));
      for (const path of files.keys()) resolveWriteTargetInside(workspace, path);
      // Decoded into place when the oracle runs, so the verifier judges exactly the pull
      // request's patch; base64 keeps the bytes out of the shell's quoting.
      const oracle = [...files]
        .map(([path, contents]) => {
          const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".";
          return `mkdir -p ${quote(directory)} && printf %s ${quote(Buffer.from(contents).toString("base64"))} | base64 -d > ${quote(path)}`;
        })
        .concat(checks.map((check) => `(${check.command})`))
        .join(" && ");
      const artifacts = attemptDirectory(runRecord.paths.artifacts, pr.index, "a2", attempt);
      const bundle = join(artifacts, "bundle");
      const verified = run(
        "npx",
        [
          "--yes",
          `swarm-verify@${version}`,
          "ci",
          "--workspace",
          workspace,
          "--branch",
          pr.head,
          "--base",
          pr.base,
          "--json",
          "--bundle",
          bundle,
          "--isolation",
          `docker:${runRecord.images[pr.execution.imageKind].reference}`,
          "--require-isolation",
          "--install",
          "--oracle",
          oracle,
        ],
        {
          cwd: workingRoot,
          env: { PATH: process.env.PATH ?? "", HOME: homedir(), NO_COLOR: "1" },
          timeout: runRecord.budgets.verifierTimeoutMs,
        },
      );
      let report = null;
      try {
        report = JSON.parse(verified.stdout.trim().split("\n").at(-1) ?? "");
      } catch {
        report = null;
      }
      const base = {
        verifier: { package: "swarm-verify", version },
        wallMs: Date.now() - startedAt,
      };
      if (report === null) {
        const reason = `the verifier exited ${verified.status} without a report: ${(verified.stderr ?? "").trim().split("\n").at(-1) ?? ""}`;
        return {
          comparisonA2: { ...base, outcome: "blocked", reason },
          failure: { kind: "product", reason },
        };
      }
      return {
        comparisonA2: {
          ...base,
          outcome: "executed",
          checks: checks.map((check) => ({ id: check.id, path: check.path, digest: check.digest })),
          patchIncludesCheck: false,
          checkDelivery: "decoded into place by the oracle command at run time",
          oracleRuns: report.oracleRuns ?? null,
          verified: report.verified ?? null,
          refusal: report.refusal ?? null,
          task: report.task ?? null,
          regression: report.regression ?? null,
          oracleReach: report.oracleReach ?? null,
          oracleBond: report.oracleBond ?? null,
          evidence: bundleEvidence(existsSync(bundle) ? bundle : null),
          exit: verified.status,
        },
        summary: `A2 ${report.verified === true ? "verified" : report.refusal ? "refused" : (report.task ?? "")}`,
      };
    },
  );
}
console.log(`${done} row(s) visited for A2 in run ${runRecord.runId}`);
