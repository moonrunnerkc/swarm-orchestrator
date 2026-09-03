#!/usr/bin/env node
/**
 * The campaign driver: search, walk, run, report, in that order, each resumable.
 *
 *   node campaign/harness/campaign.mjs setup [--tarball <path>]
 *   node campaign/harness/campaign.mjs search
 *   node campaign/harness/campaign.mjs walk [--limit <n>]
 *   node campaign/harness/campaign.mjs run --arm <name> [--limit <n>] [--max-steps <n>] [--attempts <n>] [--timeout-minutes <n>]
 *   node campaign/harness/campaign.mjs report
 *
 * Everything the driver decides is a pure function in the modules beside it; this file is
 * the sequencing and the processes. Every process is an argument vector spawned directly,
 * with no shell in between. Every decision, seed and result is written to the campaign
 * directory as it is made, so a run that stops can be resumed from what it wrote and a
 * reader can follow what was chosen and why from the committed files alone.
 *
 * Plain node, node: builtins only, no dependencies.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import { armNamed, armNames } from "./arms.mjs";
import { candidateFrom, orderCandidates, supersedable, walkCandidates } from "./candidates.mjs";
import {
  armRunArgv,
  buildImageArgv,
  createNetworkArgv,
  forwarderAddressArgv,
  forwarderArgv,
  forwarderName,
  imageTags,
  offlineArgv,
  prepareArgv,
  workspaceCacheDirectory,
} from "./container.mjs";
import {
  excludedDirectories,
  installRecipes,
  mutationOperators,
  quotas,
  seedAttemptsMaximum,
  testCommands,
} from "./criteria.mjs";
import { fetchCandidates } from "./github-search.mjs";
import { countLines, countsAs } from "./line-count.mjs";
import { readManifestFacts } from "./manifest-facts.mjs";
import { applySite, sitesFor } from "./mutations.mjs";
import { taskPrompt } from "./prompt.mjs";
import { renderReport, summarizeArm } from "./report.mjs";
import { judgeFix, readBundle, runFacts, verifyBundle } from "./results.mjs";
import { projectTypeByLanguage, rejectionFromCheckout, rejectionFromSearch } from "./rules.mjs";
import { attemptSchedule, failingTestNames, isSourcePath, isTestPath, rankSourceFiles, seedRecord } from "./seed.mjs";
import { classifySuiteRun } from "./suite-outcome.mjs";

const HARNESS = dirname(fileURLToPath(import.meta.url));
const CAMPAIGN = resolve(HARNESS, "..");
const ROOT = resolve(CAMPAIGN, "..");

const directories = {
  selection: join(CAMPAIGN, "selection"),
  seeds: join(CAMPAIGN, "seeds"),
  results: join(CAMPAIGN, "results"),
  corpus: join(CAMPAIGN, "corpus"),
  work: join(CAMPAIGN, "work"),
  images: join(CAMPAIGN, "images"),
};

const files = {
  searchResults: join(directories.selection, "search-results.jsonl.gz"),
  candidates: join(directories.selection, "candidates.json"),
  decisions: join(directories.selection, "decisions.jsonl"),
  repos: join(directories.selection, "repos.json"),
  manifest: join(directories.seeds, "manifest.json"),
  report: join(directories.results, "report.md"),
};

class DriverError extends Error {
  constructor(what, remedy) {
    super(`${what}\n  try: ${remedy}`);
    this.name = "DriverError";
  }
}

/** Stops a walk after the session's budget of new judgements, recording nothing for the rest. */
class WalkLimitReached extends Error {}

