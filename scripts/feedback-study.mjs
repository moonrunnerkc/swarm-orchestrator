#!/usr/bin/env node
/**
 * Does a specific mechanical verification finding, given after an agent already satisfied the
 * visible acceptance check and the repository's own checks, improve held-back correctness more
 * than the same repair budget spent on a neutral review?
 *
 * One shared prefix per model and task, then up to four arms forked from that exact workspace:
 * neutral review, reach findings, mutation findings, and both. The held-back half scores every
 * arm's final patch and the prefix patch afterwards, in a phase that starts only once every unit
 * of every registered model has settled.
 *
 *   node scripts/feedback-study.mjs build                   # dist, under the study's lock
 *   node scripts/feedback-study.mjs freeze                  # the cohort, from the viability record
 *   node scripts/feedback-study.mjs identities              # what a protocol registers
 *   node scripts/feedback-study.mjs run --model <id>        # one model's units; resumable
 *   node scripts/feedback-study.mjs score                   # held-back scores; resumable
 *   node scripts/feedback-study.mjs analyze [--out <dir>]   # summary, classifications, report
 *
 * `--synthetic --evidence <dir>` runs the same phases over the synthetic cohort, which is how the
 * plumbing is exercised without looking at an outcome of the cohort the estimate is made over.
 *
 * The protocol document beside the evidence carries the frozen parameters as its first JSON
 * block, and every row carries that document's digest, the manifest's, the acquisition sources'
 * and the model's. `run` and `score` refuse to write beside rows of another identity, and
 * `analyze` refuses to read them together.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, homedir, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const argv = process.argv.slice(3);
const command = process.argv[2];
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};
const synthetic = argv.includes("--synthetic");

const git = (args, cwd = repositoryRoot) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

/**
 * The analysis and the page are recorded by each derivation and registered by the protocol, and
 * a later correction to either is written beside the published one, never over it. Everything
 * else under src that is not a test decides what a run does or observes, and is the acquisition
 * identity together with this driver and the lockfile: the agent, the verifier and the judge all
 * run from it.
 */
const analysisSources = [
  "src/eval/feedback-study-analysis.ts",
  "src/eval/known-total.ts",
  "src/eval/patch-metrics.ts",
  "src/eval/reach-pressure-derivation.ts",
  "src/eval/statistics.ts",
];
const rendererSources = ["src/eval/feedback-study-report.ts"];

function acquisitionSources() {
  const analysisOnly = new Set(["src/eval/feedback-study-analysis.ts", ...rendererSources]);
  return git(["ls-files", "--", "src", "package.json", "package-lock.json"])
    .split("\n")
    .filter((path) => path.length > 0)
    .filter((path) => !/\.test\.[cm]?[jt]sx?$/.test(path) && !analysisOnly.has(path))
    .concat(["scripts/feedback-study.mjs"])
    .sort();
}

function digestOfSources(lib, sources) {
  return lib.digestOfJson(
    Object.fromEntries(
      sources.map((path) => [path, lib.digestOfBytes(readFileSync(join(repositoryRoot, path)))]),
    ),
  );
}

function componentDigests(lib) {
  return {
    acquisition: digestOfSources(lib, acquisitionSources()),
    analysis: digestOfSources(lib, analysisSources),
    renderer: digestOfSources(lib, rendererSources),
  };
}

function sourceIdentity() {
  const dirty = git(["status", "--porcelain", "--", "src", "scripts", "package.json"]);
  if (dirty.length === 0) return git(["rev-parse", "HEAD"]);
  const edits = createHash("sha256")
    .update(dirty)
    .update(git(["diff", "--", "src", "scripts", "package.json"]))
    .digest("hex");
  return `${git(["rev-parse", "HEAD"])} with uncommitted edits ${edits.slice(0, 16)}`;
}

function requireFreshDist() {
  const stamp = join(repositoryRoot, "dist/.built-from");
  const built = existsSync(stamp) ? readFileSync(stamp, "utf8").trim() : "never";
  if (built !== sourceIdentity()) {
    throw new Error(
      `dist was built from "${built}" and the sources are "${sourceIdentity()}". Run this script's \`build\`.`,
    );
  }
}

async function modules() {
  const from = (path) => import(join(repositoryRoot, "dist", path));
  return {
    ...(await from("evidence/canonical-json.js")),
    ...(await from("eval/agent-session.js")),
    ...(await from("eval/endpoint-health.js")),
    ...(await from("eval/feedback-study.js")),
    ...(await from("eval/feedback-study-analysis.js")),
    ...(await from("eval/feedback-study-report.js")),
    ...(await from("eval/patch-metrics.js")),
    ...(await from("eval/pr-task-judge.js")),
    ...(await from("eval/pr-task-paths.js")),
    ...(await from("eval/reach-pressure.js")),
    ...(await from("eval/reach-pressure-analysis.js")),
    ...(await from("eval/reach-pressure-derivation.js")),
    ...(await from("eval/sealed-workspace.js")),
    ...(await from("eval/task-identity.js")),
  };
}

const evidenceRoot = resolve(repositoryRoot, flag("--evidence", "docs/evidence/feedback-study"));
const paths = {
  protocol: join(evidenceRoot, "protocol.md"),
  manifest: join(evidenceRoot, "manifest.json"),
  results: join(evidenceRoot, "results.jsonl"),
  hiddenScores: join(evidenceRoot, "hidden-scores.jsonl"),
  environment: join(evidenceRoot, "environment.json"),
  summary: join(evidenceRoot, "summary.json"),
  classifications: join(evidenceRoot, "classifications.json"),
  report: join(evidenceRoot, "report.md"),
  postscript: join(evidenceRoot, "postscript.md"),
  derivation: join(evidenceRoot, "derivation.json"),
  patches: join(evidenceRoot, "patches"),
};

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/** The frozen parameters: the first JSON block of the protocol document, and nothing else. */
function readProtocol(lib) {
  const text = readFileSync(paths.protocol, "utf8");
  const block = /```json\n([\s\S]*?)\n```/.exec(text);
  if (block === null) throw new Error(`${paths.protocol} carries no JSON block of parameters`);
  return { parameters: JSON.parse(block[1]), digest: lib.digestOfBytes(text) };
}

