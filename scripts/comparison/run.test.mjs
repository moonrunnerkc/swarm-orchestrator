/**
 * Fault injection against the real runner. Every case here spawns `run.mjs` as a process with
 * a temporary HOME (so the comparison root, the records, the lock and the halt records are its
 * own), a disposable endpoint process that lists one model, a local mirror of a tiny task
 * repository, and the fixture arm in place of both products. The counts come from markers the
 * arm leaves while it runs, never from a return value: `launches.log` says how many invocations
 * started and which were corrections, and the `heartbeat` file's mtime says when the last owned
 * child stopped.
 *
 * COMPARISON_RUNNER names another copy of the runner to drive, which is how the proof shows the
 * assertions fail against a runner whose stop path is broken.
 */
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { digestOf } from "./arms.mjs";
import { launches } from "./order.mjs";

const here = dirname(new URL(import.meta.url).pathname);
const runner = process.env.COMPARISON_RUNNER ?? join(here, "run.mjs");
const { harnessDigest } = await import(join(dirname(runner), "harness-identity.mjs"));
const fixtures = join(here, "fixtures");
const detectionDeadlineMs = 10_000;
const terminationDeadlineMs = 10_000;

/** Timings worth keeping as evidence, written where the proof script asks for them. */
const measurements = [];
afterEach(() => {
  if (process.env.COMPARISON_PROOF_OUT && measurements.length > 0)
    writeFileSync(process.env.COMPARISON_PROOF_OUT, `${JSON.stringify(measurements, null, 2)}\n`);
});

const children = [];
const roots = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
    try {
      child.kill("SIGKILL");
    } catch {}
  }
  for (const root of roots.splice(0)) {
    // A case that removed write permission puts it back so the directory can go.
    for (const directory of walk(root)) {
      try {
        chmodSync(directory, 0o700);
      } catch {}
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function* walk(directory) {
  yield directory;
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) if (entry.isDirectory()) yield* walk(join(directory, entry.name));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate, { timeoutMs = 30_000, every = 50, what = "condition" } = {}) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs)
      throw new Error(`${what} did not hold within ${timeoutMs} ms`);
    await sleep(every);
  }
  return Date.now();
}

function git(cwd, ...args) {
  const ran = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", ...args],
    { cwd, encoding: "utf8" },
  );
  if (ran.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${ran.stderr}`);
  return ran.stdout.trim();
}

/**
 * A task repository with a base that fails the visible check and the hidden oracle, and an
 * upstream commit (the base's child) that passes both, mirrored bare where the harness looks.
 */
function mirrorTask(home, repository, manifest = {}) {
  const source = mkdtempSync(join(tmpdir(), "comparison-source-"));
  roots.push(source);
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify({ name: "calc", type: "module", version: "1.0.0", ...manifest })}\n`,
  );
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a - b;\nexport const mul = (a, b) => a * b;\n",
  );
  mkdirSync(join(source, "test"));
  writeFileSync(
    join(source, "test/run.mjs"),
    'import { mul } from "../calc.mjs";\nif (mul(2, 3) !== 6) { console.error("mul"); process.exit(1); }\n',
  );
  git(source, "init", "-q");
  git(source, "add", "--all");
  git(source, "commit", "-qm", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(
    join(source, "calc.mjs"),
    "export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n",
  );
  writeFileSync(
    join(source, "test/add.test.mjs"),
    'import { add } from "../calc.mjs";\nif (add(2, 3) !== 5 || add(1, 1) !== 2) { console.error("add"); process.exit(1); }\n',
  );
  git(source, "add", "--all");
  git(source, "commit", "-qm", "fix add");
  const upstream = git(source, "rev-parse", "HEAD");
  const mirror = join(
    home,
    ".cache/swarm-comparison/mirrors",
    `${repository.replace("/", "__")}.git`,
  );
  mkdirSync(dirname(mirror), { recursive: true });
  git(source, "clone", "--quiet", "--bare", source, mirror);
  return { base, upstream };
}

function task(id, repository, commits, overrides = {}) {
  return {
    id,
    repository,
    workType: "bugfix",
    baseCommit: commits.base,
    upstreamCommit: commits.upstream,
    install: [["true"]],
    build: [],
    projectTest: ["node", "test/run.mjs"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        'import { add } from "../../calc.mjs";\nif (add(2, 3) !== 5) { console.error("add(2, 3) is " + add(2, 3)); process.exit(1); }\n',
    },
    hidden: { testFiles: ["test/add.test.mjs"], argv: ["node", "test/add.test.mjs"] },
    immutable: ["test"],
    taskText:
      "add(a, b) in calc.mjs subtracts instead of adding; make it add and keep mul as it is.",
    ...overrides,
  };
}