function log(line) {
  process.stderr.write(`${new Date().toISOString()} ${line}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function slugOf(fullName) {
  return fullName.replace("/", "__");
}

const outputCap = 8 * 1024 * 1024;

/** One process, as an argument vector, output captured and bounded, killed at the timeout. */
function run(command, argv, { cwd = ROOT, timeoutMs, environment } = {}) {
  return new Promise((settle, reject) => {
    const child = spawn(command, argv, {
      cwd,
      env: environment ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      if (stdout.length < outputCap) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < outputCap) stderr += chunk;
    });
    const timer = timeoutMs === undefined ? null : setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (cause) => {
      if (timer !== null) clearTimeout(timer);
      reject(cause);
    });
    child.on("close", (code, signal) => {
      if (timer !== null) clearTimeout(timer);
      settle({
        exitCode: code ?? (signal === null ? 1 : 137),
        signal,
        stdout,
        stderr,
        output: `${stdout}${stderr}`,
      });
    });
  });
}

async function must(command, argv, options) {
  const outcome = await run(command, argv, options);
  if (outcome.exitCode !== 0) {
    throw new Error(
      `${command} ${argv.slice(0, 3).join(" ")} exited ${outcome.exitCode}: ${outcome.stderr.slice(-600).trim()}`,
    );
  }
  return outcome;
}

/** The builders return vectors that start with "docker"; the process is the rest. */
function docker(argv, options) {
  return run(argv[0], argv.slice(1), options);
}

function sleep(ms) {
  return new Promise((settle) => setTimeout(settle, ms));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (!flag.startsWith("--")) {
      throw new DriverError(`unexpected argument ${flag}`, "node campaign/harness/campaign.mjs --help");
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new DriverError(`${flag} needs a value`, `${flag} <value>`);
    }
    options[flag.slice(2)] = value;
    index += 1;
  }
  return { command, options };
}

// ---------------------------------------------------------------------------------------------
// setup: the images, the network, the forwarders

async function setup(options) {
  mkdirSync(directories.images, { recursive: true });
  let tarball = options.tarball === undefined ? null : resolve(options.tarball);
  if (tarball === null) {
    log("packing the CLI from this tree");
    const packed = await must("npm", ["pack", "--silent", "--pack-destination", directories.images]);
    tarball = join(directories.images, packed.stdout.trim().split("\n").pop());
  } else {
    cpSync(tarball, join(directories.images, basename(tarball)));
  }
  log(`tarball ${tarball}`);

  for (const type of Object.keys(imageTags)) {
    log(`building ${imageTags[type]}`);
    await must("docker", buildImageArgv({ type, imagesDirectory: directories.images, tarball }).slice(1), {
      timeoutMs: 30 * 60 * 1000,
    });
  }

  const network = await docker(createNetworkArgv());
  if (network.exitCode !== 0 && !/already exists/.test(network.stderr)) {
    throw new Error(`could not create the internal network: ${network.stderr.trim()}`);
  }

  for (const name of armNames) {
    const arm = armNamed(name);
    if (arm.frontier && process.env[arm.keyVariable] === undefined) {
      log(`forwarder for ${name} not started: ${arm.keyVariable} is not set in this environment`);
      continue;
    }
    await ensureForwarder(arm);
  }
  log("setup complete");
}

async function ensureForwarder(arm) {
  const [start, attach] = forwarderArgv(arm);
  const started = await docker(start);
  if (started.exitCode !== 0) {
    if (/already in use/.test(started.stderr)) {
      log(`forwarder ${forwarderName(arm)} is already running`);
      return;
    }
    throw new Error(`could not start ${forwarderName(arm)}: ${started.stderr.trim()}`);
  }
  await must("docker", attach.slice(1));
  log(`forwarder ${forwarderName(arm)} relaying to ${arm.frontier ? arm.host : "the host"}:${arm.port}`);
}

// ---------------------------------------------------------------------------------------------
// search: the candidate list, saved raw

async function search() {
  mkdirSync(directories.selection, { recursive: true });
  if (existsSync(files.candidates)) {
    throw new DriverError(
      `${files.candidates} already exists, and a second search would be a second candidate pool`,
      "delete the selection directory to start a different campaign, which needs criteria of its own",
    );
  }
  // GitHub allows thirty search requests a minute to an authenticated caller.
  const runGh = async (argv) => {
    await sleep(2200);
    return JSON.parse((await must("gh", argv)).stdout);
  };
  log("querying GitHub, one request every 2.2 seconds");
  const fetched = await fetchCandidates(runGh, nowIso);
  // Gzipped: the raw items run to tens of megabytes and are kept for reproduction, not reading.
  writeFileSync(files.searchResults, gzipSync(`${fetched.map((item) => JSON.stringify(item)).join("\n")}\n`));

  const byLanguage = {};
  for (const language of Object.keys(quotas)) {
    byLanguage[language] = orderCandidates(
      fetched.filter((item) => item.language === language).map(candidateFrom),
    );
  }
  writeJson(files.candidates, { queriedAt: nowIso(), byLanguage });
  for (const [language, candidates] of Object.entries(byLanguage)) {
    log(`${language}: ${candidates.length} candidates`);
  }
}

// ---------------------------------------------------------------------------------------------
// walk: judge candidates in order until the quotas are met

function listFiles(root) {
  const found = [];
  const skip = new Set([...excludedDirectories, workspaceCacheDirectory]);
  const walkDirectory = (relative) => {
    const entries = readdirSync(join(root, relative), { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walkDirectory(path);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  };
  walkDirectory("");
  return found;
}

function testArgv(type) {
  return testCommands[type].split(" ");
}

function installSteps(type, facts, workspace) {
  switch (type) {
    case "node":
      return [installRecipes.node[facts.lockfile]];
    case "python": {
      const steps = [["python", "-m", "venv", `/work/${workspaceCacheDirectory}/venv`], ...installRecipes.python];
      const pyproject = readFileSync(join(workspace, "pyproject.toml"), "utf8");
      const extras = installRecipes.pythonOptionalExtras.filter((extra) =>
        new RegExp(`^${extra}\\s*=`, "m").test(pyproject),
      );
      if (extras.length > 0) {
        steps.push(["python", "-m", "pip", "install", "-e", `.[${extras.join(",")}]`]);
      }
      for (const requirements of installRecipes.pythonRequirementFiles) {
        if (existsSync(join(workspace, requirements))) {
          steps.push(["python", "-m", "pip", "install", "-r", requirements]);
        }
      }
      return steps;
    }
    case "go":
      return installRecipes.go;
    case "rust":
      return installRecipes.rust;
    default:
      throw new Error(`no install recipe for ${type}`);
  }
}

async function suite(type, workspace) {
  const started = Date.now();
  const outcome = await docker(offlineArgv({ type, workspace, argv: testArgv(type) }));
  return {
    outcome: classifySuiteRun(type, outcome.exitCode, outcome.output),
    exitCode: outcome.exitCode,
    output: outcome.output,
    durationMs: Date.now() - started,
  };
}

async function findSeed(candidate, type, workspace) {
  const all = listFiles(workspace);
  const sourcePaths = all.filter((path) => isSourcePath(candidate.language, path));
  const testTexts = all
    .filter((path) => isTestPath(path) && countsAs(candidate.language, path))
    .slice(0, 200)
    .map((path) => readFileSync(join(workspace, path), "utf8"));
  const ranked = rankSourceFiles(sourcePaths, testTexts);
  const cache = new Map();
  const sitesOf = (operator, path) => {
    const key = `${operator}\n${path}`;
    if (!cache.has(key)) {
      cache.set(key, sitesFor(operator, readFileSync(join(workspace, path), "utf8")));
    }
    return cache.get(key);
  };
  const schedule = attemptSchedule(mutationOperators, ranked, sitesOf);
  const attemptsLog = [];
  for (const attempt of schedule) {
    const path = join(workspace, attempt.path);
    const original = readFileSync(path, "utf8");
    writeFileSync(path, applySite(original, attempt.site));
    const outcome = await suite(type, workspace);
    writeFileSync(path, original);
    attemptsLog.push({ operator: attempt.operator, file: attempt.path, line: attempt.site.line, outcome: outcome.outcome });
    log(`  seed attempt ${attemptsLog.length}: ${attempt.operator} at ${attempt.path}:${attempt.site.line} -> ${outcome.outcome}`);
    if (outcome.outcome === "test-failure") {
      return { attempt, failure: outcome, attemptsLog };
    }
  }
  return { attempt: null, attemptsLog };
}

async function judgeCandidate(candidate) {
  const early = rejectionFromSearch(candidate);
  if (early !== null) {
    return { accepted: false, reason: early, judgedAt: nowIso() };
  }
  const slug = slugOf(candidate.fullName);
  const workspace = join(directories.work, slug);
  rmSync(workspace, { recursive: true, force: true });
  mkdirSync(directories.work, { recursive: true });
  const reject = (reason, extra = {}) => {
    rmSync(workspace, { recursive: true, force: true });
    return { accepted: false, reason, judgedAt: nowIso(), ...extra };
  };

  log(`cloning ${candidate.fullName}`);
  const clone = await run(
    "git",
    ["clone", "--quiet", "--depth", "1", "--branch", candidate.defaultBranch, candidate.cloneUrl, workspace],
    { timeoutMs: 5 * 60 * 1000 },
  );
  if (clone.exitCode !== 0) {
    return reject(`clone failed: ${clone.stderr.trim().slice(-200)}`);
  }
  const commit = (await must("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();
  const clonedAt = nowIso();
  const facts = await readManifestFacts(workspace);
  const counted = await countLines(workspace, candidate.language);
  const late = rejectionFromCheckout(candidate, facts, counted.lines);
  if (late !== null) {
    return reject(late, { commit, lines: counted.lines });
  }
  const type = projectTypeByLanguage[candidate.language];
  appendFileSync(join(workspace, ".git", "info", "exclude"), `/${workspaceCacheDirectory}/\n`);

  for (const step of installSteps(type, facts, workspace)) {
    log(`  install: ${step.join(" ")}`);
    const installed = await docker(prepareArgv({ type, workspace, argv: step }));
    if (installed.exitCode !== 0) {
      return reject(`install failed: ${step.join(" ")} (exit ${installed.exitCode})`, {
        commit,
        lines: counted.lines,
        installTail: installed.output.slice(-1500),
      });
    }
  }

  const base = await suite(type, workspace);
  log(`  suite at base: ${base.outcome} in ${Math.round(base.durationMs / 1000)}s`);
  if (base.outcome !== "passed") {
    return reject(`suite at base: ${base.outcome} (exit ${base.exitCode})`, {
      commit,
      lines: counted.lines,
      suiteTail: base.output.slice(-1500),
    });
  }

  const seeded = await findSeed(candidate, type, workspace);
  if (seeded.attempt === null) {
    return reject(`no seed within ${seedAttemptsMaximum} attempts (${seeded.attemptsLog.length} tried)`, {
      commit,
      lines: counted.lines,
      attempts: seeded.attemptsLog,
    });
  }

  return {
    accepted: true,
    judgedAt: nowIso(),
    commit,
    clonedAt,
    lines: counted.lines,
    sourceFiles: counted.files,
    type,
    testCommand: testCommands[type],
    testScript: facts.testScript,
    lockfile: facts.lockfile,
    suiteAtBaseMs: base.durationMs,
    seedAttempts: seeded.attemptsLog,
    seed: seedRecord({
      repository: candidate.fullName,
      commit,
      language: candidate.language,
      type,
      testCommand: testCommands[type],
      attempt: seeded.attempt,
      failure: seeded.failure,
    }),
  };
}

async function walk(options) {
  const pool = readJson(files.candidates, null);
  if (pool === null) {
    throw new DriverError("no candidate list to walk", "node campaign/harness/campaign.mjs search");
  }
  const limit = options.limit === undefined ? Number.POSITIVE_INFINITY : Number(options.limit);
  const recorded = new Map();
  if (existsSync(files.decisions)) {
    for (const line of readFileSync(files.decisions, "utf8").split("\n").filter(Boolean)) {
      const decision = JSON.parse(line);
      recorded.set(decision.fullName, decision);
    }
  }
  const repos = readJson(files.repos, []);
  let judged = 0;

  const judge = async (candidate) => {
    const earlier = recorded.get(candidate.fullName);
    if (earlier !== undefined) {
      const { fullName, language, ...verdict } = earlier;
      return verdict;
    }
    if (judged >= limit) {
      throw new WalkLimitReached();
    }
    judged += 1;
    const verdict = await judgeCandidate(candidate);
    const { attempts, installTail, suiteTail, ...compact } = verdict;
    mkdirSync(directories.selection, { recursive: true });
    appendFileSync(
      files.decisions,
      `${JSON.stringify({ fullName: candidate.fullName, language: candidate.language, ...compact })}\n`,
    );
    if (attempts !== undefined || installTail !== undefined || suiteTail !== undefined) {
      writeJson(join(directories.selection, "rejections", `${slugOf(candidate.fullName)}.json`), {
        fullName: candidate.fullName,
        ...verdict,
      });
    }
    if (verdict.accepted) {
      repos.push({ ...candidate, ...verdict });
      writeJson(files.repos, repos);
      writeJson(files.manifest, {
        sealedCriteria: "../criteria.md",
        writtenAt: nowIso(),
        seeds: repos.map((repo) => repo.seed),
      });
      log(`accepted ${candidate.fullName} at ${verdict.commit}: ${verdict.seed.operator} at ${verdict.seed.file}:${verdict.seed.line}`);
    } else {
      log(`rejected ${candidate.fullName}: ${verdict.reason}`);
    }
    return verdict;
  };

  try {
    const outcome = await walkCandidates(pool.byLanguage, judge);
    log(`walk complete: ${outcome.accepted.length} accepted, ${outcome.decisions.length} decisions`);
    for (const [language, short] of Object.entries(outcome.shortfalls)) {
      log(`  ${language} is short by ${short}: the candidate pool ran out`);
    }
  } catch (cause) {
    if (cause instanceof WalkLimitReached) {
      log(`walk paused after ${judged} new judgement(s); run again to continue`);
      return;
    }
    throw cause;
  }
}

// ---------------------------------------------------------------------------------------------
// rejudge: judge again, under an amended harness, the rejections one reason accounts for

/**
 * A rejection that was the harness's doing rather than the repository's, a toolchain pinned
 * too old for the pool, is judged again once the harness is amended. The earlier decision
 * stays in the record and the new one is appended after it, naming what it supersedes; the
 * walk reads the last decision for a repository, so the amended judgement is the one that
 * stands. Quotas are not consulted here: a repository this accepts is one the walk then
 * counts when it resumes, exactly as if it had been accepted in its place in the order.
 */
async function rejudge(options) {
  if (options.reason === undefined && options.marker === undefined) {
    throw new DriverError(
      "rejudge needs the reason to supersede, or a marker to find in the rejection tails",
      '--reason "install failed: go mod download" or --marker "No space left on device"',
    );
  }
  if (pgrepWalk()) {
    throw new DriverError("the walk is running, and two writers on one record disagree", "stop the walk first");
  }
  const decisions = existsSync(files.decisions)
    ? readFileSync(files.decisions, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
    : [];
  const pool = readJson(files.candidates, null);
  if (pool === null) {
    throw new DriverError("no candidate list", "node campaign/harness/campaign.mjs search");
  }
  const repos = readJson(files.repos, []);
  // A marker selects by what the rejected run printed rather than by the rule that rejected
  // it: a disk that filled mid-walk fails installs and suites alike, and the tails say so.
  const standing =
    options.marker === undefined
      ? supersedable(decisions, options.reason)
      : supersedable(decisions, "").filter((decision) => {
          const detail = readJson(join(directories.selection, "rejections", `${slugOf(decision.fullName)}.json`), null);
          // Case-folded: go and pip print "no space left on device", tar prints "No space".
          return (
            detail !== null &&
            `${detail.installTail ?? ""}\n${detail.suiteTail ?? ""}`.toLowerCase().includes(options.marker.toLowerCase())
          );
        });
  log(`${standing.length} standing rejection(s) ${options.marker === undefined ? `begin with "${options.reason}"` : `printed "${options.marker}"`}`);
  for (const earlier of standing) {
    const candidate = (pool.byLanguage[earlier.language] ?? []).find((entry) => entry.fullName === earlier.fullName);
    if (candidate === undefined) {
      log(`${earlier.fullName}: not in the candidate list, left as it stands`);
      continue;
    }
    const verdict = await judgeCandidate(candidate);
    const { attempts, installTail, suiteTail, ...compact } = verdict;
    appendFileSync(
      files.decisions,
      `${JSON.stringify({ fullName: candidate.fullName, language: candidate.language, ...compact, supersedes: earlier.judgedAt ?? null, supersededReason: earlier.reason, supersededBecause: options.marker ?? options.reason })}\n`,
    );
    if (attempts !== undefined || installTail !== undefined || suiteTail !== undefined) {
      writeJson(join(directories.selection, "rejections", `${slugOf(candidate.fullName)}.json`), { fullName: candidate.fullName, ...verdict });
    }
    if (verdict.accepted) {
      repos.push({ ...candidate, ...verdict });
      writeJson(files.repos, repos);
      writeJson(files.manifest, { sealedCriteria: "../criteria.md", writtenAt: nowIso(), seeds: repos.map((repo) => repo.seed) });
      log(`accepted ${candidate.fullName} at ${verdict.commit}: ${verdict.seed.operator} at ${verdict.seed.file}:${verdict.seed.line}`);
    } else {
      log(`rejected ${candidate.fullName} again: ${verdict.reason}`);
    }
  }
}

function pgrepWalk() {
  const found = spawnSync("pgrep", ["-f", "campaign.mjs walk"], { encoding: "utf8" });
  return found.status === 0 && found.stdout.trim().length > 0;
}

// ---------------------------------------------------------------------------------------------
// run: one arm over every accepted repository

async function backendReachable(arm) {
  const probe = await docker(
    offlineArgv({
      type: "node",
      workspace: directories.images,
      argv: [
        "node",
        "-e",
        "fetch(process.argv[1]).then((r) => { console.log(r.status); process.exit(r.ok ? 0 : 1); }, (e) => { console.error(e.message); process.exit(1); })",
        `http://${forwarderName(arm)}:${arm.port}/v1/models`,
      ],
      timeoutSeconds: 30,
    }),
  );
  return probe.exitCode === 0;
}

