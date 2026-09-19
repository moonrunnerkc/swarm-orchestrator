#!/usr/bin/env node
/**
 * Does enforcing changed-line reach after visible acceptance change what a held-back oracle says?
 *
 * One trajectory per mined task runs until the visible half of its oracle first accepts. That
 * patch is the control outcome. The reach condition forks from that exact workspace: where reach
 * already holds the pair is one patch, and where it does not the agent is told which added lines
 * went unexecuted and may repair. The held-back half scores both patches afterwards, in a phase
 * that starts only once every trajectory has settled, so no held-back verdict exists while an
 * agent is still running.
 *
 *   node scripts/reach-pressure-experiment.mjs build      # dist, under the campaign lock
 *   node scripts/reach-pressure-experiment.mjs freeze     # the cohort, from the viability record
 *   node scripts/reach-pressure-experiment.mjs run        # trajectories; resumable
 *   node scripts/reach-pressure-experiment.mjs score      # held-back verdicts; resumable
 *   node scripts/reach-pressure-experiment.mjs analyze    # summary and report, no model, no judge
 *
 * `--synthetic --evidence <dir>` runs the same phases over the cohort that
 * scripts/reach-pressure/synthetic-cohort.mjs builds, which is how the plumbing is exercised
 * without looking at a held-back verdict from the cohort the estimate is made over.
 *
 * The protocol document beside the evidence carries the frozen parameters as a JSON block, and
 * every row carries that document's digest. Rows under two protocol identities never make one
 * estimate: `run` and `score` refuse to write beside rows of another identity, and `analyze`
 * refuses to read them.
 *
 * `analyze` never overwrites a published summary with different bytes. Where a later checkout
 * derives something else it writes to `--out <directory>`, beside a `derivation.json` that names
 * the acquisition identity, the identities it was derived with and every value that moved.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, cpus, homedir, platform, release, totalmem } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const argv = process.argv.slice(3);
const command = process.argv[2];
const flag = (name, fallback) => {
  const at = argv.indexOf(name);
  return at === -1 ? fallback : argv[at + 1];
};

/**
 * The ten sources generation 3's protocol registered as one driver digest. Frozen as a list: it is
 * the formula that protocol's `driverDigest` was computed by, and changing it would make every
 * checkout disagree with the registration for a reason that is not a change to the experiment.
 * A protocol of schema v2 registers the component identities in `identitySources` instead.
 */
const driverSources = [
  "scripts/reach-pressure-experiment.mjs",
  "scripts/reach-pressure/scripted-agent.mjs",
  "src/eval/oracle-filter.ts",
  "src/eval/patch-metrics.ts",
  "src/eval/pr-task-judge.ts",
  "src/eval/reach-pressure-analysis.ts",
  "src/eval/reach-pressure.ts",
  "src/eval/sealed-workspace.ts",
  "src/eval/statistics.ts",
  "src/gates/certification.ts",
];

const git = (args, cwd = repositoryRoot) =>
  execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim();

/**
 * dist is what the agent and the verifier run from, so it is built from the commit the rows name.
 * Built under the campaign lock and never by `analyze`: a rebuild replaces the files a running
 * campaign's children are started from.
 */
function buildDist() {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-dist.mjs")], {
    cwd: repositoryRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
  writeFileSync(join(repositoryRoot, "dist/.built-from"), `${sourceIdentity()}\n`);
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
      `dist was built from "${built}" and the sources are "${sourceIdentity()}". ` +
        "Run this script's `build`, which builds under the campaign lock.",
    );
  }
}

async function modules() {
  const from = (path) => import(join(repositoryRoot, "dist", path));
  return {
    ...(await from("evidence/canonical-json.js")),
    ...(await from("eval/pr-task-judge.js")),
    ...(await from("eval/pr-task-paths.js")),
    ...(await from("eval/patch-metrics.js")),
    ...(await from("eval/reach-pressure.js")),
    ...(await from("eval/reach-pressure-analysis.js")),
    ...(await from("eval/reach-pressure-derivation.js")),
    ...(await from("eval/reach-pressure-report.js")),
    ...(await from("eval/endpoint-health.js")),
    ...(await from("eval/sealed-workspace.js")),
    ...(await from("eval/task-identity.js")),
    ...(await from("durable/session-evidence.js")),
    ...(await from("exec/child-environment.js")),
  };
}