/** A temporary HOME, the fixture markers, and an `opencode` shim on PATH that runs the fixture arm. */
function environment() {
  const home = mkdtempSync(join(tmpdir(), "comparison-home-"));
  roots.push(home);
  const markers = join(home, "markers");
  mkdirSync(markers);
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "opencode"),
    `#!/bin/sh\nif [ "$1" = "--version" ]; then echo "\${COMPARISON_FIXTURE_OPENCODE_VERSION:-fixture-1.0.0}"; exit 0; fi\nexec node "${join(fixtures, "arm.mjs")}" opencode "$@"\n`,
    { mode: 0o755 },
  );
  return { home, markers, bin };
}

async function startEndpoint(home, model = "fixture-model", port = 0) {
  const ready = join(home, `endpoint-ready-${Date.now()}-${Math.random()}`);
  const child = spawn("node", [join(fixtures, "endpoint-server.mjs"), ready, model, String(port)], {
    stdio: "ignore",
    detached: true,
  });
  children.push(child);
  await until(() => existsSync(ready), { what: "the endpoint fixture to listen" });
  const { port: bound, pid } = JSON.parse(readFileSync(ready, "utf8"));
  return { child, port: bound, pid, url: `http://127.0.0.1:${bound}/v1` };
}

function stopEndpoint(endpoint) {
  process.kill(endpoint.pid, "SIGKILL");
  return Date.now();
}

function writeManifest(home, { endpoint, tasks, budgets = {}, pins = {}, launchOverrides = {} }) {
  const manifest = {
    schema: "swarm-ordinary-comparison.manifest.v1",
    frozenAt: "2026-10-14T00:00:00.000Z",
    protocolDigest: null,
    pins: {
      model: "fixture-model",
      endpoint,
      swarmCli: join(fixtures, "arm.mjs"),
      swarmRevision: "fixture",
      opencode: "fixture-1.0.0",
      node: process.version,
      harnessDigest: harnessDigest(),
      ...pins,
    },
    // Five minutes, so a correction always has its minute left after a fixture's quick invocation.
    budgets: {
      wallMsPerInvocation: 300_000,
      swarmTokenCap: 600_000,
      maxCorrections: 2,
      ...budgets,
    },
    seed: "swarm-ordinary-comparison-2026-10-11",
    tasks,
    launches: launches(tasks.map((one) => one.id)).map((launch) => ({
      ...launch,
      ...launchOverrides[launch.order],
    })),
  };
  const path = join(home, "manifest.json");
  const bytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path, bytes);
  const digest = digestOf(bytes);
  return {
    path,
    manifest,
    digest,
    runs: join(home, ".cache/swarm-comparison/runs", digest.slice(7, 23)),
  };
}