async function runArm(options) {
  if (options.arm === undefined) {
    throw new DriverError("run needs an arm", `--arm <${armNames.join("|")}>`);
  }
  const armName = options.arm;
  const arm = armNamed(armName);
  const limit = options.limit === undefined ? Number.POSITIVE_INFINITY : Number(options.limit);
  const maxSteps = Number(options["max-steps"] ?? 40);
  const attempts = Number(options.attempts ?? 2);
  const timeoutMinutes = Number(options["timeout-minutes"] ?? 45);
  const key = arm.frontier ? process.env[arm.keyVariable] : null;
  if (arm.frontier && key === undefined) {
    throw new DriverError(`${arm.keyVariable} is not set, so the ${armName} arm cannot run`, `export ${arm.keyVariable}=... and run again`);
  }
  await ensureForwarder(arm);
  const forwarderAddress = arm.frontier
    ? (await must("docker", forwarderAddressArgv(arm).slice(1))).stdout.trim()
    : null;
  if (!arm.frontier && !(await backendReachable(arm))) {
    throw new DriverError(
      `the ${arm.backend} backend is not reachable through ${forwarderName(arm)} on port ${arm.port}`,
      `start ${arm.backend} on the host and confirm curl http://127.0.0.1:${arm.port}/v1/models answers`,
    );
  }

  const repos = readJson(files.repos, []);
  if (repos.length === 0) {
    throw new DriverError("no accepted repositories to run", "node campaign/harness/campaign.mjs walk");
  }
  let done = 0;
  for (const repo of repos) {
    if (done >= limit) break;
    const resultPath = join(directories.results, armName, `${slugOf(repo.fullName)}.json`);
    if (existsSync(resultPath)) continue;
    await runOne({ arm, armName, repo, maxSteps, attempts, timeoutMinutes, forwarderAddress, key, resultPath });
    done += 1;
  }
  log(`${armName}: ${done} run(s) this session`);
}