/** A panel entry's digest is over everything the entry pins, the digest field aside. */
function modelDigestOf(lib, entry) {
  const { digest: _digest, ...pinned } = entry;
  return lib.digestOfJson(pinned);
}

/**
 * Everything a row is stamped with, checked against what the protocol froze before anything runs.
 * An instrument edited after registration is a different experiment and says so here, not in the
 * analysis of rows it already wrote.
 */
function studyIdentity(lib, { bindToCommit, enforceAcquisition = true }) {
  const protocol = readProtocol(lib);
  const parameters = protocol.parameters;
  if (parameters.schema !== "swarm.feedback-study.protocol.v1") {
    throw new Error(`${paths.protocol} is not a feedback-study protocol`);
  }
  const manifestText = readFileSync(paths.manifest, "utf8");
  const manifest = lib.studyManifestSchema.parse(JSON.parse(manifestText));
  const components = componentDigests(lib);
  const policy = lib.feedbackStudyPolicyNamed(parameters.policy);
  const identity = {
    study: "feedback-intervention",
    generation: parameters.generation,
    protocolDigest: protocol.digest,
    manifestDigest: lib.digestOfJson(JSON.parse(manifestText)),
    acquisitionDigest: components.acquisition,
    policyDigest: policy.digest,
    harness: git(["rev-parse", "HEAD"]),
  };
  if (parameters.cohort !== manifest.cohort) {
    throw new Error(
      `the protocol names ${parameters.cohort} and the manifest is ${manifest.cohort}`,
    );
  }
  if (synthetic !== manifest.cohort.startsWith("synthetic-")) {
    throw new Error(
      `--synthetic is for a synthetic cohort and only for one; this is ${manifest.cohort}`,
    );
  }
  for (const [key, registered] of [
    ["manifestDigest", parameters.manifestDigest],
    ["policyDigest", parameters.policyDigest],
    ...(enforceAcquisition ? [["acquisitionDigest", parameters.identities.acquisition]] : []),
  ]) {
    if (registered !== identity[key]) {
      throw new Error(
        `the protocol froze ${key} ${registered} and this checkout has ${identity[key]}`,
      );
    }
  }
  for (const entry of parameters.panel) {
    if (modelDigestOf(lib, entry) !== entry.digest) {
      throw new Error(
        `the protocol's entry for ${entry.id} does not digest to the digest it carries`,
      );
    }
  }
  if (bindToCommit) {
    const outside = execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line.length > 0)
      .filter((line) => !resolve(repositoryRoot, line.slice(3)).startsWith(`${evidenceRoot}/`));
    if (outside.length > 0) {
      throw new Error(
        `a confirmatory run binds its rows to a commit, and the tree is not that commit:\n${outside.join("\n")}`,
      );
    }
    if (git(["ls-files", "--", relative(repositoryRoot, paths.protocol)]).length === 0) {
      throw new Error(
        "the protocol is not committed, and it has to be before any cohort task runs",
      );
    }
  }
  const panel = parameters.panel.map((entry) => ({ id: entry.id, digest: entry.digest }));
  // The analysis sees the rows' own harness commit, which is what they were written at.
  return { identity, manifest, parameters, components, policy, panel };
}

function workingRootOf(lib, parameters) {
  const root = flag("--working-root", null);
  if (root !== null) return resolve(root);
  return join(
    lib.prTaskWorkingRoot(homedir()),
    synthetic ? "feedback-study-preflight" : "feedback-study",
    `g${parameters.generation}`,
  );
}

function corpusRootOf(lib) {
  const root = flag("--corpus-root", null);
  return root === null ? lib.prTaskWorkingRoot(homedir()) : resolve(root);
}

/**
 * One driver at a time, and dist is built inside the lock before anything is imported from it. A
 * second driver rebuilding dist would replace the files the first one's children start from.
 */
async function underTheLock(body, { build = true } = {}) {
  const lock = join(repositoryRoot, ".swarm", "feedback-study.lock");
  mkdirSync(dirname(lock), { recursive: true });
  if (existsSync(lock)) {
    const holder = Number(readFileSync(lock, "utf8"));
    let alive = true;
    try {
      process.kill(holder, 0);
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`another driver (pid ${holder}) holds ${lock}`);
  }
  writeFileSync(lock, String(process.pid));
  try {
    if (build) {
      execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-dist.mjs")], {
        cwd: repositoryRoot,
        stdio: ["ignore", "ignore", "inherit"],
      });
      writeFileSync(join(repositoryRoot, "dist/.built-from"), `${sourceIdentity()}\n`);
    }
    return await body(await modules());
  } finally {
    rmSync(lock, { force: true });
  }
}

// ---------------------------------------------------------------------------------------------
// freeze

/**
 * The cohort: every historical task of the reach-pressure cohort, and every task viable since,
 * with no repository above the cap share of the final cohort where that can be had without
 * dropping a historical task. Which new task of an over-cap repository is set aside is decided by
 * the digest of its name, which knows nothing about how hard it is. No outcome of this study
 * existed when this ran.
 */
export function capCohort({ tasks, historicalIds, capShare, keyOf }) {
  const kept = new Map(tasks.map((task) => [task.id, task]));
  const setAside = [];
  for (;;) {
    const cap = Math.floor(capShare * kept.size);
    const byRepository = new Map();
    for (const task of kept.values()) {
      byRepository.set(task.repository, [...(byRepository.get(task.repository) ?? []), task]);
    }
    const over = [...byRepository.entries()]
      .filter(
        ([, members]) =>
          members.length > cap && members.some((task) => !historicalIds.has(task.id)),
      )
      .sort(([one], [other]) => (one < other ? -1 : 1));
    if (over.length === 0) {
      const overCap = [...byRepository.entries()]
        .filter(([, members]) => members.length > cap)
        .map(([repository, members]) => ({ repository, tasks: members.length }))
        .sort((one, other) => (one.repository < other.repository ? -1 : 1));
      return { kept: [...kept.values()], setAside, overCap, cap };
    }
    const [, members] = over[0];
    const dropped = members
      .filter((task) => !historicalIds.has(task.id))
      .sort((one, other) => (keyOf(one) < keyOf(other) ? 1 : -1))[0];
    kept.delete(dropped.id);
    setAside.push({ id: dropped.id, key: keyOf(dropped) });
  }
}