function startRunner(env, manifestPath, extra = [], behavior = "correct", more = {}) {
  const child = spawn("node", [runner, "--manifest", manifestPath, ...extra], {
    env: {
      ...process.env,
      HOME: env.home,
      PATH: `${env.bin}:${process.env.PATH}`,
      COMPARISON_FIXTURE_DIR: env.markers,
      COMPARISON_FIXTURE_BEHAVIOR: behavior,
      ...more,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  children.push(child);
  const out = [];
  const err = [];
  child.stdout.on("data", (chunk) => out.push(chunk));
  child.stderr.on("data", (chunk) => err.push(chunk));
  child.done = new Promise((resolve) => {
    child.on("close", (code, signal) =>
      resolve({
        code,
        signal,
        stdout: Buffer.concat(out).toString(),
        stderr: Buffer.concat(err).toString(),
      }),
    );
  });
  return child;
}

const runRunner = (env, manifestPath, extra, behavior, more) =>
  startRunner(env, manifestPath, extra, behavior, more).done;

const launchLines = (env) =>
  existsSync(join(env.markers, "launches.log"))
    ? readFileSync(join(env.markers, "launches.log"), "utf8").trim().split("\n").filter(Boolean)
    : [];
const corrections = (env) =>
  launchLines(env).filter((line) => line.includes(" correction ")).length;
const heartbeatAt = (env) => statSync(join(env.markers, "heartbeat")).mtimeMs;
const files = (directory) => (existsSync(directory) ? readdirSync(directory).sort() : []);
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const halts = (runs) => files(runs).filter((name) => /^halt-\d+\.json$/.test(name));
const recordsOf = (runs) =>
  files(runs).filter((name) => /^[a-z0-9-]+\.(swarm|opencode)\.json$/.test(name));
const attemptsOf = (runs) =>
  files(runs).filter((name) => /\.(halted|infrastructure)-\d+\.json$/.test(name));

/** Waits for the heartbeat to stop moving, and says when it last moved. */
async function heartbeatStopped(env, deadlineMs) {
  const started = Date.now();
  let last = heartbeatAt(env);
  while (Date.now() - started < deadlineMs + 2000) {
    await sleep(600);
    const now = heartbeatAt(env);
    if (now === last && Date.now() - now > 1000) return last;
    last = now;
  }
  throw new Error("the owned child was still alive after the termination deadline");
}

async function setup({
  tasks: build,
  endpoint: endpointOptions = {},
  manifest: baseManifest = {},
  ...rest
} = {}) {
  const env = environment();
  const endpoint = endpointOptions.absent
    ? null
    : await startEndpoint(env.home, endpointOptions.model);
  const commits = mirrorTask(env.home, "fixture/calc", baseManifest);
  const tasks = (
    build ??
    ((t) => [
      t("calc-fix-add", "fixture/calc", commits),
      t("calc-fix-add-again", "fixture/calc", commits),
    ])
  )(task, commits);
  const frozen = writeManifest(env.home, {
    endpoint: endpoint ? endpoint.url : "http://127.0.0.1:1/v1",
    tasks,
    ...rest,
  });
  return { env, endpoint, commits, tasks, ...frozen };
}

describe("stopping the comparison when the experiment is invalid", () => {
  it("dispatches no agent after a fatal failure before the first launch (the continuation defect)", async () => {
    const first = launches(["calc-fix-add", "calc-fix-add-again"])[0].task;
    const other = first === "calc-fix-add" ? "calc-fix-add-again" : "calc-fix-add";
    const fixture = await setup({
      tasks: (t, commits) => [
        // The first task in the frozen order cannot establish its environment.
        t(first, "fixture/calc", commits, { install: [["false"]] }),
        t(other, "fixture/calc", commits),
      ],
    });
    const result = await runRunner(fixture.env, fixture.path);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(result.code).toBe(3);
    expect(attemptsOf(fixture.runs)).toHaveLength(1);
    expect(recordsOf(fixture.runs)).toEqual([]);
    expect(halts(fixture.runs)).toEqual(["halt-1.json"]);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("preparation");
    expect(halt.remaining).toHaveLength(3);
    expect(result.stderr).toContain("halt-1.json");
  });

  it("launches nothing when the endpoint does not answer before the first launch", async () => {
    const fixture = await setup({ endpoint: { absent: true } });
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(attemptsOf(fixture.runs)).toEqual([]);
    const halt = readJson(join(fixture.runs, halts(fixture.runs)[0]));
    expect(halt.class).toBe("endpoint");
    expect(halt.launch).toBeNull();
    expect(halt.remaining).toHaveLength(4);
  });

  it("launches nothing when the endpoint serves a different model than the manifest froze", async () => {
    const fixture = await setup({ endpoint: { model: "some-other-model" } });
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(readJson(join(fixture.runs, "halt-1.json")).class).toBe("configuration");
    expect(result.stderr).toContain("fixture-model");
  });

  it("launches nothing when the installed OpenCode is not the pinned version", async () => {
    const fixture = await setup();
    const result = await runRunner(fixture.env, fixture.path, [], "correct", {
      COMPARISON_FIXTURE_OPENCODE_VERSION: "fixture-9.9.9",
    });
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(readJson(join(fixture.runs, "halt-1.json")).class).toBe("configuration");
  });

  it("launches nothing when the pinned Swarm CLI bytes have changed", async () => {
    const fixture = await setup({ pins: { swarmCliDigest: digestOf("some other build") } });
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(readJson(join(fixture.runs, "halt-1.json")).class).toBe("configuration");
  });

  it("stops the active arm and starts no later launch when the endpoint disappears mid-launch", async () => {
    const fixture = await setup();
    const child = startRunner(fixture.env, fixture.path, [], "hang");
    await until(() => launchLines(fixture.env).length === 1, { what: "the first launch" });
    await sleep(500);
    const killedAt = stopEndpoint(fixture.endpoint);
    const result = await child.done;
    const stoppedAt = await heartbeatStopped(fixture.env, terminationDeadlineMs);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(1);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("endpoint");
    expect(halt.reason).toContain("stopped");
    const detectedAt = Date.parse(halt.detectedAt);
    expect(detectedAt - killedAt).toBeLessThanOrEqual(detectionDeadlineMs);
    expect(stoppedAt - detectedAt).toBeLessThanOrEqual(terminationDeadlineMs);
    expect(halt.cleanup.outcome).toBe("terminated");
    const attempt = readJson(join(fixture.runs, attemptsOf(fixture.runs)[0]));
    expect(attempt.invocations).toHaveLength(1);
    expect(attempt.invocations[0].signal).toBe("SIGKILL(interrupted)");
    expect(attempt.corrections).toBe(0);
    measurements.push({
      fault: "endpoint disappears mid-launch",
      detectionMs: detectedAt - killedAt,
      childStoppedMs: stoppedAt - killedAt,
      cleanup: halt.cleanup,
    });
  });

  it("stops the active arm and starts no later launch when the endpoint restarts mid-launch", async () => {
    const fixture = await setup();
    const child = startRunner(fixture.env, fixture.path, [], "hang");
    await until(() => launchLines(fixture.env).length === 1, { what: "the first launch" });
    await sleep(500);
    const killedAt = stopEndpoint(fixture.endpoint);
    await startEndpoint(fixture.env.home, "fixture-model", fixture.endpoint.port);
    const result = await child.done;
    const stoppedAt = await heartbeatStopped(fixture.env, terminationDeadlineMs);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(1);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("endpoint");
    expect(halt.reason).toContain("restarted");
    const detectedAt = Date.parse(halt.detectedAt);
    expect(detectedAt - killedAt).toBeLessThanOrEqual(detectionDeadlineMs);
    expect(stoppedAt - detectedAt).toBeLessThanOrEqual(terminationDeadlineMs);
    measurements.push({
      fault: "endpoint restarts mid-launch",
      detectionMs: detectedAt - killedAt,
      childStoppedMs: stoppedAt - killedAt,
      cleanup: halt.cleanup,
    });
  });

  it("halts rather than inventing a task failure when the scorer cannot read its sealed material", async () => {
    const fixture = await setup({
      tasks: (t, commits) =>
        ["calc-fix-add", "calc-fix-add-again"].map((id) =>
          t(id, "fixture/calc", commits, {
            hidden: {
              testFiles: ["test/never-committed.test.mjs"],
              argv: ["node", "test/add.test.mjs"],
            },
          }),
        ),
    });
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(1);
    expect(recordsOf(fixture.runs)).toEqual([]);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("scorer");
    const attempt = readJson(join(fixture.runs, attemptsOf(fixture.runs)[0]));
    expect(attempt.hidden.verdict).toBe("unjudgeable");
    expect(attempt.infrastructureFailure).toContain("sealed file");
  });

  it("halts when the arm's runtime never started (nothing printed, or Swarm's unavailable status)", async () => {
    for (const [behavior, expected] of [
      ["empty", "printed nothing"],
      ["exit-unavailable", "exited 4"],
    ]) {
      const fixture = await setup();
      const result = await runRunner(fixture.env, fixture.path, [], behavior);
      expect(result.code).toBe(3);
      expect(launchLines(fixture.env)).toHaveLength(1);
      const halt = readJson(join(fixture.runs, "halt-1.json"));
      expect(halt.class).toBe("configuration");
      expect(halt.reason).toContain(expected);
    }
  });

  it("halts when OpenCode reports it could not connect while the endpoint it was given is healthy", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
    });
    const result = await runRunner(fixture.env, fixture.path, [], "connect-error");
    expect(result.code).toBe(3);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("configuration");
    expect(halt.launch.arm).toBe("opencode");
    expect(halt.reason).toContain("Unable to connect");
    // The Swarm arm of the same task was correct; whether it ran depends on the frozen order,
    // and either way nothing after the OpenCode launch started.
    const order = launches(["calc-fix-add"]).findIndex((launch) => launch.arm === "opencode");
    expect(launchLines(fixture.env)).toHaveLength(order + 1);
  });

  it("halts when a required record cannot be validated, written, or backed by its evidence", async () => {
    // An order the schema rejects: the record of the first launch does not validate.
    const invalid = await setup({ launchOverrides: { 0: { order: 0.5 } } });
    let result = await runRunner(invalid.env, invalid.path);
    expect(result.code).toBe(3);
    expect(launchLines(invalid.env)).toHaveLength(1);
    expect(recordsOf(invalid.runs)).toEqual([]);
    expect(attemptsOf(invalid.runs)).toHaveLength(1);
    expect(readJson(join(invalid.runs, "halt-1.json")).class).toBe("records");

    // The record directory loses write permission during the launch: no record, no halt record,
    // and still a nonzero exit; a restart does not continue either.
    const unwritable = await setup();
    result = await runRunner(unwritable.env, unwritable.path, [], "chmod-runs", {
      COMPARISON_FIXTURE_RUNS_DIR: unwritable.runs,
    });
    expect(result.code).toBe(3);
    expect(launchLines(unwritable.env)).toHaveLength(1);
    expect(result.stderr).toMatch(/EACCES|permission/i);
    const restarted = await runRunner(unwritable.env, unwritable.path, [], "chmod-runs", {
      COMPARISON_FIXTURE_RUNS_DIR: unwritable.runs,
    });
    expect(restarted.code).not.toBe(0);
    expect(launchLines(unwritable.env)).toHaveLength(1);
    chmodSync(unwritable.runs, 0o700);
    expect(recordsOf(unwritable.runs)).toEqual([]);

    // Swarm names an evidence directory that is not there.
    const missing = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
    });
    result = await runRunner(missing.env, missing.path, [], "missing-evidence");
    expect(result.code).toBe(3);
    const halt = readJson(join(missing.runs, "halt-1.json"));
    expect(halt.class).toBe("records");
    expect(halt.launch.arm).toBe("swarm");
    expect(halt.reason).toContain("evidence");
  });

  it("records a wrong patch as a failed task, corrects it twice, and lets the next task run", async () => {
    const fixture = await setup();
    const result = await runRunner(fixture.env, fixture.path, [], "wrong");
    expect(result.code).toBe(0);
    expect(halts(fixture.runs)).toEqual([]);
    expect(recordsOf(fixture.runs)).toHaveLength(4);
    expect(launchLines(fixture.env)).toHaveLength(12);
    expect(corrections(fixture.env)).toBe(8);
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      expect(record.infrastructureFailure).toBeNull();
      expect(record.corrections).toBe(2);
      expect(record.resolvedVisible).toBe(false);
      expect(record.hidden.verdict).toBe("fail");
      // Both fixtures report success; the scorer's "fail" over a claim is a recorded outcome.
      expect(record.invocations.at(-1).claimedSuccess).toBe(true);
    }
  });

  it("records a stalled arm killed at the wall as that arm's result and lets the next launch run", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      budgets: { wallMsPerInvocation: 1500, wallGraceMs: 500 },
    });
    const result = await runRunner(fixture.env, fixture.path, [], "hang");
    expect(result.code).toBe(0);
    expect(halts(fixture.runs)).toEqual([]);
    expect(recordsOf(fixture.runs)).toHaveLength(2);
    expect(launchLines(fixture.env)).toHaveLength(2);
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      expect(record.infrastructureFailure).toBeNull();
      expect(record.invocations[0].signal).toBe("SIGKILL(deadline)");
      expect(record.hidden.verdict).toBe("fail");
      expect(record.notes).toContain("the wall budget was spent before the corrections were");
    }
  });

  it("kills the arm at the launch's deadline: the grace is cleanup, not more solving time", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      budgets: { wallMsPerInvocation: 2000, wallGraceMs: 30_000 },
    });
    const result = await runRunner(fixture.env, fixture.path, [], "hang");
    expect(result.code).toBe(0);
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      const [only] = record.invocations;
      expect(only.signal).toBe("SIGKILL(deadline)");
      // Killed at two seconds and confirmed within the termination bound, never at 32.
      expect(only.wallMs).toBeGreaterThanOrEqual(2000);
      expect(only.wallMs).toBeLessThan(2000 + terminationDeadlineMs);
      expect(only.termination.confirmed).toBe(true);
      expect(record.cleanup.deadlineKills).toBe(1);
      expect(record.cleanup.wallMs).toBeLessThanOrEqual(record.cleanup.limitMs);
    }
  });

  it("halts, scoring nothing and dispatching nothing more, when a killed arm's end cannot be confirmed", async () => {
    const fixture = await setup({ budgets: { wallMsPerInvocation: 1500, wallGraceMs: 2000 } });
    const result = await runRunner(fixture.env, fixture.path, [], "escape");
    try {
      expect(result.code).toBe(3);
      expect(launchLines(fixture.env)).toHaveLength(1);
      const halt = readJson(join(fixture.runs, "halt-1.json"));
      expect(halt.class).toBe("interrupted");
      expect(halt.reason).toContain("not confirmed");
      expect(halt.remaining).toHaveLength(3);
      const attempt = readJson(join(fixture.runs, attemptsOf(fixture.runs)[0]));
      expect(attempt.invocations[0].termination.confirmed).toBe(false);
      expect(attempt.hidden.verdict).toBe("unjudgeable");
      // The escaped process worked in the workspace, so the harness found and stopped it too.
      expect(attempt.cleanup.strays.map((one) => one.outcome)).toEqual(["terminated"]);
    } finally {
      try {
        process.kill(
          Number(readFileSync(join(fixture.env.markers, "escaped.pid"), "utf8")),
          "SIGKILL",
        );
      } catch {}
    }
  });

  it("stops a process the arm detached in its directory before the tree is scored", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
    });
    const result = await runRunner(fixture.env, fixture.path, [], "detach");
    expect(result.code).toBe(0);
    expect(recordsOf(fixture.runs)).toHaveLength(2);
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      expect(record.cleanup.strays).toHaveLength(1);
      expect(record.cleanup.strays[0].outcome).toBe("terminated");
      expect(record.cleanup.strays[0].command).toContain("sleep");
      expect(record.hidden.verdict).toBe("pass");
    }
    const detached = Number(readFileSync(join(fixture.env.markers, "detached.pid"), "utf8"));
    expect(() => process.kill(detached, 0)).toThrow();
  });

  it("launches each correction with what is left of the token allowance and keeps Swarm's verification reserve inside the deadline", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      budgets: {
        wallMsPerInvocation: 600_000,
        swarmTokenCap: 600_000,
        swarmVerificationReserveMs: 120_000,
      },
    });
    const result = await runRunner(fixture.env, fixture.path, [], "wrong");
    expect(result.code).toBe(0);
    // What the arm process was actually started with, read from its own marker line.
    const swarm = launchLines(fixture.env)
      .filter((line) => line.startsWith("swarm "))
      .map((line) => ({
        tokens: Number(/max-tokens=(\d+)/.exec(line)?.[1]),
        minutes: Number(/max-wall-minutes=(\d+)/.exec(line)?.[1]),
      }));
    // The fixture reports 1,234 tokens per invocation; nothing resets the launch's allowance.
    expect(swarm.map((one) => one.tokens)).toEqual([600_000, 598_766, 597_532]);
    // Ten minutes less the two reserved for verification, in the whole minutes the flag takes
    // (eight where the invocation starts within the same millisecond, seven otherwise).
    expect(swarm[0].minutes).toBeGreaterThanOrEqual(7);
    for (const one of swarm) expect(one.minutes).toBeLessThanOrEqual(8);
    const record = readJson(join(fixture.runs, "calc-fix-add.swarm.json"));
    expect(record.invocations.map((one) => one.tokenAllowance)).toEqual([
      600_000, 598_766, 597_532,
    ]);
  });

  it("starts no correction without a minute left, and none for Swarm without its verification reserve on top", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      budgets: { wallMsPerInvocation: 100_000, swarmVerificationReserveMs: 60_000 },
    });
    const result = await runRunner(fixture.env, fixture.path, [], "wrong");
    expect(result.code).toBe(0);
    const swarm = readJson(join(fixture.runs, "calc-fix-add.swarm.json"));
    expect(swarm.corrections).toBe(0);
    expect(swarm.notes).toContain("the wall budget was spent before the corrections were");
    const opencode = readJson(join(fixture.runs, "calc-fix-add.opencode.json"));
    expect(opencode.corrections).toBe(2);
  });

  it("runs every command of a task, both arms included, with the npm release its base declares", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      manifest: { packageManager: "npm@9.9.9" },
    });
    const bin = join(fixture.env.home, ".cache/swarm-comparison/tools/npm-9.9.9/node_modules/.bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "npm"), "#!/bin/sh\necho 9.9.9\n", { mode: 0o755 });
    const result = await runRunner(fixture.env, fixture.path, [], "correct");
    expect(result.code).toBe(0);
    const lines = launchLines(fixture.env);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain(`npm=${bin}`);
    for (const name of recordsOf(fixture.runs))
      expect(readJson(join(fixture.runs, name)).preparedState.declaredNpm).toBe("9.9.9");
  });

  it("dispatches nothing when the npm release a task's base declares is not provisioned", async () => {
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
      manifest: { packageManager: "npm@9.9.9" },
    });
    const result = await runRunner(fixture.env, fixture.path, [], "correct");
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(0);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("preparation");
    expect(halt.reason).toContain("npm install --prefix");
  });

  it("halts when the arm's process ends on a signal the harness did not send", async () => {
    const fixture = await setup();
    const result = await runRunner(fixture.env, fixture.path, [], "external-kill");
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(1);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("interrupted");
    expect(halt.reason).toContain("SIGTERM");
  });

  it("stops the owned child on SIGTERM, records the interruption, and refuses to continue on restart", async () => {
    const fixture = await setup();
    const child = startRunner(fixture.env, fixture.path, [], "hang");
    await until(() => launchLines(fixture.env).length === 1, { what: "the first launch" });
    await sleep(500);
    const signalledAt = Date.now();
    process.kill(child.pid, "SIGTERM");
    const result = await child.done;
    const stoppedAt = await heartbeatStopped(fixture.env, terminationDeadlineMs);
    expect(result.code).toBe(143);
    expect(stoppedAt - signalledAt).toBeLessThanOrEqual(terminationDeadlineMs);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("interrupted");
    expect(halt.reason).toContain("SIGTERM");
    expect(halt.cleanup.outcome).toBe("terminated");
    expect(attemptsOf(fixture.runs)).toHaveLength(1);
    expect(existsSync(join(fixture.runs, "runner.lock"))).toBe(false);
    measurements.push({
      fault: "SIGTERM to the runner mid-launch",
      childStoppedMs: stoppedAt - signalledAt,
      cleanup: halt.cleanup,
    });

    const restarted = await runRunner(fixture.env, fixture.path, [], "correct");
    expect(restarted.code).toBe(3);
    expect(restarted.stderr).toContain("halted");
    expect(launchLines(fixture.env)).toHaveLength(1);
    expect(halts(fixture.runs)).toEqual(["halt-1.json"]);
  });

  it("recovers an interrupted state after SIGKILL: the orphaned arm is stopped and the campaign is halted", async () => {
    const fixture = await setup();
    const child = startRunner(fixture.env, fixture.path, [], "hang");
    await until(() => launchLines(fixture.env).length === 1, { what: "the first launch" });
    await sleep(500);
    process.kill(child.pid, "SIGKILL");
    await child.done;
    // SIGKILL ran no cleanup: the lock is still there and the arm is still beating.
    expect(existsSync(join(fixture.runs, "runner.lock"))).toBe(true);
    await sleep(700);
    expect(Date.now() - heartbeatAt(fixture.env)).toBeLessThan(600);

    const restartedAt = Date.now();
    const restarted = await runRunner(fixture.env, fixture.path, [], "correct");
    const stoppedAt = await heartbeatStopped(fixture.env, terminationDeadlineMs);
    expect(restarted.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(1);
    expect(stoppedAt - restartedAt).toBeLessThanOrEqual(terminationDeadlineMs);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("interrupted");
    expect(halt.reason).toContain("without cleanup");
    expect(halt.orphans).toHaveLength(1);
    expect(halt.orphans[0].outcome).toBe("terminated");
  });

  it("refuses a second runner on the same manifest while the first holds it", async () => {
    const fixture = await setup();
    const first = startRunner(fixture.env, fixture.path, [], "hang");
    await until(() => launchLines(fixture.env).length === 1, { what: "the first launch" });
    const second = await runRunner(fixture.env, fixture.path, [], "correct");
    expect(second.code).toBe(4);
    expect(second.stderr).toContain(String(first.pid));
    expect(launchLines(fixture.env)).toHaveLength(1);
    expect(halts(fixture.runs)).toEqual([]);
    process.kill(first.pid, "SIGTERM");
    await first.done;
  });

  it("resumes untouched cells only through an explicit, revalidated recovery, leaving completed cells as they were", async () => {
    const fixture = await setup();
    const only = fixture.manifest.launches[0].task;
    const completed = await runRunner(fixture.env, fixture.path, ["--only", only]);
    expect(completed.code).toBe(0);
    expect(recordsOf(fixture.runs)).toHaveLength(2);
    const before = Object.fromEntries(
      recordsOf(fixture.runs).map((name) => [
        name,
        digestOf(readFileSync(join(fixture.runs, name), "utf8")),
      ]),
    );

    stopEndpoint(fixture.endpoint);
    const halted = await runRunner(fixture.env, fixture.path);
    expect(halted.code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(2);
    expect(readJson(join(fixture.runs, "halt-1.json")).remaining).toHaveLength(2);

    // Recovery with the fault still present is refused and records nothing.
    const refused = await runRunner(fixture.env, fixture.path, [
      "--recover",
      "--justification",
      "trying anyway",
    ]);
    expect(refused.code).toBe(3);
    expect(files(fixture.runs).filter((name) => name.startsWith("recovery-"))).toEqual([]);
    // Without a recovery the campaign stays halted.
    expect((await runRunner(fixture.env, fixture.path)).code).toBe(3);
    expect(launchLines(fixture.env)).toHaveLength(2);

    await startEndpoint(fixture.env.home, "fixture-model", fixture.endpoint.port);
    const recovered = await runRunner(fixture.env, fixture.path, [
      "--recover",
      "--justification",
      "the endpoint was restarted by hand; pins unchanged",
    ]);
    expect(recovered.code).toBe(0);
    const recovery = readJson(join(fixture.runs, "recovery-1.json"));
    expect(recovery.clears).toBe("halt-1.json");
    expect(recovery.justification).toContain("restarted by hand");
    expect(recovery.revalidation.problems).toEqual([]);
    expect(launchLines(fixture.env)).toHaveLength(2);

    const resumed = await runRunner(fixture.env, fixture.path);
    expect(resumed.code).toBe(0);
    expect(recordsOf(fixture.runs)).toHaveLength(4);
    expect(launchLines(fixture.env)).toHaveLength(4);
    for (const [name, digest] of Object.entries(before))
      expect(digestOf(readFileSync(join(fixture.runs, name), "utf8"))).toBe(digest);
    expect(halts(fixture.runs)).toEqual(["halt-1.json"]);
  });

  it("writes the task's test command as Swarm's tests gate and stops before dispatch when the product's effective plan differs", async () => {
    // The task names `node test/run.mjs`; the product, asked what it would run, says the
    // manifest's own test script. That is what the pilot's upgrade launch ran into after it had
    // been dispatched. Nothing is launched: not the Swarm arm, and no later cell either.
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
    });
    const result = await runRunner(fixture.env, fixture.path, [], "correct", {
      COMPARISON_FIXTURE_CHECK: "ignore-override",
    });
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    expect(recordsOf(fixture.runs)).toEqual([]);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("configuration");
    expect(halt.reason).toContain("effective tests gate");
    expect(halt.reason).toContain('"npm run --loglevel=error test"');
    expect(halt.reason).toContain('"node test/run.mjs"');
    const attempt = readJson(join(fixture.runs, attemptsOf(fixture.runs)[0]));
    expect(attempt.invocations).toEqual([]);
    expect(attempt.gatePlan).toMatchObject({
      ok: false,
      expected: "node test/run.mjs",
      effective: "npm run --loglevel=error test",
      status: "passed",
    });
  });

  it("stops before dispatch when the effective tests gate fails on the prepared base under the launch's home", async () => {
    // The gate is the right command and it fails for a prerequisite absent from the launch's
    // fresh home. The pilot let the solver discover this inside its measured task and repair
    // the environment with the clock running; here the launch is refused with the output kept.
    const fixture = await setup({
      tasks: (t, commits) => [t("calc-fix-add", "fixture/calc", commits)],
    });
    const result = await runRunner(fixture.env, fixture.path, [], "correct", {
      COMPARISON_FIXTURE_CHECK: "prerequisite-missing",
    });
    expect(result.code).toBe(3);
    expect(launchLines(fixture.env)).toEqual([]);
    const halt = readJson(join(fixture.runs, "halt-1.json"));
    expect(halt.class).toBe("configuration");
    expect(halt.reason).toContain("failed on the prepared base");
    expect(halt.reason).toContain("Executable doesn't exist");
    const attempt = readJson(join(fixture.runs, attemptsOf(fixture.runs)[0]));
    expect(attempt.gatePlan).toMatchObject({ ok: false, status: "failed" });
    // The home it was measured under is the launch's own, under its scratch, and is named.
    expect(halt.reason).toContain(attempt.preparedState.home);
    expect(attempt.preparedState.home.startsWith(join(fixture.env.home, ".cache"))).toBe(true);
  });

  it("gives every launch a fresh home of its own, so what one launch installs is absent for the next", async () => {
    // Each fixture invocation writes a sentinel into the home it was given and counts the
    // sentinels already there. Under one shared home (the pilot's) the second launch finds the
    // first's; here every launch finds none, and the four homes are four directories.
    const fixture = await setup();
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(0);
    expect(halts(fixture.runs)).toEqual([]);
    const lines = launchLines(fixture.env);
    expect(lines).toHaveLength(4);
    const homes = lines.map((line) => /home=(\S+)/.exec(line)?.[1]);
    expect(new Set(homes).size).toBe(4);
    for (const line of lines) expect(line).toContain("found=0");
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      expect(homes).toContain(record.preparedState.home);
      expect(record.preparedState).toMatchObject({
        fresh: true,
        browserCacheBefore: false,
        browserCacheAfter: false,
      });
      expect(record.preparedState.npmCache).toContain("content-addressed");
      if (record.arm === "swarm")
        expect(record.gatePlan).toMatchObject({
          ok: true,
          expected: "node test/run.mjs",
          effective: "node test/run.mjs",
          status: "passed",
        });
      else expect(record.gatePlan).toBeUndefined();
      // The home went with the launch's scratch: nothing of it reaches a later launch.
      expect(existsSync(record.preparedState.home)).toBe(false);
    }
  });

  it("completes a healthy campaign, records every cell once, and leaves no lock or scratch behind", async () => {
    const fixture = await setup();
    const result = await runRunner(fixture.env, fixture.path);
    expect(result.code).toBe(0);
    expect(halts(fixture.runs)).toEqual([]);
    expect(recordsOf(fixture.runs)).toHaveLength(4);
    expect(launchLines(fixture.env)).toHaveLength(4);
    expect(corrections(fixture.env)).toBe(0);
    for (const name of recordsOf(fixture.runs)) {
      const record = readJson(join(fixture.runs, name));
      expect(record.hidden.verdict).toBe("pass");
      expect(record.resolvedVisible).toBe(true);
      expect(record.manifestDigest).toBe(fixture.digest);
    }
    expect(existsSync(join(fixture.runs, "runner.lock"))).toBe(false);
    expect(files(join(fixture.env.home, ".cache/swarm-comparison/work"))).toEqual([]);
    const again = await runRunner(fixture.env, fixture.path);
    expect(again.code).toBe(0);
    expect(launchLines(fixture.env)).toHaveLength(4);
  });
});