async function runOne({ arm, armName, repo, maxSteps, attempts, timeoutMinutes, forwarderAddress, key, resultPath }) {
  const slug = slugOf(repo.fullName);
  const prepared = join(directories.work, slug);
  const armRoot = join(directories.work, `${slug}.arms`, armName);
  rmSync(armRoot, { recursive: true, force: true });
  mkdirSync(armRoot, { recursive: true });

  const base = {
    repository: repo.fullName,
    language: repo.language,
    type: repo.type,
    commit: repo.commit,
    arm: armName,
    backend: arm.backend,
    model: arm.model,
    maxSteps,
    attempts,
    timeoutMinutes,
  };

  if (!existsSync(prepared)) {
    writeJson(resultPath, {
      ...base,
      startedAt: nowIso(),
      outcome: "not-run",
      reason: "the prepared workspace is missing; run the walk again on this machine",
      executed: false,
      timedOut: false,
      bundle: null,
    });
    log(`${repo.fullName}: not run, prepared workspace missing`);
    return;
  }

  const workspace = join(armRoot, "workspace");
  cpSync(prepared, workspace, { recursive: true, verbatimSymlinks: true });
  const seedPath = join(workspace, repo.seed.file);
  writeFileSync(
    seedPath,
    applySite(readFileSync(seedPath, "utf8"), { line: repo.seed.line, before: repo.seed.before, after: repo.seed.after }),
  );
  const identity = ["-c", "user.name=campaign", "-c", "user.email=campaign@example.invalid", "-c", "commit.gpgsign=false"];
  await must("git", [...identity, "commit", "--quiet", "--all", "--message", "campaign: seeded defect"], { cwd: workspace });
  const seededCommit = (await must("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim();

  const outputDirectory = join(armRoot, "out");
  mkdirSync(outputDirectory, { recursive: true });
  const task = taskPrompt(repo.testCommand);
  const startedAt = nowIso();
  const started = Date.now();
  log(`${repo.fullName} on ${armName}: running`);
  const ran = await docker(
    armRunArgv({ type: repo.type, workspace, outputDirectory, arm, task, maxSteps, attempts, timeoutSeconds: timeoutMinutes * 60, forwarderAddress, key }),
    { timeoutMs: (timeoutMinutes + 5) * 60 * 1000 },
  );
  const durationMs = Date.now() - started;
  writeFileSync(join(outputDirectory, "run-transcript.txt"), ran.output);

  const bundleDirectory = join(outputDirectory, "bundle");
  const bundle = readBundle(bundleDirectory);
  const facts = bundle === null ? null : runFacts(bundle);
  const verified = bundle === null ? null : verifyBundle(bundleDirectory);

  const after = await suite(repo.type, workspace);
  const changed = (await run("git", ["diff", "--name-only", seededCommit], { cwd: workspace })).stdout.split("\n").filter(Boolean);
  const untracked = (await run("git", ["ls-files", "--others", "--exclude-standard"], { cwd: workspace })).stdout.split("\n").filter(Boolean);
  const testFilesChanged = [...changed, ...untracked].filter(isTestPath);
  const seedLineRestored = readFileSync(seedPath, "utf8").split("\n")[repo.seed.line - 1] === repo.seed.before;
  const fix = judgeFix({ suiteOutcome: after.outcome, testFilesChanged, seedLineRestored });

  const result = {
    ...base,
    seededCommit,
    startedAt,
    durationMs,
    containerExitCode: ran.exitCode,
    timedOut: ran.exitCode === 137,
    executed: facts?.executed ?? false,
    outcome: bundle === null ? "no-bundle" : facts.executed ? fix : "not-executed",
    bundle:
      bundle === null
        ? null
        : { verified: verified.exitCode === 0, verifierExitCode: verified.exitCode, ...facts },
    suiteAfter: after.outcome,
    suiteAfterMs: after.durationMs,
    changedFiles: changed,
    untrackedFiles: untracked,
    testFilesChanged,
    seedLineRestored,
    corpus: bundle === null ? null : `corpus/${armName}/${slug}`,
  };
  writeJson(resultPath, result);
  if (bundle !== null) {
    const destination = join(directories.corpus, armName, slug);
    rmSync(destination, { recursive: true, force: true });
    cpSync(bundleDirectory, destination, { recursive: true });
    cpSync(join(outputDirectory, "run-transcript.txt"), join(destination, "run-transcript.txt"));
  }
  rmSync(armRoot, { recursive: true, force: true });
  log(`${repo.fullName} on ${armName}: ${result.outcome} in ${Math.round(durationMs / 60000)} min, bundle ${bundle === null ? "none" : verified.exitCode === 0 ? "verified" : "REFUSED"}`);
}

// ---------------------------------------------------------------------------------------------
// report

function report() {
  const summaries = {};
  const notes = [];
  for (const name of armNames) {
    const directory = join(directories.results, name);
    const results = existsSync(directory)
      ? readdirSync(directory)
          .filter((entry) => entry.endsWith(".json"))
          .sort()
          .map((entry) => readJson(join(directory, entry)))
      : [];
    summaries[name] = summarizeArm(results);
    if (results.length === 0) {
      notes.push(`${name}: no run recorded`);
    }
  }
  const page = renderReport(summaries, { generatedAt: nowIso(), notes });
  mkdirSync(directories.results, { recursive: true });
  writeFileSync(files.report, page);
  process.stdout.write(page);
}

// ---------------------------------------------------------------------------------------------

const HELP = `campaign driver

  node campaign/harness/campaign.mjs setup [--tarball <path>]
  node campaign/harness/campaign.mjs search
  node campaign/harness/campaign.mjs walk [--limit <n>]
  node campaign/harness/campaign.mjs rejudge --reason "<prefix of the rejection reason>" | --marker "<text in the rejected run's output>"
  node campaign/harness/campaign.mjs run --arm <${armNames.join("|")}> [--limit <n>] [--max-steps <n>] [--attempts <n>] [--timeout-minutes <n>]
  node campaign/harness/campaign.mjs report
`;

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  switch (command) {
    case "setup":
      return setup(options);
    case "search":
      return search();
    case "walk":
      return walk(options);
    case "rejudge":
      return rejudge(options);
    case "run":
      return runArm(options);
    case "report":
      return report();
    case "--help":
    case "-h":
    case undefined:
      process.stdout.write(HELP);
      return;
    default:
      throw new DriverError(`unknown command ${command}`, "node campaign/harness/campaign.mjs --help");
  }
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