async function freeze() {
  requireFreshDist();
  const lib = await modules();
  const sourcePath = flag("--source", "campaign/pr-tasks/viable.json");
  const sourceText = readFileSync(resolve(repositoryRoot, sourcePath), "utf8");
  const historicalPath = flag(
    "--historical",
    "docs/evidence/2026-09-17/reach-pressure-experiment/manifest.json",
  );
  const historicalText = readFileSync(resolve(repositoryRoot, historicalPath), "utf8");
  const historicalIds = new Set(JSON.parse(historicalText).tasks.map((task) => task.id));
  const capShare = Number(flag("--cap", "0.1"));
  const viable = JSON.parse(sourceText).tasks.filter((one) => one.viable);
  const corpusRoot = corpusRootOf(lib);
  const seen = new Map();
  const tasks = [];
  for (const one of viable) {
    const identity = lib.taskIdentity(one);
    if (seen.has(identity)) {
      throw new Error(
        `${one.repository}#${one.pull} repeats ${seen.get(identity)}: one specification, two rows`,
      );
    }
    seen.set(identity, `${one.repository}#${one.pull}`);
    const oracleFile = execFileSync("git", ["show", `${one.mergeCommit}:${one.testFile}`], {
      cwd: lib.taskCheckout(corpusRoot, one),
      maxBuffer: 64 * 1024 * 1024,
    });
    tasks.push({
      id: `${one.repository}#${one.pull}`,
      repository: one.repository,
      pull: one.pull,
      baseCommit: one.baseCommit,
      mergeCommit: one.mergeCommit,
      testFile: one.testFile,
      runner: one.runner,
      taskTextDigest: lib.digestOfBytes(one.taskText),
      visibleCases: one.sealedCases,
      heldBackCases: one.heldBackCases,
      oracleFileDigest: lib.digestOfBytes(oracleFile),
      sourceRecordDigest: lib.digestOfJson(one),
    });
  }
  const missing = [...historicalIds].filter((id) => !tasks.some((task) => task.id === id));
  if (missing.length > 0 && !synthetic) {
    throw new Error(`historical tasks no longer viable in ${sourcePath}: ${missing.join(", ")}`);
  }
  const capped = capCohort({
    tasks,
    historicalIds,
    capShare,
    keyOf: (task) => lib.digestOfBytes(task.id),
  });
  const kept = capped.kept.sort((left, right) => (left.id < right.id ? -1 : 1));
  const manifest = lib.studyManifestSchema.parse({
    schema: "swarm.feedback-study.manifest.v1",
    cohort: flag("--cohort", `mined-pr-viable-${kept.length}`),
    source: { path: sourcePath, digest: lib.digestOfBytes(sourceText) },
    selection: {
      rule:
        "every task of the historical reach-pressure cohort, and every task viable since, with a new " +
        `task of any repository above ${capShare * 100}% of the final cohort set aside by the largest ` +
        "SHA-256 of its name, one at a time, until none is; no historical task is set aside",
      repositoryCapShare: capShare,
      historical: {
        path: historicalPath,
        digest: lib.digestOfBytes(historicalText),
        tasks: historicalIds.size,
      },
      viable: tasks.length,
      setAsideByCap: capped.setAside,
      repositoriesOverCap: capped.overCap,
    },
    tasks: kept,
  });
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  const repositories = new Set(kept.map((task) => task.repository));
  console.log(
    `froze ${kept.length} task(s) across ${repositories.size} repositories: ${paths.manifest}`,
  );
  console.log(
    `cap ${capped.cap} per repository; ${capped.setAside.length} new task(s) set aside by it`,
  );
  for (const one of capped.overCap)
    console.log(`  over the cap, historical: ${one.repository} ${one.tasks}`);
  console.log(`manifestDigest ${lib.digestOfJson(manifest)}`);
}