const evidenceRoot = resolve(
  repositoryRoot,
  flag("--evidence", "docs/evidence/2026-09-17/reach-pressure-experiment"),
);
const paths = {
  protocol: join(evidenceRoot, "protocol.md"),
  manifest: join(evidenceRoot, "manifest.json"),
  results: join(evidenceRoot, "results.jsonl"),
  hiddenScores: join(evidenceRoot, "hidden-scores.jsonl"),
  environment: join(evidenceRoot, "environment.json"),
  summary: join(evidenceRoot, "summary.json"),
  report: join(evidenceRoot, "report.md"),
  pairNotes: join(evidenceRoot, "pair-notes.json"),
  postscript: join(evidenceRoot, "postscript.md"),
  patches: join(evidenceRoot, "patches"),
};

/** The frozen parameters: the first JSON block of the protocol document, and nothing else. */
function readProtocol(lib) {
  const text = readFileSync(paths.protocol, "utf8");
  const block = /```json\n([\s\S]*?)\n```/.exec(text);
  if (block === null)
    throw new Error(`${paths.protocol} carries no JSON block of frozen parameters`);
  return { parameters: JSON.parse(block[1]), digest: lib.digestOfBytes(text) };
}

function driverDigestOf(lib) {
  return lib.digestOfJson(
    Object.fromEntries(
      driverSources.map((path) => [
        path,
        lib.digestOfBytes(readFileSync(join(repositoryRoot, path), "utf8")),
      ]),
    ),
  );
}

/** One digest per identity component, over the sources `identitySources` names for it. */
function componentDigestsOf(lib) {
  return Object.fromEntries(
    Object.entries(lib.identitySources).map(([component, sources]) => [
      component,
      lib.digestOfJson(
        Object.fromEntries(
          sources.map((path) => [
            path,
            lib.digestOfBytes(readFileSync(join(repositoryRoot, path), "utf8")),
          ]),
        ),
      ),
    ]),
  );
}

const usesComponentIdentities = (parameters) =>
  parameters.schema === "swarm.reach-pressure.protocol.v2";

