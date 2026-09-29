#!/usr/bin/env node
/**
 * The execution arms of the AI-authored pull request study, per selected pull request in the
 * frame's order, each written as immutable attempts under one run (see attempts.mjs):
 *
 * - `fetch`: what GitHub reports about the pull request, both commits fetched by SHA into the
 *   versioned object clone, the changed files with the test changes named, and the diff kept
 *   outside the repository by digest.
 * - `suite`: the independent plain-CI arm. A fresh checkout of the head, and of the base, has its
 *   dependencies installed from its lockfile in a fresh container, and the project's own declared
 *   test command runs there with the network off. Recorded as `originalSuite` (collection,
 *   command, exit, status, duration, output tail) and `setup` (the install and the command
 *   environment). Nothing of the verifier's is read.
 * - `verifier`: the published verifier at one frozen version over a fresh checkout, in a
 *   container, installing from the lockfile. Its report, summary and bundle are kept outside the
 *   repository by digest, and the bundle's own `verify.mjs` (and `rederive.mjs`) decides
 *   `evidence.valid`, a dimension apart from the verdict.
 *
 * Task truth is a separate arm (adjudicate.mjs) and is never read here; no hidden check is ever
 * written into a checkout this file makes.
 *
 *   node scripts/ai-pr-study/run.mjs <frame.json> <verifier version>
 *        [--dev | --resume <runId>] [--only <index,index>] [--limit <n>]
 *        [--arms fetch,suite,verifier] [--image <node image>] [--python-image <image>]
 *        [--max-attempts <n>] [--verifier-timeout-ms <ms>] [--install-timeout-ms <ms>]
 *        [--test-timeout-ms <ms>] [--working-root <dir>]
 *
 * A new run prints its id; `--resume <runId>` continues it with the budgets its manifest fixed.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sha256 } from "./attempts.mjs";
import { writeFileInside } from "./containment.mjs";
import { bundleEvidence, plainSuite } from "./plain-ci.mjs";
import {
  attemptDirectory,
  defaultWorkingRoot,
  freshCheckout,
  objectClonePath,
  openStudyRun,
  parseArguments,
  run,
  runArm,
  standingFetch,
} from "./study-run.mjs";

const { positional, flags } = parseArguments(process.argv.slice(2), ["--dev"]);
const [framePath, version] = positional;
if (!framePath || !version) {
  console.error(
    "usage: run.mjs <frame.json> <verifier version> [--dev | --resume <runId>] [--only <indexes>] [--limit <n>] [--arms fetch,suite,verifier]",
  );
  process.exit(2);
}
const runRecord = openStudyRun({
  framePath,
  version,
  flags,
  workingRoot: flags.get("working-root") ?? defaultWorkingRoot,
});
console.log(`run ${runRecord.runId} (${runRecord.paths.run})`);
const budgets = runRecord.budgets;
const limit = Number(flags.get("limit") ?? "1000");
const only = flags.has("only") ? new Set(String(flags.get("only")).split(",").map(Number)) : null;
const armsWanted = new Set(String(flags.get("arms") ?? "fetch,suite,verifier").split(","));
const nodeImage = flags.get("image") ?? "node:24-bookworm";
const pythonImage = flags.get("python-image") ?? "ghcr.io/astral-sh/uv:python3.12-bookworm";

const gh = (ghArgs) => {
  const ran = run("gh", ghArgs, { maxBuffer: 64_000_000 });
  if (ran.status !== 0) {
    const error = new Error(
      `gh ${ghArgs[0]} ${ghArgs[1]} failed: ${(ran.stderr ?? "").trim().slice(-300)}`,
    );
    error.kind = "infrastructure";
    throw error;
  }
  return ran.stdout;
};

function digestOfTree(directory) {
  // A digest over every file's path and bytes, so the outside-tree bundle is bound to the row.
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        hash.update(`${path.slice(directory.length)}\0`);
        hash.update(readFileSync(path));
        hash.update("\0");
      }
    }
  };
  walk(directory);
  return `sha256:${hash.digest("hex")}`;
}

const testPath = (path) =>
  /(^|\/)(tests?|__tests__|spec|specs)\//.test(path) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
  /(^|\/)test_[^/]*\.py$/.test(path) ||
  /_test\.py$/.test(path) ||
  /(^|\/)conftest\.py$/.test(path);

const networkFailure =
  /Could not resolve host|Connection reset|timed out|unable to access|early EOF|RPC failed|ECONNRESET|ETIMEDOUT/i;

/** The fetch arm: metadata, both commits in the object clone, the diff by digest. */
async function fetchArm(selected, attempt) {
  const view = JSON.parse(
    gh([
      "pr",
      "view",
      selected.url,
      "--json",
      "baseRefOid,headRefOid,mergeCommit,mergedAt,title,body,changedFiles,additions,deletions,statusCheckRollup,closingIssuesReferences,baseRefName",
    ]),
  );
  const pr = {
    index: selected.index,
    url: selected.url,
    repository: selected.repository,
    number: selected.number,
    title: selected.title,
    author: selected.author,
    base: view.baseRefOid,
    head: view.headRefOid,
    mergeCommit: view.mergeCommit?.oid ?? null,
    mergedAt: view.mergedAt,
    body: view.body,
    linkedIssues: (view.closingIssuesReferences ?? []).map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
    })),
    historicalChecks: (view.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? check.context ?? null,
      conclusion: check.conclusion ?? check.state ?? null,
    })),
    changed: { files: view.changedFiles, additions: view.additions, deletions: view.deletions },
  };
  const clone = objectClonePath(runRecord.workingRoot, selected.repository, selected.number);
  if (!existsSync(clone)) {
    const cloned = run("git", [
      "clone",
      "--quiet",
      "--no-tags",
      "--no-checkout",
      "--depth=1",
      `https://github.com/${selected.repository}.git`,
      clone,
    ]);
    if (cloned.status !== 0) {
      rmSync(clone, { recursive: true, force: true });
      const reason = `clone failed: ${cloned.stderr.trim().slice(-500)}`;
      return {
        pr,
        failure: { kind: networkFailure.test(reason) ? "infrastructure" : "repository", reason },
      };
    }
  }
  const fetched = run(
    "git",
    ["fetch", "--quiet", "--no-tags", "--depth=1", "origin", pr.base, pr.head],
    {
      cwd: clone,
    },
  );
  if (fetched.status !== 0) {
    const reason = `base and head could not be fetched: ${fetched.stderr.trim().slice(-500)}`;
    return {
      pr,
      failure: { kind: networkFailure.test(reason) ? "infrastructure" : "repository", reason },
    };
  }
  run("git", ["update-ref", "refs/heads/study-base", pr.base], { cwd: clone });
  run("git", ["update-ref", "refs/heads/study-head", pr.head], { cwd: clone });
  for (const [name, sha] of [
    ["base", pr.base],
    ["head", pr.head],
  ])
    if (run("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: clone }).status !== 0)
      return {
        pr,
        failure: {
          kind: "repository",
          reason: `the ${name} commit ${sha} could not be fetched from the repository`,
        },
      };
  const names = run("git", ["diff", "--name-only", `${pr.base}..${pr.head}`], { cwd: clone })
    .stdout.trim()
    .split("\n")
    .filter(Boolean);
  pr.changedFiles = names;
  pr.testChanges = names.filter(testPath);
  pr.sourceChanges = names.filter((path) => !testPath(path));
  const diff = run("git", ["diff", `${pr.base}..${pr.head}`], { cwd: clone }).stdout;
  const artifacts = attemptDirectory(runRecord.paths.artifacts, selected.index, "fetch", attempt);
  const diffPath = writeFileInside(artifacts, "diff.patch", diff, { exclusive: true }).path;
  pr.diff = {
    digest: sha256(diff),
    bytes: Buffer.byteLength(diff),
    path: diffPath,
    location: `${diffPath} (outside the repository)`,
  };
  const has = (file) =>
    run("git", ["cat-file", "-e", `${pr.head}:${file}`], { cwd: clone }).status === 0;
  const manifest = has("package.json")
    ? "package.json"
    : has("pyproject.toml")
      ? "pyproject.toml"
      : null;
  pr.execution = {
    manifest,
    image: manifest === "pyproject.toml" ? pythonImage : nodeImage,
    objectClone: clone,
  };
  return { pr, summary: `fetched ${names.length} changed file(s)` };
}

const dockerDown =
  /Cannot connect to the Docker daemon|error during connect|docker: Error response from daemon/i;

/** The independent plain-CI arm at head and base, each in its own fresh checkout. */
async function suiteArm(fetch, attempt) {
  const work = attemptDirectory(runRecord.paths.work, fetch.pr.index, "suite", attempt);
  const originalSuite = {};
  const setup = {};
  for (const side of ["head", "base"]) {
    const checkout = freshCheckout(
      fetch.pr.execution.objectClone,
      join(work, side),
      fetch.pr[side],
    );
    const measured = plainSuite(checkout, {
      image: fetch.pr.execution.image,
      installTimeoutMs: budgets.installTimeoutMs,
      testTimeoutMs: budgets.testTimeoutMs,
    });
    originalSuite[side] = { commit: fetch.pr[side], ...measured.suite };
    setup[side] = measured.setup;
    // The checkout is scratch the arm made for this measurement; its record is the result.
    rmSync(checkout, { recursive: true, force: true });
  }
  const daemon =
    [setup.head, setup.base].some((entry) => dockerDown.test(entry.install.outputTail ?? "")) ||
    [originalSuite.head, originalSuite.base].some((entry) =>
      dockerDown.test(entry.outputTail ?? ""),
    );
  return {
    originalSuite,
    setup,
    ...(daemon
      ? { failure: { kind: "infrastructure", reason: "the container daemon was unavailable" } }
      : {}),
    summary: `head ${originalSuite.head.status} (collected ${originalSuite.head.collected}), base ${originalSuite.base.status}`,
  };
}

/** The verifier arm over a fresh checkout, with its evidence checked by the bundle itself. */
async function verifierArm(fetch, attempt) {
  const { pr } = fetch;
  const startedAt = Date.now();
  const work = attemptDirectory(runRecord.paths.work, pr.index, "verifier", attempt);
  const workspace = freshCheckout(pr.execution.objectClone, join(work, "workspace"), pr.head);
  const artifacts = attemptDirectory(runRecord.paths.artifacts, pr.index, "verifier", attempt);
  const summary = join(artifacts, "summary.md");
  const bundle = join(artifacts, "bundle");
  const image = pr.execution.image;
  const verifierArgs = [
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
    "--summary",
    summary,
    "--bundle",
    bundle,
    "--isolation",
    `docker:${image}`,
    "--require-isolation",
    "--install",
  ];
  const verifier = { package: "swarm-verify", version, argv: ["npx", ...verifierArgs] };
  // From outside the checkout: a repository's own .npmrc must not decide where the verifier is
  // fetched from.
  const verified = run("npx", verifierArgs, {
    cwd: runRecord.workingRoot,
    env: { PATH: process.env.PATH ?? "", HOME: homedir(), NO_COLOR: "1" },
    timeout: budgets.verifierTimeoutMs,
  });
  verifier.exit = verified.status;
  verifier.timedOut = verified.signal === "SIGTERM";
  writeFileInside(artifacts, "stderr.txt", verified.stderr ?? "", { exclusive: true });
  let report = null;
  try {
    report = JSON.parse(verified.stdout.trim().split("\n").at(-1) ?? "");
  } catch {
    report = null;
  }
  const reportBytes = report === null ? null : `${JSON.stringify(report, null, 2)}\n`;
  if (reportBytes !== null)
    writeFileInside(artifacts, "report.json", reportBytes, { exclusive: true });
  const result = {
    verifier,
    report:
      reportBytes === null
        ? null
        : {
            digest: sha256(reportBytes),
            bytes: Buffer.byteLength(reportBytes),
            location: `${join(artifacts, "report.json")} (outside the repository)`,
          },
    bundle: existsSync(bundle)
      ? { location: `${bundle} (outside the repository)`, digest: digestOfTree(bundle) }
      : null,
    evidence: bundleEvidence(existsSync(bundle) ? bundle : null),
    wallMs: Date.now() - startedAt,
  };
  if (report === null) {
    const stderrLast = (verified.stderr ?? "").trim().split("\n").at(-1) ?? "";
    const reason = `the verifier exited ${verified.status}${verifier.timedOut ? " (timed out)" : ""} without a report: ${stderrLast}`;
    return {
      ...result,
      outcome: "blocked",
      reason,
      failure: {
        kind: dockerDown.test(verified.stderr ?? "") ? "infrastructure" : "product",
        reason,
      },
      summary: "blocked",
    };
  }
  const checks = Array.isArray(report.checks) ? report.checks : [];
  return {
    ...result,
    outcome: "executed",
    // The verdict, read off the report's own fields. Whether the original suite is green is
    // not read here: it is the independent suite arm's, and a refusal here never decides it.
    verdict: {
      verified: report.verified ?? null,
      regression: report.regression ?? null,
      refusal: report.refusal ?? null,
      task: report.task ?? null,
      executionTrust: report.executionTrust ?? null,
      install: report.install ?? null,
      checks: Object.fromEntries(checks.map((check) => [check.id, check.status])),
      inherited: Object.fromEntries(
        checks.filter((check) => check.inheritedFromBase === true).map((check) => [check.id, true]),
      ),
    },
    summary: `executed; evidence ${result.evidence.valid ? "valid" : "invalid"}`,
  };
}

let done = 0;
for (const selected of runRecord.frame.selected) {
  if (done >= limit) break;
  if (only !== null && !only.has(selected.index)) continue;
  done += 1;
  const frameEntry = sha256(JSON.stringify(selected));
  if (armsWanted.has("fetch"))
    await runArm(runRecord, selected.index, "fetch", { frameEntry }, (attempt) =>
      fetchArm(selected, attempt),
    );
  const fetch = standingFetch(runRecord, selected.index);
  if (fetch === null || fetch.failure) {
    console.log(`${selected.index}: no standing fetch; the other arms wait for one`);
    continue;
  }
  const inputs = { frameEntry, diff: fetch.pr.diff.digest, fetchAttempt: fetch.attempt };
  if (armsWanted.has("suite"))
    await runArm(runRecord, selected.index, "suite", inputs, (attempt) => suiteArm(fetch, attempt));
  if (armsWanted.has("verifier"))
    await runArm(runRecord, selected.index, "verifier", inputs, (attempt) =>
      verifierArm(fetch, attempt),
    );
}
console.log(`${done} row(s) visited in run ${runRecord.runId}; records in ${runRecord.paths.rows}`);