function identities() {
  return underTheLock(async (lib) => {
    const components = componentDigests(lib);
    const policy = lib.feedbackStudyPolicyNamed(flag("--policy", "feedback-study-v1"));
    console.log(`acquisition ${components.acquisition}`);
    console.log(`analysis    ${components.analysis}`);
    console.log(`renderer    ${components.renderer}`);
    console.log(`policy      ${policy.id} ${policy.digest}`);
    if (existsSync(paths.manifest)) {
      console.log(
        `manifest    ${lib.digestOfJson(JSON.parse(readFileSync(paths.manifest, "utf8")))}`,
      );
    }
    if (existsSync(paths.protocol)) {
      for (const entry of readProtocol(lib).parameters.panel ?? []) {
        console.log(`model       ${entry.id} ${modelDigestOf(lib, entry)}`);
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// run

function recordEnvironment(entry, served) {
  const existing = existsSync(paths.environment)
    ? JSON.parse(readFileSync(paths.environment, "utf8"))
    : { machine: null, models: {} };
  if (existing.models[entry.id] !== undefined) return;
  existing.machine ??= {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model ?? "unknown",
    cores: cpus().length,
    memoryBytes: totalmem(),
  };
  existing.models[entry.id] = {
    endpoint: entry.endpoint,
    servedModels: served,
    firstRunAt: new Date().toISOString(),
  };
  writeFileSync(paths.environment, `${JSON.stringify(existing, null, 2)}\n`);
}

const modelSlug = (id) => id.replace(/[^A-Za-z0-9._-]+/g, "__");

/** A clone of the prefix's workspace, byte for byte and fast: APFS clones share blocks until written. */
function cloneWorkspace(parent, destination) {
  rmSync(destination, { recursive: true, force: true });
  try {
    execFileSync("cp", ["-cR", parent, destination], { stdio: ["ignore", "ignore", "pipe"] });
  } catch {
    rmSync(destination, { recursive: true, force: true });
    execFileSync("cp", ["-R", parent, destination], { stdio: ["ignore", "ignore", "pipe"] });
  }
}

/**
 * The oracle file on disk only while a judge runs, outside every workspace, and removed after.
 * The reach-pressure driver left it in place for the whole run; an interpreter the tool policy
 * allows could have read it had it known the path.
 */
async function withStoredOracle(lib, { workingRoot, checkout, task }, body) {
  const stored = join(workingRoot, "oracles", `${lib.taskSlug(task)}.test-file`);
  mkdirSync(dirname(stored), { recursive: true });
  const bytes = execFileSync("git", ["show", `${task.mergeCommit}:${task.testFile}`], {
    cwd: checkout,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (lib.digestOfBytes(bytes) !== task.oracleFileDigest) {
    throw new Error(`${task.id}: the oracle file no longer matches the frozen digest`);
  }
  writeFileSync(stored, bytes);
  try {
    return await body(stored);
  } finally {
    rmSync(stored, { force: true });
  }
}

function heldBackIsAvailable(lib, checkout, task) {
  try {
    const bytes = execFileSync("git", ["show", `${task.mergeCommit}:${task.testFile}`], {
      cwd: checkout,
      maxBuffer: 64 * 1024 * 1024,
    });
    return task.heldBackCases.length > 0 && lib.digestOfBytes(bytes) === task.oracleFileDigest;
  } catch {
    return false;
  }
}

const judgedTaskOf = (task) => ({ ...task, sealedCases: task.visibleCases });

function effectsFor({
  lib,
  task,
  parameters,
  entry,
  workspace,
  workingRoot,
  corpusRoot,
  scriptedAgent,
}) {
  const checkout = lib.taskCheckout(corpusRoot, task);
  const patchRoot = join(workingRoot, "patches");
  const sessionRoot = join(workingRoot, "sessions");
  const homesRoot = join(workingRoot, "homes");
  for (const directory of [patchRoot, sessionRoot, homesRoot])
    mkdirSync(directory, { recursive: true });
  const patchPathOf = (digest) => join(patchRoot, `${digest.slice(7)}.patch`);
  // Every place the held-back half or another invocation lives, which no session should name.
  const forbiddenRoots = [
    lib.prTaskWorkingRoot(homedir()),
    "~/.cache/swarm-pr-tasks",
    join(tmpdir(), "swarm-child-home"),
    ...(corpusRootOf(lib) === lib.prTaskWorkingRoot(homedir()) ? [] : [corpusRootOf(lib)]),
  ];
  return {
    now: () => Date.now(),
    realAgent: scriptedAgent === null,
    endpointGenerates: () =>
      scriptedAgent === null
        ? lib.endpointGenerates(entry.endpoint, entry.served)
        : Promise.resolve({ generates: true, failure: null, detail: "" }),
    invokeAgent: async (prompt) => {
      const started = Date.now();
      const home = mkdtempSync(join(homesRoot, "inv-"));
      const agentArgv =
        scriptedAgent !== null
          ? [process.execPath, resolve(repositoryRoot, scriptedAgent), workspace, prompt]
          : [
              process.execPath,
              join(repositoryRoot, "dist/cli.js"),
              "--model",
              entry.id,
              "--local-endpoint",
              entry.endpoint,
              "--no-tui",
              "--json",
              "--workspace",
              workspace,
              "--base",
              task.baseCommit,
              "--max-tokens",
              String(parameters.agent.maxTokens),
              "--max-wall-minutes",
              String(parameters.agent.maxWallMinutes),
              prompt,
            ];
      const agent = await lib.runCommand(agentArgv[0], agentArgv.slice(1), {
        cwd: workspace,
        timeoutMs: (parameters.agent.maxWallMinutes + 4) * 60_000,
        homeDir: home,
      });
      // A scripted stand-in calls no model and leaves no session to read.
      if (scriptedAgent !== null) rmSync(home, { recursive: true, force: true });
      const session =
        scriptedAgent === null
          ? await lib.takeAgentSession({
              stdout: agent.stdout,
              home,
              keptRoot: sessionRoot,
              forbiddenRoots,
              ownWorkspace: workspace,
            })
          : {
              runId: null,
              ledgerDigest: null,
              ledgerRecords: null,
              fileSet: null,
              usage: {
                modelCalls: null,
                failedCalls: null,
                inputTokens: null,
                outputTokens: null,
                status: "unknown",
              },
              stopReason: null,
              blinding: { checked: false, references: [] },
            };
      return {
        exitCode: agent.code,
        wallMs: Date.now() - started,
        timedOut: agent.timedOut,
        ...session,
      };
    },
    snapshot: async () => snapshotOf(lib, { workspace, task, patchPathOf }),
    judgeVisible: async (patch) =>
      withStoredOracle(lib, { workingRoot, checkout, task }, async (storedTestFile) => {
        // A judge per patch, so the repository's own checks run for every patch judged.
        const judge = await lib.halfJudgeFor({
          task: judgedTaskOf(task),
          checkout,
          patchPath: patchPathOf(patch.digest),
          storedTestFile,
          cliPath: join(repositoryRoot, "dist/cli.js"),
          isolation: parameters.agent.isolation,
        });
        return judge(task.visibleCases);
      }),
  };
}

async function snapshotOf(lib, { workspace, task, patchPathOf }) {
  await lib.runCommand("git", ["add", "-A"], { cwd: workspace });
  const diff = await lib.runCommand("git", ["diff", "--cached", task.baseCommit], {
    cwd: workspace,
  });
  if (diff.code !== 0) throw new Error(`the workspace diff could not be read: ${diff.stderr}`);
  const digest = lib.digestOfBytes(diff.stdout);
  if (!existsSync(patchPathOf(digest))) writeFileSync(patchPathOf(digest), diff.stdout);
  return {
    digest,
    metrics: lib.patchMetrics(diff.stdout),
    files: lib.patchFiles(diff.stdout),
    lineText: (path, line) => lib.addedLineText(diff.stdout, path, line),
  };
}

/** Everything the workspace holds that its diff does, as git names a tree. */
async function treeDigestOf(lib, workspace) {
  await lib.runCommand("git", ["add", "-A"], { cwd: workspace });
  const written = await lib.runCommand("git", ["write-tree"], { cwd: workspace });
  if (written.code !== 0) throw new Error(`git write-tree failed: ${written.stderr}`);
  return written.stdout.trim();
}

function textOf(lib, manifest) {
  const source = JSON.parse(readFileSync(resolve(repositoryRoot, manifest.source.path), "utf8"));
  const byId = new Map(source.tasks.map((one) => [`${one.repository}#${one.pull}`, one.taskText]));
  return (task) => {
    const text = byId.get(task.id);
    if (text === undefined || lib.digestOfBytes(text) !== task.taskTextDigest) {
      throw new Error(`${task.id}: the task text no longer matches the frozen digest`);
    }
    return text;
  };
}

function unjudgeablePrefix(lib, detail) {
  return {
    status: "unjudgeable",
    detail,
    steps: [],
    frozen: null,
    finalPatchDigest: lib.emptyPatchDigest,
    eligibility: {
      eligible: false,
      reason: `unjudgeable: ${detail}`,
      arms: [],
      dualTrigger: false,
    },
  };
}

function infrastructurePrefix(lib, detail) {
  return {
    ...unjudgeablePrefix(lib, detail),
    status: "infrastructure-failure",
    eligibility: {
      eligible: false,
      reason: "the prefix ended on an infrastructure failure",
      arms: [],
      dualTrigger: false,
    },
  };
}

function infrastructureArm(arm, forkPatchDigest, detail) {
  return {
    arm,
    status: "infrastructure-failure",
    detail,
    forkPatchDigest,
    steps: [],
    final: null,
    repairs: 0,
    outcome: null,
    perKind: { reach: null, mutation: null },
  };
}

async function prefixUnit({
  lib,
  task,
  taskText,
  parameters,
  entry,
  workingRoot,
  corpusRoot,
  attempt,
  scriptedAgent,
}) {
  const pairRoot = join(
    workingRoot,
    "runs",
    modelSlug(entry.id),
    `${lib.taskSlug(task)}-p${attempt}`,
  );
  const workspace = join(pairRoot, "prefix");
  const checkout = lib.taskCheckout(corpusRoot, task);
  try {
    rmSync(pairRoot, { recursive: true, force: true });
    mkdirSync(pairRoot, { recursive: true });
    await lib.prepareSealedWorkspace({
      checkout,
      workspace,
      baseCommit: task.baseCommit,
      mergeCommit: task.mergeCommit,
      testFile: task.testFile,
      untrackedFiles: {
        "swarm.toml": `[providers]\nlocal_endpoint = "${entry.endpoint}"\nlocal_thinking = ${entry.thinking}\n`,
      },
    });
  } catch (cause) {
    return unjudgeablePrefix(
      lib,
      `the workspace could not be prepared: ${cause?.message ?? cause}`,
    );
  }
  const installed = await lib.runCommand(
    "npm",
    ["ci", "--no-audit", "--no-fund", "--loglevel=error"],
    {
      cwd: workspace,
      timeoutMs: 15 * 60_000,
    },
  );
  if (installed.code !== 0) return unjudgeablePrefix(lib, "npm ci failed in the workspace");
  const effects = effectsFor({
    lib,
    task,
    parameters,
    entry,
    workspace,
    workingRoot,
    corpusRoot,
    scriptedAgent,
  });
  try {
    return await lib.runPrefix({
      task: { id: task.id, taskText },
      prefixInvocations: parameters.limits.prefixInvocations,
      effects,
      heldBackAvailable: heldBackIsAvailable(lib, checkout, task),
      treeDigest: () => treeDigestOf(lib, workspace),
      order: (arms) => lib.armOrder(entry.id, task.id, arms),
    });
  } catch (cause) {
    return unjudgeablePrefix(lib, `the prefix could not be completed: ${cause?.message ?? cause}`);
  }
}

async function armUnit({
  lib,
  task,
  taskText,
  parameters,
  entry,
  workingRoot,
  corpusRoot,
  attempt,
  arm,
  prefixRow,
  scriptedAgent,
}) {
  const pairRoot = join(
    workingRoot,
    "runs",
    modelSlug(entry.id),
    `${lib.taskSlug(task)}-p${prefixRow.attempt}`,
  );
  const frozen = prefixRow.prefix.frozen;
  const forkStep = prefixRow.prefix.steps[frozen.step];
  const workspace = join(pairRoot, `${arm}-a${attempt}`);
  const fork = { patchDigest: frozen.patchDigest, treeDigest: frozen.treeDigest, verified: null };
  cloneWorkspace(join(pairRoot, "prefix"), workspace);
  const patchPathOf = (digest) => join(workingRoot, "patches", `${digest.slice(7)}.patch`);
  const verified = {
    patchDigest: (await snapshotOf(lib, { workspace, task, patchPathOf })).digest,
    treeDigest: await treeDigestOf(lib, workspace),
  };
  if (verified.patchDigest !== frozen.patchDigest || verified.treeDigest !== frozen.treeDigest) {
    return {
      fork: { ...fork, verified },
      record: infrastructureArm(
        arm,
        frozen.patchDigest,
        "the arm's workspace does not hold the frozen prefix",
      ),
    };
  }
  const effects = effectsFor({
    lib,
    task,
    parameters,
    entry,
    workspace,
    workingRoot,
    corpusRoot,
    scriptedAgent,
  });
  try {
    const record = await lib.runArm({
      task: { id: task.id, taskText },
      arm,
      policy: parameters.policy,
      repairInvocations: parameters.limits.repairInvocations,
      fork: {
        patchDigest: frozen.patchDigest,
        files: forkStep.patch.files,
        observation: lib.observationOf(forkStep),
        signals: forkStep.signals,
      },
      effects,
    });
    return { fork: { ...fork, verified }, record };
  } catch (cause) {
    return {
      fork: { ...fork, verified },
      record: {
        ...infrastructureArm(
          arm,
          frozen.patchDigest,
          `the arm could not be completed: ${cause?.message ?? cause}`,
        ),
        status: "unjudgeable",
      },
    };
  }
}

function parsedRows(lib) {
  const raw = readJsonLines(paths.results);
  return {
    raw,
    launches: raw
      .filter((row) => row.schema === "swarm.feedback-study.launch.v1")
      .map((row) => lib.launchRowSchema.parse(row)),
    prefixes: raw
      .filter((row) => row.schema === "swarm.feedback-study.prefix.v1")
      .map((row) => lib.prefixRowSchema.parse(row)),
    arms: raw
      .filter((row) => row.schema === "swarm.feedback-study.arm.v1")
      .map((row) => lib.armRowSchema.parse(row)),
  };
}

async function run() {
  await underTheLock(async (lib) => {
    const { identity, manifest, parameters, panel, policy } = studyIdentity(lib, {
      bindToCommit: !synthetic,
    });
    const entry = parameters.panel.find((one) => one.id === flag("--model", null));
    if (entry === undefined) {
      throw new Error(
        `--model names none of the registered models: ${parameters.panel.map((one) => one.id).join(", ")}`,
      );
    }
    const model = { id: entry.id, digest: entry.digest };
    // Before a task is spent: every row already here belongs to this identity or nothing runs.
    lib.assertOneStudyAcquisition(identity, panel, readJsonLines(paths.results));
    if (!synthetic) {
      execFileSync(process.execPath, [join(repositoryRoot, "scripts/check-repo-weight.mjs")], {
        cwd: repositoryRoot,
        stdio: ["ignore", "ignore", "inherit"],
      });
    }
    const scriptedAgent = flag("--agent-command", null);
    if (scriptedAgent !== null && !synthetic)
      throw new Error("a scripted agent runs only against a synthetic cohort");
    if (scriptedAgent === null) {
      const health = await lib.endpointGenerates(entry.endpoint, entry.served);
      if (!health.generates) {
        throw new Error(
          `the model endpoint is not generating (${health.failure}), so nothing was run: ${health.detail}`,
        );
      }
      const served = await (await fetch(`${entry.endpoint}/models`)).json();
      recordEnvironment(
        entry,
        (served.data ?? served.models ?? []).map((one) => one.id ?? one.name).sort(),
      );
    }
    const workingRoot = workingRootOf(lib, parameters);
    const corpusRoot = corpusRootOf(lib);
    const taskTextOf = textOf(lib, manifest);
    const limit = Number(flag("--limit", "100000"));
    const append = (row) => appendFileSync(paths.results, `${lib.canonicalJson(row)}\n`);
    const stamp = { ...identity, model };
    let dispatched = 0;

    for (const task of manifest.tasks) {
      for (;;) {
        const rows = parsedRows(lib);
        const schedules = lib.unitSchedules({
          model: model.id,
          taskId: task.id,
          launches: rows.launches,
          prefixes: rows.prefixes,
          arms: rows.arms,
          attemptsPerUnit: parameters.limits.attemptsPerUnit,
        });
        const dangling = schedules.find((one) => one.closeDangling !== null);
        if (dangling !== undefined) {
          // A launch with no result is a driver that stopped mid-unit: kept as the infrastructure
          // failure it was, and the unit scheduled again under the same protocol.
          const detail =
            "the driver stopped before this attempt settled, so nothing it did was kept";
          const base = {
            ...stamp,
            taskId: task.id,
            attempt: dangling.closeDangling.attempt,
            startedAt: dangling.closeDangling.startedAt,
            wallMs: 0,
          };
          if (dangling.unit === "prefix") {
            append({
              ...base,
              schema: "swarm.feedback-study.prefix.v1",
              prefix: infrastructurePrefix(lib, detail),
            });
          } else {
            const parent = rows.prefixes.find(
              (row) =>
                row.model.id === model.id &&
                row.taskId === task.id &&
                row.attempt === dangling.prefixAttempt,
            );
            append({
              ...base,
              schema: "swarm.feedback-study.arm.v1",
              arm: dangling.unit,
              treatmentDigest: lib.treatmentDigest(policy.id, dangling.unit),
              prefixAttempt: dangling.prefixAttempt,
              fork: {
                patchDigest: parent.prefix.frozen.patchDigest,
                treeDigest: parent.prefix.frozen.treeDigest,
                verified: null,
              },
              record: infrastructureArm(dangling.unit, parent.prefix.frozen.patchDigest, detail),
            });
          }
          continue;
        }
        const next = schedules.find((one) => one.action === "dispatch");
        if (next === undefined) break;
        if (dispatched >= limit) {
          console.log(`stopping at --limit ${limit}`);
          return;
        }
        dispatched += 1;
        const startedAt = new Date().toISOString();
        const started = Date.now();
        append({
          ...stamp,
          schema: "swarm.feedback-study.launch.v1",
          taskId: task.id,
          unit: next.unit,
          attempt: next.attempt,
          prefixAttempt: next.prefixAttempt,
          startedAt,
        });
        const shared = {
          lib,
          task,
          taskText: taskTextOf(task),
          parameters,
          entry,
          workingRoot,
          corpusRoot,
          attempt: next.attempt,
          scriptedAgent,
        };
        let status;
        if (next.unit === "prefix") {
          const prefix = await prefixUnit(shared);
          append({
            ...stamp,
            schema: "swarm.feedback-study.prefix.v1",
            taskId: task.id,
            attempt: next.attempt,
            startedAt,
            wallMs: Date.now() - started,
            prefix,
          });
          status = prefix.status;
          console.log(
            `  ${model.id} ${task.id.padEnd(44)} prefix ${prefix.status}${prefix.eligibility.eligible ? ` -> ${prefix.eligibility.arms.join(", ")}` : ` (${prefix.eligibility.reason ?? prefix.detail ?? ""})`}`,
          );
        } else {
          const prefixRow = rows.prefixes.find(
            (row) =>
              row.model.id === model.id &&
              row.taskId === task.id &&
              row.attempt === next.prefixAttempt,
          );
          const outcome = await armUnit({ ...shared, arm: next.unit, prefixRow });
          append({
            ...stamp,
            schema: "swarm.feedback-study.arm.v1",
            taskId: task.id,
            arm: next.unit,
            treatmentDigest: lib.treatmentDigest(policy.id, next.unit),
            attempt: next.attempt,
            prefixAttempt: next.prefixAttempt,
            fork: outcome.fork,
            startedAt,
            wallMs: Date.now() - started,
            record: outcome.record,
          });
          status = outcome.record.status;
          console.log(
            `  ${model.id} ${task.id.padEnd(44)} ${next.unit.padEnd(8)} ${outcome.record.status} (${outcome.record.repairs} repair(s))`,
          );
        }
        if (status === "infrastructure-failure") {
          console.log(
            "stopping: every unit after an infrastructure failure would record the same thing.",
          );
          process.exitCode = 1;
          return;
        }
      }
    }
    const rows = parsedRows(lib);
    const open = lib.unsettledUnits({
      panel: [model],
      taskIds: manifest.tasks.map((task) => task.id),
      launches: rows.launches,
      prefixes: rows.prefixes,
      arms: rows.arms,
      attemptsPerUnit: parameters.limits.attemptsPerUnit,
    });
    console.log(`${model.id}: ${open.length} unit(s) still open`);
  });
}

// ---------------------------------------------------------------------------------------------
// score

async function score() {
  await underTheLock(async (lib) => {
    const { identity, manifest, parameters, panel } = studyIdentity(lib, {
      bindToCommit: !synthetic,
    });
    lib.assertOneStudyAcquisition(identity, panel, [
      ...readJsonLines(paths.results),
      ...readJsonLines(paths.hiddenScores),
    ]);
    const rows = parsedRows(lib);
    const open = lib.unsettledUnits({
      panel,
      taskIds: manifest.tasks.map((task) => task.id),
      launches: rows.launches,
      prefixes: rows.prefixes,
      arms: rows.arms,
      attemptsPerUnit: parameters.limits.attemptsPerUnit,
    });
    if (open.length > 0) {
      throw new Error(
        `held-back scoring starts only once every unit of every model has settled, and ${open.length} have not: ${open.slice(0, 5).join("; ")}`,
      );
    }
    const workingRoot = workingRootOf(lib, parameters);
    const corpusRoot = corpusRootOf(lib);
    const scored = new Set(
      readJsonLines(paths.hiddenScores).map(
        (row) => `${row.model.id}|${row.taskId}|${row.patchDigest}`,
      ),
    );
    for (const model of panel) {
      for (const task of manifest.tasks) {
        const prefix = lib.settledPrefix(rows.prefixes, model.id, task.id);
        if (prefix === null) continue;
        const pairSteps = [
          ...prefix.prefix.steps,
          ...rows.arms
            .filter(
              (row) =>
                row.model.id === model.id &&
                row.taskId === task.id &&
                row.prefixAttempt === prefix.attempt,
            )
            .flatMap((row) => row.record.steps),
        ];
        for (const patchDigest of lib.studyPatchesToScore(prefix, rows.arms)) {
          if (scored.has(`${model.id}|${task.id}|${patchDigest}`)) continue;
          const started = Date.now();
          const step = pairSteps.findLast((one) => one.patch.digest === patchDigest);
          const visibleTask =
            step?.observation.kind === "judged" ? step.observation.verdict.task : "unjudged";
          const settled =
            patchDigest === lib.emptyPatchDigest
              ? lib.scoreOfAnEmptyPatch()
              : await withStoredOracle(
                  lib,
                  { workingRoot, checkout: lib.taskCheckout(corpusRoot, task), task },
                  async (storedTestFile) => {
                    const judge = await lib.halfJudgeFor({
                      task: judgedTaskOf(task),
                      checkout: lib.taskCheckout(corpusRoot, task),
                      patchPath: join(workingRoot, "patches", `${patchDigest.slice(7)}.patch`),
                      storedTestFile,
                      cliPath: join(repositoryRoot, "dist/cli.js"),
                      isolation: parameters.agent.isolation,
                    });
                    return lib.scoreHeldBack(judge, judgedTaskOf(task), visibleTask);
                  },
                );
          const row = lib.hiddenScoreRowSchema.parse({
            ...identity,
            model,
            schema: "swarm.feedback-study.hidden-score.v1",
            taskId: task.id,
            patchDigest,
            hidden: settled.hidden,
            basis: settled.basis,
            heldBackVerdict: settled.heldBackVerdict,
            orderDependent: settled.orderDependent,
            heldBackBond: settled.heldBackBond,
            judgeWallMs: Date.now() - started,
          });
          appendFileSync(paths.hiddenScores, `${lib.canonicalJson(row)}\n`);
          console.log(
            `  ${model.id} ${task.id.padEnd(44)} ${patchDigest.slice(7, 19)} ${row.hidden}`,
          );
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------------------------
// analyze

/**
 * Every patch the rows name, committed once as a content-addressed archive in the format
 * `scripts/local-campaign/archive.mjs` unpacks: each file is named by the SHA-256 of its bytes, so
 * the name is the check. Written only where none is committed yet, and read back and compared
 * before anything relies on it.
 */
function packPatches(lib, rows, workingRoot) {
  const digests = new Set();
  for (const row of rows.prefixes)
    for (const step of row.prefix.steps) digests.add(step.patch.digest);
  for (const row of rows.arms) for (const step of row.record.steps) digests.add(step.patch.digest);
  const files = {};
  for (const digest of [...digests].sort()) {
    const source = join(workingRoot, "patches", `${digest.slice(7)}.patch`);
    if (!existsSync(source))
      throw new Error(`patch ${digest} is named by a row and is not in ${dirname(source)}`);
    const text = readFileSync(source, "utf8");
    if (lib.digestOfBytes(text) !== digest)
      throw new Error(`patch ${digest} does not digest to its name`);
    files[`${digest.slice(7)}.patch`] = text;
  }
  const expanded = Buffer.from(JSON.stringify(files), "utf8");
  const compressed = brotliCompressSync(expanded, {
    params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      [zlibConstants.BROTLI_PARAM_SIZE_HINT]: expanded.length,
    },
  });
  mkdirSync(paths.patches, { recursive: true });
  writeFileSync(join(paths.patches, "archive.json.br"), compressed);
  writeFileSync(
    join(paths.patches, "archive-manifest.json"),
    `${JSON.stringify({ version: 1, format: "utf8-file-map-brotli", digest: lib.digestOfBytes(compressed), bytes: compressed.length, expandedBytes: expanded.length, files: Object.keys(files).length }, null, 2)}\n`,
  );
  return Object.keys(files).length;
}

async function analyze() {
  requireFreshDist();
  const lib = await modules();
  const { identity, manifest, parameters, panel, components } = studyIdentity(lib, {
    bindToCommit: false,
    enforceAcquisition: false,
  });
  const raw = [...readJsonLines(paths.results), ...readJsonLines(paths.hiddenScores)];
  // The rows name the commit and sources they were written by; a later checkout may derive them.
  const written = readJsonLines(paths.results);
  const harnesses = [...new Set(written.map((row) => row.harness))];
  const acquisitions = [...new Set(written.map((row) => row.acquisitionDigest))];
  if (harnesses.length > 1 || acquisitions.length > 1) {
    throw new lib.MixedStudyIdentities([...harnesses, ...acquisitions]);
  }
  const bound = {
    ...identity,
    harness: harnesses[0] ?? identity.harness,
    acquisitionDigest: acquisitions[0] ?? parameters.identities.acquisition,
  };
  if (bound.acquisitionDigest !== parameters.identities.acquisition) {
    throw new Error("the rows were written by an acquisition the protocol did not register");
  }
  lib.assertOneStudyAcquisition(bound, panel, raw);
  const rows = parsedRows(lib);
  const hiddenScores = readJsonLines(paths.hiddenScores).map((row) =>
    lib.hiddenScoreRowSchema.parse(row),
  );
  const derived = lib.summarizeStudy({
    manifest,
    identity: bound,
    panel,
    launches: rows.launches,
    prefixes: rows.prefixes,
    arms: rows.arms,
    hiddenScores,
    options: { bootstrap: parameters.analysis.bootstrap },
  });
  const summaryText = `${JSON.stringify(derived.summary, null, 2)}\n`;
  const classificationsText = `${JSON.stringify(derived.classifications, null, 2)}\n`;
  const requestedOut = flag("--out", null);
  const destination = requestedOut === null ? evidenceRoot : resolve(repositoryRoot, requestedOut);
  const inPlace = destination === evidenceRoot;
  const derivation = {
    schema: "swarm.feedback-study.derivation.v1",
    acquisition: bound,
    registered: {
      analysis: parameters.identities.analysis,
      renderer: parameters.identities.renderer,
    },
    derivedWith: {
      analysis: components.analysis,
      renderer: components.renderer,
      matchesRegistered:
        components.analysis === parameters.identities.analysis &&
        components.renderer === parameters.identities.renderer,
      harness: git(["rev-parse", "HEAD"]),
      uncommittedSourceEdits: sourceIdentity().includes("uncommitted"),
    },
    observations: {
      results: lib.digestOfBytes(readFileSync(paths.results, "utf8")),
      hiddenScores: existsSync(paths.hiddenScores)
        ? lib.digestOfBytes(readFileSync(paths.hiddenScores, "utf8"))
        : null,
    },
    summaryDigest: lib.digestOfBytes(summaryText),
    classificationsDigest: lib.digestOfBytes(classificationsText),
    againstPublished: existsSync(paths.summary)
      ? lib.jsonDifference(JSON.parse(readFileSync(paths.summary, "utf8")), derived.summary)
      : null,
  };
  const report = lib.renderStudyReport({
    summary: derived.summary,
    parameters,
    environment: existsSync(paths.environment)
      ? JSON.parse(readFileSync(paths.environment, "utf8"))
      : null,
    postscript: existsSync(paths.postscript) ? readFileSync(paths.postscript, "utf8") : null,
    derivation: { ...derivation, inPlace },
  });
  // A published summary, classification or page is never overwritten by different bytes.
  if (inPlace) {
    for (const [path, text] of [
      [paths.summary, summaryText],
      [paths.classifications, classificationsText],
      [paths.report, report],
    ]) {
      if (existsSync(path) && readFileSync(path, "utf8") !== text) {
        throw new Error(
          `${relative(repositoryRoot, path)} is published and this checkout derives different bytes; write beside it with --out <directory>`,
        );
      }
    }
  }
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, "summary.json"), summaryText);
  writeFileSync(join(destination, "classifications.json"), classificationsText);
  writeFileSync(join(destination, "report.md"), report);
  if (!inPlace || !existsSync(paths.derivation)) {
    writeFileSync(join(destination, "derivation.json"), `${JSON.stringify(derivation, null, 2)}\n`);
  }
  if (inPlace && !existsSync(join(paths.patches, "archive-manifest.json"))) {
    console.log(
      `packed ${packPatches(lib, rows, workingRootOf(lib, parameters))} patch(es) into ${relative(repositoryRoot, paths.patches)}`,
    );
  }
  console.log(`summary digest         ${lib.digestOfBytes(summaryText)}`);
  console.log(`classifications digest ${lib.digestOfBytes(classificationsText)}`);
  console.log(`report digest          ${lib.digestOfBytes(report)}`);
}

async function main() {
  if (command === "build") return underTheLock(async () => console.log("dist built"));
  if (command === "freeze") return freeze();
  if (command === "identities") return identities();
  if (command === "run") return run();
  if (command === "score") return score();
  if (command === "analyze") return analyze();
  throw new Error(
    "usage: feedback-study.mjs build | freeze | identities | run --model <id> | score | analyze [--out <dir>] [--synthetic]",
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((cause) => {
    console.error(cause?.stack ?? cause?.message ?? cause);
    process.exit(1);
  });
}