function readJsonLines(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

/**
 * Everything a row is stamped with, checked against what the protocol froze before anything runs.
 * A driver edited after the protocol was committed is a different experiment, and says so here
 * instead of in the analysis of rows it already wrote.
 */
function experimentIdentity(lib, { bindToCommit, enforceDriver = true }) {
  const protocol = readProtocol(lib);
  const manifestText = readFileSync(paths.manifest, "utf8");
  const manifest = lib.manifestSchema.parse(JSON.parse(manifestText));
  const components = componentDigestsOf(lib);
  const policy = lib.experimentPolicyNamed(protocol.parameters.policy);
  const identity = {
    generation: protocol.parameters.generation,
    protocolDigest: protocol.digest,
    manifestDigest: lib.digestOfJson(JSON.parse(manifestText)),
    // What stamps a row is what wrote it: under a v2 protocol the acquisition identity, under
    // generation 3's the ten-source digest it registered.
    driverDigest: usesComponentIdentities(protocol.parameters)
      ? components.acquisition
      : driverDigestOf(lib),
    policyDigest: policy.digest,
    harness: git(["rev-parse", "HEAD"]),
  };
  if (protocol.parameters.cohort !== manifest.cohort) {
    throw new Error(
      `the protocol names cohort ${protocol.parameters.cohort} and the manifest is ${manifest.cohort}`,
    );
  }
  // The relaxations `--synthetic` buys, a scripted agent and an uncommitted tree, exist for the
  // synthetic cohort and are refused for any other.
  if (argv.includes("--synthetic") !== manifest.cohort.startsWith("synthetic-")) {
    throw new Error(
      `--synthetic is for a synthetic cohort and only for one; this is ${manifest.cohort}`,
    );
  }
  for (const key of ["manifestDigest", "driverDigest", "policyDigest"]) {
    if (key === "driverDigest" && !enforceDriver) continue;
    if (protocol.parameters[key] !== identity[key]) {
      throw new Error(
        `the protocol froze ${key} ${protocol.parameters[key]} and this checkout has ${identity[key]}`,
      );
    }
  }
  // Scoring decides a held-back pass or fail, so it is held to the registration wherever the
  // driver is. Analysis and rendering are not: they may be corrected later, and say so.
  if (
    enforceDriver &&
    usesComponentIdentities(protocol.parameters) &&
    protocol.parameters.identities?.scoring !== components.scoring
  ) {
    throw new Error(
      `the protocol froze the scoring identity ${protocol.parameters.identities?.scoring} and this checkout has ${components.scoring}`,
    );
  }
  if (bindToCommit) {
    // Untrimmed: the first column of a porcelain line is a status letter or a space.
    const outside = execFileSync("git", ["status", "--porcelain"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line.length > 0)
      .filter((line) => !resolve(repositoryRoot, line.slice(3)).startsWith(`${evidenceRoot}/`));
    if (outside.length > 0) {
      throw new Error(
        `the confirmatory run binds its rows to a commit, and the tree is not that commit:\n${outside.join("\n")}`,
      );
    }
    if (git(["ls-files", "--", relative(repositoryRoot, paths.protocol)]).length === 0) {
      throw new Error(
        "the protocol is not committed, and it has to be before any cohort task runs",
      );
    }
  }
  return { identity, manifest, parameters: protocol.parameters, components, policy };
}

function workingRootOf(lib, parameters, synthetic) {
  const root = flag("--working-root", null);
  if (root !== null) return resolve(root);
  return join(
    lib.prTaskWorkingRoot(homedir()),
    synthetic ? "reach-pressure-preflight" : "reach-pressure",
    `g${parameters.generation}`,
  );
}

/**
 * One driver at a time, and the build happens inside the lock before anything is imported from
 * it. A second driver rebuilding dist would replace the files the first one's children start from.
 */
async function underTheCampaignLock(body) {
  const lock = join(repositoryRoot, ".swarm", "reach-pressure.lock");
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
    buildDist();
    return await body(await modules());
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Where the task checkouts live: the mined corpus's own working root unless told otherwise. */
function corpusRootOf(lib) {
  const root = flag("--corpus-root", null);
  return root === null ? lib.prTaskWorkingRoot(homedir()) : resolve(root);
}

async function freeze() {
  requireFreshDist();
  const lib = await modules();
  const sourcePath = flag("--source", "campaign/pr-tasks/viable.json");
  const sourceText = readFileSync(resolve(repositoryRoot, sourcePath), "utf8");
  const viable = JSON.parse(sourceText).tasks.filter((one) => one.viable);
  const workingRoot = corpusRootOf(lib);
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
    const checkout = lib.taskCheckout(workingRoot, one);
    const oracleFile = execFileSync("git", ["show", `${one.mergeCommit}:${one.testFile}`], {
      cwd: checkout,
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
  tasks.sort((left, right) => (left.id < right.id ? -1 : 1));
  const manifest = lib.manifestSchema.parse({
    schema: "swarm.reach-pressure.manifest.v1",
    cohort: flag("--cohort", `mined-pr-viable-${tasks.length}`),
    source: { path: sourcePath, digest: lib.digestOfBytes(sourceText) },
    tasks,
  });
  mkdirSync(evidenceRoot, { recursive: true });
  writeFileSync(paths.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`froze ${tasks.length} task(s): ${paths.manifest}`);
  console.log(`manifestDigest ${lib.digestOfJson(manifest)}`);
  const components = componentDigestsOf(lib);
  const policy = lib.experimentPolicyNamed(flag("--policy", "reach-pressure-v2"));
  console.log("a protocol of schema swarm.reach-pressure.protocol.v2 registers:");
  console.log(`  driverDigest          ${components.acquisition}  (the acquisition identity)`);
  console.log(`  identities.scoring    ${components.scoring}`);
  console.log(`  policy                ${policy.id}`);
  console.log(`  policyDigest          ${policy.digest}`);
  console.log(`analysis ${components.analysis} and renderer ${components.renderer} are recorded`);
  console.log("by each derivation and are not registered, so a later correction stays visible.");
}

/** The task text is read from the viability record and checked against the frozen digest. */
function taskTextsOf(lib, manifest) {
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

function judgedTaskOf(task) {
  return { ...task, sealedCases: task.visibleCases };
}

/** The oracle file, outside every workspace, checked against the digest the cohort froze. */
function storedOracle(lib, workingRoot, checkout, task) {
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
  return stored;
}

function recordEnvironment(parameters, served) {
  if (existsSync(paths.environment)) return;
  writeFileSync(
    paths.environment,
    `${JSON.stringify(
      {
        node: process.version,
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model ?? "unknown",
        cores: cpus().length,
        memoryBytes: totalmem(),
        endpoint: parameters.endpoint,
        servedModels: served,
      },
      null,
      2,
    )}\n`,
  );
}

async function run({ synthetic }) {
  await underTheCampaignLock(async (lib) => {
    const { identity, manifest, parameters, policy } = experimentIdentity(lib, {
      bindToCommit: !synthetic,
    });
    // Before a task is spent: rows already here belong to this identity or nothing runs.
    lib.assertOneAcquisition(identity, readJsonLines(paths.results));
    if (!synthetic) requireEvidenceHeadroom();
    const workingRoot = workingRootOf(lib, parameters, synthetic);
    const textOf = taskTextsOf(lib, manifest);
    const scriptedAgent = flag("--agent-command", null);
    if (scriptedAgent !== null && !synthetic) {
      throw new Error("a scripted agent runs only against a synthetic cohort");
    }
    const corpusRoot = corpusRootOf(lib);
    const limit = Number(flag("--limit", "100000"));

    if (scriptedAgent === null) {
      const health = await lib.endpointGenerates(
        parameters.endpoint,
        parameters.model.replace(/^local:/, ""),
      );
      if (!health.generates) {
        throw new Error(
          `the model endpoint is not generating (${health.failure}), so nothing was run: ${health.detail}`,
        );
      }
      const served = await (await fetch(`${parameters.endpoint}/models`)).json();
      recordEnvironment(parameters, (served.data ?? []).map((one) => one.id).sort());
    }

    const rows = readJsonLines(paths.results);
    const resultsOf = (id) =>
      rows.filter((row) => row.taskId === id && row.schema.endsWith("result.v1"));
    const launchesOf = (id) =>
      rows.filter((row) => row.taskId === id && row.schema.endsWith("launch.v1"));
    const append = (row) => {
      rows.push(row);
      appendFileSync(paths.results, `${lib.canonicalJson(row)}\n`);
    };

    let ran = 0;
    for (const task of manifest.tasks) {
      const schedule = lib.scheduleOf({
        launches: launchesOf(task.id),
        results: resultsOf(task.id),
        attemptsPerTask: parameters.limits.attemptsPerTask,
      });
      // A launch with no result is a driver that stopped mid-task. The attempt is kept, as the
      // infrastructure failure it was, and the task is scheduled again under the same protocol.
      if (schedule.closeDangling !== null) {
        append({
          ...identity,
          schema: "swarm.reach-pressure.result.v1",
          taskId: task.id,
          attempt: schedule.closeDangling.attempt,
          startedAt: schedule.closeDangling.startedAt,
          wallMs: 0,
          trajectory: {
            status: "infrastructure-failure",
            detail: "the driver stopped before this attempt settled, so nothing it did was kept",
            steps: [],
            visibleAcceptedAt: null,
            control: null,
            reach: null,
          },
        });
      }
      if (schedule.action !== "dispatch") continue;
      if (ran >= limit) break;
      ran += 1;

      const attempt = schedule.attempt;
      const startedAt = new Date().toISOString();
      const started = Date.now();
      append({
        ...identity,
        schema: "swarm.reach-pressure.launch.v1",
        taskId: task.id,
        attempt,
        startedAt,
      });

      const trajectory = await oneTask({
        lib,
        task,
        taskText: textOf(task),
        parameters,
        workingRoot,
        corpusRoot,
        attempt,
        scriptedAgent,
        policy: policy.id,
      });
      append({
        ...identity,
        schema: "swarm.reach-pressure.result.v1",
        taskId: task.id,
        attempt,
        startedAt,
        wallMs: Date.now() - started,
        trajectory,
      });
      const reach = trajectory.reach;
      console.log(
        `  ${task.id.padEnd(44)} ${trajectory.status}` +
          `${reach?.triggered ? ` (repairs ${reach.repairs}, patch ${trajectory.control.patchDigest === reach.patchDigest ? "unchanged" : "changed"})` : ""}` +
          `${trajectory.detail === null ? "" : `: ${trajectory.detail}`}`,
      );
      if (trajectory.status === "infrastructure-failure") {
        console.log(
          "stopping: every task after an infrastructure failure would record the same thing.",
        );
        process.exitCode = 1;
        break;
      }
    }
    const open = manifest.tasks.filter((task) => {
      const last = resultsOf(task.id).at(-1);
      return (
        (last === undefined || last.trajectory.status === "infrastructure-failure") &&
        resultsOf(task.id).length < parameters.limits.attemptsPerTask
      );
    });
    console.log(
      `${manifest.tasks.length - open.length} of ${manifest.tasks.length} task(s) closed`,
    );
    console.log(`${open.length} task(s) still open`);
  });
}

async function oneTask({
  lib,
  task,
  taskText,
  parameters,
  workingRoot,
  corpusRoot,
  attempt,
  scriptedAgent,
  policy,
}) {
  const slug = `${lib.taskSlug(task)}-a${attempt}`;
  const checkout = lib.taskCheckout(corpusRoot, task);
  const workspace = join(workingRoot, "runs", slug);
  const patchRoot = join(workingRoot, "patches");
  const sessionRoot = join(workingRoot, "sessions");
  for (const directory of [patchRoot, sessionRoot]) mkdirSync(directory, { recursive: true });
  const failed = (detail) => ({
    status: "unjudgeable",
    detail,
    steps: [],
    visibleAcceptedAt: null,
    control: null,
    reach: null,
  });

  let storedTestFile;
  try {
    storedTestFile = storedOracle(lib, workingRoot, checkout, task);
    rmSync(workspace, { recursive: true, force: true });
    await lib.prepareSealedWorkspace({
      checkout,
      workspace,
      baseCommit: task.baseCommit,
      mergeCommit: task.mergeCommit,
      testFile: task.testFile,
      // Thinking off: a reasoning model served locally otherwise spends its output budget on
      // reasoning and answers with nothing, which reads as the model failing the task.
      untrackedFiles: {
        "swarm.toml": `[providers]\nlocal_endpoint = "${parameters.endpoint}"\nlocal_thinking = ${parameters.agent.thinking}\n`,
      },
    });
  } catch (cause) {
    return failed(`the workspace could not be prepared: ${cause?.message ?? cause}`);
  }
  const installed = await lib.runCommand(
    "npm",
    ["ci", "--no-audit", "--no-fund", "--loglevel=error"],
    {
      cwd: workspace,
      timeoutMs: 15 * 60_000,
    },
  );
  if (installed.code !== 0) return failed("npm ci failed in the workspace");

  const judgedTask = judgedTaskOf(task);
  const patchPathOf = (digest) => join(patchRoot, `${digest.slice(7)}.patch`);
  const effects = {
    now: () => Date.now(),
    // Asked to generate, not merely to list models: a wedged server does the second and not the
    // first. The model name is the spec's id after its provider prefix. A scripted agent calls no
    // model, so there is no endpoint whose health could bear on what it left.
    endpointGenerates: () =>
      scriptedAgent === null
        ? lib.endpointGenerates(parameters.endpoint, parameters.model.replace(/^local:/, ""))
        : Promise.resolve({ generates: true, failure: null, detail: "" }),
    invokeAgent: async (prompt) => {
      const started = Date.now();
      const agentArgv =
        scriptedAgent !== null
          ? [process.execPath, resolve(repositoryRoot, scriptedAgent), workspace, prompt]
          : [
              process.execPath,
              join(repositoryRoot, "dist/cli.js"),
              "--model",
              parameters.model,
              "--local-endpoint",
              parameters.endpoint,
              "--no-tui",
              "--json",
              "--workspace",
              workspace,
              "--base",
              task.baseCommit,
              "--max-tokens",
              String(parameters.agent.maxTokens),
              ...(parameters.agent.isolation === null
                ? []
                : ["--isolation", parameters.agent.isolation]),
              "--max-wall-minutes",
              String(parameters.agent.maxWallMinutes),
              prompt,
            ];
      const agent = await lib.runCommand(agentArgv[0], agentArgv.slice(1), {
        cwd: workspace,
        timeoutMs: (parameters.agent.maxWallMinutes + 4) * 60_000,
      });
      return {
        exitCode: agent.code,
        wallMs: Date.now() - started,
        timedOut: agent.timedOut,
        ...(await sessionOf(lib, agent.stdout, sessionRoot)),
      };
    },
    snapshot: async () => {
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
    },
    judgeVisible: async (patch) => {
      // A judge per patch, so the repository's own checks run for every patch that is judged.
      const judge = await lib.halfJudgeFor({
        task: judgedTask,
        checkout,
        patchPath: patchPathOf(patch.digest),
        storedTestFile,
        cliPath: join(repositoryRoot, "dist/cli.js"),
        isolation: parameters.agent.isolation,
      });
      return judge(task.visibleCases);
    },
  };
  try {
    return await lib.runTrajectory({
      task: { id: task.id, taskText },
      limits: parameters.limits,
      effects,
      policy,
    });
  } catch (cause) {
    return failed(`the trajectory could not be completed: ${cause?.message ?? cause}`);
  }
}

/**
 * The invocation's session: its identity, a digest over its whole ledger, and its usage. The
 * session is copied out of the child's temporary home, which the operating system clears.
 */
async function sessionOf(lib, stdout, sessionRoot) {
  const unknown = {
    runId: null,
    ledgerDigest: null,
    ledgerRecords: null,
    usage: {
      modelCalls: null,
      failedCalls: null,
      inputTokens: null,
      outputTokens: null,
      status: "unknown",
    },
  };
  let named = null;
  for (const line of stdout.split("\n").reverse()) {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.runId === "string") {
        named = parsed;
        break;
      }
    } catch {}
  }
  if (named === null) return unknown;
  try {
    const home = join(lib.defaultChildHome(), ".swarm", "sessions");
    const kept = join(sessionRoot, named.runId);
    if (!existsSync(kept)) cpSync(join(home, named.runId), kept, { recursive: true });
    const evidence = await lib.readSessionEvidence(sessionRoot, named.runId);
    return {
      runId: named.runId,
      ledgerDigest: lib.digestOfBytes(readFileSync(join(kept, "ledger.jsonl"), "utf8")),
      ledgerRecords: evidence.records.length,
      fileSet: lib.fileSetOfSession({
        records: () => evidence.records,
        payloads: () => evidence.payloads,
      }),
      usage: lib.usageOfModelCalls(
        evidence.records.map((record) => ({
          type: record.type,
          payload: evidence.payloads.get(record.payloadDigest),
        })),
      ),
    };
  } catch {
    return { ...unknown, runId: named.runId };
  }
}

async function score({ synthetic }) {
  await underTheCampaignLock(async (lib) => {
    const { identity, manifest, parameters } = experimentIdentity(lib, {
      bindToCommit: !synthetic,
    });
    const workingRoot = workingRootOf(lib, parameters, synthetic);
    const corpusRoot = corpusRootOf(lib);
    lib.assertOneAcquisition(identity, [
      ...readJsonLines(paths.results),
      ...readJsonLines(paths.hiddenScores),
    ]);
    const results = readJsonLines(paths.results).filter((row) => row.schema.endsWith("result.v1"));
    const lastOf = (id) => results.filter((row) => row.taskId === id).at(-1);
    const open = manifest.tasks.filter((task) => {
      const last = lastOf(task.id);
      return (
        (last === undefined || last.trajectory.status === "infrastructure-failure") &&
        results.filter((row) => row.taskId === task.id).length < parameters.limits.attemptsPerTask
      );
    });
    if (open.length > 0) {
      throw new Error(
        `held-back scoring starts only once every trajectory has settled, and ${open.length} have not: ` +
          open
            .map((task) => task.id)
            .slice(0, 5)
            .join(", "),
      );
    }
    const scored = new Set(
      readJsonLines(paths.hiddenScores).map((row) => `${row.taskId} ${row.patchDigest}`),
    );
    for (const task of manifest.tasks) {
      const { trajectory } = lastOf(task.id);
      for (const patchDigest of lib.patchesToScore(trajectory)) {
        if (scored.has(`${task.id} ${patchDigest}`)) continue;
        const row = {
          ...identity,
          schema: "swarm.reach-pressure.hidden-score.v1",
          taskId: task.id,
          ...(patchDigest === lib.emptyPatchDigest
            ? lib.scoreOfAnEmptyPatch()
            : await heldBackScore({
                lib,
                task,
                trajectory,
                patchDigest,
                workingRoot,
                corpusRoot,
                parameters,
              })),
        };
        appendFileSync(
          paths.hiddenScores,
          `${lib.canonicalJson(lib.hiddenScoreSchema.parse(row))}\n`,
        );
        console.log(`  ${task.id.padEnd(44)} ${patchDigest.slice(7, 19)} ${row.hidden}`);
      }
    }
  });
}

async function heldBackScore({
  lib,
  task,
  trajectory,
  patchDigest,
  workingRoot,
  corpusRoot,
  parameters,
}) {
  const checkout = lib.taskCheckout(corpusRoot, task);
  const step = trajectory.steps.findLast((one) => one.patch.digest === patchDigest);
  const visibleTask =
    step?.observation.kind === "judged" ? step.observation.verdict.task : "unjudged";
  const judge = await lib.halfJudgeFor({
    task: judgedTaskOf(task),
    checkout,
    patchPath: join(workingRoot, "patches", `${patchDigest.slice(7)}.patch`),
    storedTestFile: storedOracle(lib, workingRoot, checkout, task),
    cliPath: join(repositoryRoot, "dist/cli.js"),
    isolation: parameters.agent.isolation,
  });
  // The repository's own checks were measured when the visible oracle judged this same patch.
  const settled = await lib.settleHeldBack(judge, judgedTaskOf(task), visibleTask, {
    oracleOnly: true,
  });
  const hidden = lib.hiddenOutcome(settled.heldBackVerdict);
  return {
    patchDigest,
    hidden,
    basis:
      hidden === "unjudgeable"
        ? (lib.whyNothingWasJudged(settled.heldBack) ??
          `the held-back oracle read ${settled.heldBackVerdict}`)
        : settled.orderDependent
          ? "the held-back half refused alone and accepted beside the visible half, which is order dependence and not a refusal"
          : "the held-back half's own verdict on this patch",
    heldBackVerdict: settled.heldBackVerdict,
    orderDependent: settled.orderDependent,
    heldBackBond: settled.heldBack.oracleBond ?? null,
  };
}

async function analyze({ synthetic }) {
  requireFreshDist();
  const lib = await modules();
  // Rows are held to the driver the protocol registered. The checkout that re-derives the report
  // may be a later one, and where its sources differ the derivation record says so.
  const { identity, manifest, parameters, components } = experimentIdentity(lib, {
    bindToCommit: false,
    enforceDriver: false,
  });
  const driverAtAnalysis = identity.driverDigest;
  identity.driverDigest = parameters.driverDigest;
  const rows = readJsonLines(paths.results);
  const scoreRows = readJsonLines(paths.hiddenScores);
  // The rows name the commit that produced them, and the analysis may run at a later one: the
  // report and the evidence are committed after the run. Every other identity field must match.
  const harnesses = [...new Set(rows.map((row) => row.harness))];
  if (harnesses.length > 1) throw new lib.MixedProtocolGenerations(harnesses);
  const bound = { ...identity, harness: harnesses[0] ?? identity.harness };
  // Whose rows these are is settled before any of them is parsed: a stray row of an earlier
  // generation is refused as that, and not as a row today's schema cannot read.
  lib.assertOneAcquisition(bound, [...rows, ...scoreRows]);
  const results = rows
    .filter((row) => row.schema.endsWith("result.v1"))
    .map((row) => lib.resultRowSchema.parse(row));
  const hiddenScores = scoreRows.map((row) => lib.hiddenScoreSchema.parse(row));
  const summary = lib.summarize({ manifest, identity: bound, results, hiddenScores });
  const summaryText = `${JSON.stringify(summary, null, 2)}\n`;

  const publishedText = existsSync(paths.summary) ? readFileSync(paths.summary, "utf8") : null;
  const resultsDigest = lib.digestOfBytes(readFileSync(paths.results, "utf8"));
  const hiddenScoresDigest = existsSync(paths.hiddenScores)
    ? lib.digestOfBytes(readFileSync(paths.hiddenScores, "utf8"))
    : null;
  const record = lib.derivationRecord({
    acquisition: bound,
    components,
    driverSourcesDigest: driverAtAnalysis,
    derivedAt: {
      harness: git(["rev-parse", "HEAD"]),
      uncommittedSourceEdits: sourceIdentity().includes("uncommitted"),
    },
    resultsDigest,
    hiddenScoresDigest,
    summary: JSON.parse(summaryText),
    summaryDigest: lib.digestOfBytes(summaryText),
    published:
      publishedText === null
        ? null
        : { summary: JSON.parse(publishedText), digest: lib.digestOfBytes(publishedText) },
  });
  const requestedOut = flag("--out", null);
  const destination = lib.derivationDestination({
    record,
    evidenceRoot,
    requestedOut: requestedOut === null ? null : resolve(repositoryRoot, requestedOut),
  });
  const inPlace = destination === evidenceRoot;

  const workingRoot = workingRootOf(lib, parameters, synthetic);
  // Both patches of every task where reach triggered, committed so each pair can be read. Where
  // the repair changed nothing they are one file. They are observations, so they are only ever
  // added beside the rows and never into a separate derivation.
  for (const one of inPlace ? summary.triggered : []) {
    mkdirSync(paths.patches, { recursive: true });
    for (const digest of [one.controlPatch, one.reachPatch]) {
      const kept = join(paths.patches, `${digest.slice(7)}.patch`);
      const source = join(workingRoot, "patches", `${digest.slice(7)}.patch`);
      if (!existsSync(kept) && existsSync(source)) cpSync(source, kept);
    }
  }
  const environment = existsSync(paths.environment)
    ? JSON.parse(readFileSync(paths.environment, "utf8"))
    : null;
  const pairNotes = existsSync(paths.pairNotes)
    ? JSON.parse(readFileSync(paths.pairNotes, "utf8"))
    : {};
  const report = lib.renderReport({
    summary,
    parameters,
    environment,
    pairNotes,
    postscript: existsSync(paths.postscript) ? readFileSync(paths.postscript, "utf8") : null,
    patchesHref: inPlace ? "patches" : relative(destination, paths.patches),
    // A page written in place is the first publication and says so, on every run that reproduces
    // it. Only a derivation written beside a published one has something to be compared with.
    derivation: {
      components: record.derivation.components,
      againstPublished: inPlace ? null : record.againstPublished,
    },
    digests: {
      driverAtAnalysis,
      results: resultsDigest,
      hiddenScores: hiddenScoresDigest,
      summary: lib.digestOfBytes(summaryText),
    },
  });
  // The page is held to the same rule as the summary: a renderer corrected later produces a
  // different page from the same numbers, and that page goes beside the published one.
  if (inPlace && existsSync(paths.report) && readFileSync(paths.report, "utf8") !== report) {
    throw new Error(
      "a report is already published for these rows and this checkout renders different bytes. " +
        "A published page is not overwritten: write this one beside it with --out <directory>.",
    );
  }
  mkdirSync(destination, { recursive: true });
  const written = {
    summary: join(destination, "summary.json"),
    report: join(destination, "report.md"),
    derivation: join(destination, "derivation.json"),
  };
  writeFileSync(written.summary, summaryText);
  writeFileSync(written.report, report);
  if (!inPlace || publishedText === null) {
    writeFileSync(written.derivation, `${JSON.stringify(record, null, 2)}\n`);
  }
  for (const path of Object.values(written)) {
    if (existsSync(path)) console.log(`written: ${path}`);
  }
  console.log(`summary digest ${lib.digestOfBytes(summaryText)}`);
  console.log(`report digest  ${lib.digestOfBytes(report)}`);
  const against = record.againstPublished;
  if (against !== null) {
    console.log(
      against.identical
        ? "the published summary is reproduced byte for byte"
        : `against the published summary: ${against.changed.length} value(s) changed, ` +
            `${against.added.length} field(s) added, ${against.removed.length} removed; ` +
            `result ${against.resultChanged ? "CHANGED" : "unchanged"}`,
    );
  }
}

/**
 * A confirmatory run commits its evidence, so it does not start in a tree that has no room for
 * it. Asked before the first task and not after the last, which is when it was found out last time.
 */
function requireEvidenceHeadroom() {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/check-repo-weight.mjs")], {
    cwd: repositoryRoot,
    stdio: ["ignore", "ignore", "inherit"],
  });
}

async function main() {
  const synthetic = argv.includes("--synthetic");
  if (command === "build") return underTheCampaignLock(async () => console.log("dist built"));
  if (command === "freeze") return freeze();
  if (command === "run") return run({ synthetic });
  if (command === "score") return score({ synthetic });
  if (command === "analyze") return analyze({ synthetic });
  throw new Error(
    "usage: reach-pressure-experiment.mjs build | freeze | run | score | analyze [--out <dir>] [--synthetic]",
  );
}

main().catch((cause) => {
  console.error(cause?.message ?? cause);
  process.exit(1);
});
