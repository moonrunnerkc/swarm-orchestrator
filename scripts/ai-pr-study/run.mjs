#!/usr/bin/env node
/**
 * The verifier arm of the AI-authored pull request study: every selected pull request, in the
 * frame's order, is fetched at its recorded base and head into a fresh clone outside the
 * repository and run through the published verifier at one frozen version, in a container,
 * with its dependencies installed from its lockfile. What the protocol says is preserved per
 * pull request is written into the output directory: the metadata GitHub reports, the changed
 * files with the test changes named, the historical CI conclusion, the verifier's report and
 * summary, the exit status and wall time, and the digest and outside-tree location of the
 * evidence bundle. Task truth is a separate arm (adjudicate.mjs) and is never read here.
 *
 *   node scripts/ai-pr-study/run.mjs <frame.json> <output directory> <verifier version>
 *        [--limit <n>] [--only <index,index>] [--image <node image>] [--python-image <image>]
 *        [--fetch-only]
 *
 * Resumable: a row whose verifier result exists is skipped. `--fetch-only` records the
 * metadata, the clone and the diff without running the verifier, so the adjudication arm can
 * start; a later run without it fills those rows in. A blocked row (the repository cannot be
 * fetched, the toolchain is unsupported, the run is refused) is a row with that reason.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const positional = [];
const flags = new Map();
const fetchOnly = args.includes("--fetch-only");
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--fetch-only") continue;
  if (arg.startsWith("--")) {
    flags.set(arg.slice(2), args[index + 1]);
    index += 1;
  } else positional.push(arg);
}
const [framePath, output, version] = positional;
if (!framePath || !output || !version) {
  console.error(
    "usage: run.mjs <frame.json> <output directory> <verifier version> [--limit <n>] [--only <indexes>] [--image <image>] [--python-image <image>]",
  );
  process.exit(2);
}
const frame = JSON.parse(readFileSync(framePath, "utf8"));
const limit = Number(flags.get("limit") ?? "1000");
const only = flags.has("only")
  ? new Set(
      String(flags.get("only"))
        .split(",")
        .map((n) => Number(n)),
    )
  : null;
const nodeImage = flags.get("image") ?? "node:24-bookworm";
const pythonImage = flags.get("python-image") ?? "ghcr.io/astral-sh/uv:python3.12-bookworm";
mkdirSync(output, { recursive: true });
// Every path handed to the verifier is absolute: it runs with the clone as its directory.
const outputRoot = resolve(output);
const workingRoot = join(homedir(), ".cache", "swarm-ai-pr-study");
mkdirSync(workingRoot, { recursive: true });

const run = (command, commandArgs, options = {}) =>
  spawnSync(command, commandArgs, {
    encoding: "utf8",
    maxBuffer: 256_000_000,
    ...options,
  });
const gh = (ghArgs) => execFileSync("gh", ghArgs, { encoding: "utf8", maxBuffer: 64_000_000 });

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

let done = 0;
for (const selected of frame.selected) {
  if (done >= limit) break;
  if (only !== null && !only.has(selected.index)) continue;
  const rowPath = join(outputRoot, `${String(selected.index).padStart(2, "0")}.json`);
  const existing = existsSync(rowPath) ? JSON.parse(readFileSync(rowPath, "utf8")) : null;
  if (existing !== null && existing.outcome !== "fetched") continue;
  if (existing !== null && fetchOnly) continue;
  done += 1;
  const startedAt = Date.now();
  const row = {
    ...(existing ?? {}),
    index: selected.index,
    url: selected.url,
    repository: selected.repository,
    number: selected.number,
    title: selected.title,
    author: selected.author,
    verifier: { package: "swarm-verify", version },
    startedAt: new Date(startedAt).toISOString(),
  };
  const finish = (outcome, extra = {}) => {
    Object.assign(row, extra, { outcome, wallMs: Date.now() - startedAt });
    writeFileSync(rowPath, `${JSON.stringify(row, null, 2)}\n`);
    console.log(`${selected.index} ${selected.repository}#${selected.number}: ${outcome}`);
  };
  try {
    // What GitHub reports about the pull request, at study time.
    const view = JSON.parse(
      gh([
        "pr",
        "view",
        selected.url,
        "--json",
        "baseRefOid,headRefOid,mergeCommit,mergedAt,title,body,changedFiles,additions,deletions,statusCheckRollup,closingIssuesReferences,baseRefName",
      ]),
    );
    row.base = view.baseRefOid;
    row.head = view.headRefOid;
    row.mergeCommit = view.mergeCommit?.oid ?? null;
    row.mergedAt = view.mergedAt;
    row.body = view.body;
    row.linkedIssues = (view.closingIssuesReferences ?? []).map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
    }));
    row.historicalChecks = (view.statusCheckRollup ?? []).map((check) => ({
      name: check.name ?? check.context ?? null,
      conclusion: check.conclusion ?? check.state ?? null,
    }));
    row.changed = {
      files: view.changedFiles,
      additions: view.additions,
      deletions: view.deletions,
    };

    // A fresh clone outside the repository, with the exact base and head fetched by SHA.
    // Only the two commits the row names, shallow: a full clone of a large repository is
    // gigabytes the study never reads, and both trees are complete at depth one.
    const clone = join(workingRoot, `${selected.repository.replace("/", "__")}-${selected.number}`);
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
        finish("blocked", { reason: `clone failed: ${cloned.stderr.trim().slice(-500)}` });
        continue;
      }
    }
    const fetched = run(
      "git",
      ["fetch", "--quiet", "--no-tags", "--depth=1", "origin", row.base, row.head],
      { cwd: clone },
    );
    if (fetched.status !== 0) {
      finish("blocked", {
        reason: `base and head could not be fetched: ${fetched.stderr.trim().slice(-500)}`,
      });
      continue;
    }
    const checkedOut = run("git", ["checkout", "--quiet", "--force", "--detach", row.head], {
      cwd: clone,
    });
    if (checkedOut.status !== 0) {
      finish("blocked", {
        reason: `head could not be checked out: ${checkedOut.stderr.slice(-500)}`,
      });
      continue;
    }
    run("git", ["clean", "-fdxq"], { cwd: clone });
    const names = run("git", ["diff", "--name-only", `${row.base}..${row.head}`], { cwd: clone })
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    row.changedFiles = names;
    row.testChanges = names.filter(testPath);
    row.sourceChanges = names.filter((path) => !testPath(path));
    // The diff is preserved outside the tree by digest; the row carries the digest.
    const diff = run("git", ["diff", `${row.base}..${row.head}`], { cwd: clone }).stdout;
    mkdirSync(join(workingRoot, "diffs"), { recursive: true });
    const diffPath = join(workingRoot, "diffs", `${String(selected.index).padStart(2, "0")}.diff`);
    writeFileSync(diffPath, diff);
    row.diff = {
      digest: `sha256:${createHash("sha256").update(diff).digest("hex")}`,
      bytes: Buffer.byteLength(diff),
      location: `${diffPath} (outside the repository)`,
    };

    // The toolchain the frame recorded, and the image that carries it.
    const manifest = existsSync(join(clone, "package.json"))
      ? "package.json"
      : existsSync(join(clone, "pyproject.toml"))
        ? "pyproject.toml"
        : null;
    const image = manifest === "pyproject.toml" ? pythonImage : nodeImage;
    row.execution = { isolation: `docker:${image}`, install: true, manifest };
    if (fetchOnly) {
      finish("fetched");
      continue;
    }

    // The frozen verifier, exactly as the Action invokes it, from the registry.
    const summary = rowPath.replace(/\.json$/, ".summary.md");
    const bundle = join(workingRoot, "bundles", String(selected.index).padStart(2, "0"));
    mkdirSync(join(workingRoot, "bundles"), { recursive: true });
    const verifierArgs = [
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
      "--summary",
      summary,
      "--bundle",
      bundle,
      "--isolation",
      `docker:${image}`,
      "--require-isolation",
      "--install",
    ];
    row.verifier.argv = ["npx", ...verifierArgs];
    const verified = run("npx", verifierArgs, {
      cwd: clone,
      env: { PATH: process.env.PATH ?? "", HOME: homedir(), NO_COLOR: "1" },
      timeout: 3_600_000,
    });
    row.verifier.exit = verified.status;
    row.verifier.timedOut = verified.signal === "SIGTERM";
    writeFileSync(rowPath.replace(/\.json$/, ".stderr.txt"), verified.stderr ?? "");
    let report = null;
    try {
      report = JSON.parse(verified.stdout.trim().split("\n").at(-1) ?? "");
    } catch {
      report = null;
    }
    if (report !== null)
      writeFileSync(
        rowPath.replace(/\.json$/, ".report.json"),
        `${JSON.stringify(report, null, 2)}\n`,
      );
    row.report =
      report === null
        ? null
        : {
            file: rowPath
              .replace(/\.json$/, ".report.json")
              .split("/")
              .at(-1),
          };
    row.bundle = existsSync(bundle)
      ? { location: `${bundle} (outside the repository)`, digest: digestOfTree(bundle) }
      : null;
    if (report === null) {
      finish("blocked", {
        reason: `the verifier exited ${verified.status} without a report: ${(verified.stderr ?? "").trim().split("\n").at(-1) ?? ""}`,
      });
      continue;
    }
    // The verdict, read off the report's own fields: which declared checks passed or failed,
    // whether the regression dimension was measured, whether anything was refused, and that
    // task truth is unjudged here (no contract), which the adjudication arm supplies apart.
    const checks = Array.isArray(report.checks) ? report.checks : [];
    finish("executed", {
      verdict: {
        verified: report.verified ?? null,
        regression: report.regression ?? null,
        refusal: report.refusal ?? null,
        task: report.task ?? null,
        executionTrust: report.executionTrust ?? null,
        install: report.install ?? null,
        checks: Object.fromEntries(checks.map((check) => [check.id, check.status])),
        originalSuiteGreen: checks
          .filter((check) => check.severity === "blocking")
          .every((check) => check.status === "passed" || check.status === "not-applicable"),
      },
    });
  } catch (cause) {
    finish("blocked", { reason: `harness error: ${cause.message.split("\n")[0]}` });
  }
}
console.log(`${done} row(s) attempted; results in ${outputRoot}`);
