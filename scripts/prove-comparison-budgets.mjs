/**
 * The comparison's budgets as the real product receives and seals them, before any model
 * inference is spent: the proved runner (`scripts/comparison/run.mjs`) dispatches the pinned
 * Swarm build against a scripted endpoint on a disposable task whose model writes a wrong fix,
 * so the supervisor corrects it twice. Each Swarm session's own sealed run spec is read back and
 * held against what the launcher computed: the token allowance of every invocation is the
 * launch's cap less what the earlier invocations spent, internal repairs inside an invocation
 * draw on that one allowance, and the wall each invocation was given ends the declared
 * verification reserve before the launch's deadline.
 *
 *   node scripts/prove-comparison-budgets.mjs --swarm-cli <dist/cli.js> --out <dir>
 *
 * Runs under a temporary HOME, so the comparison root, the records and the sessions are its own.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { digestOf, minimumCorrectionMs } from "./comparison/arms.mjs";
import { harnessDigest } from "./comparison/harness-identity.mjs";
import { launches } from "./comparison/order.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const swarmCli = args.get("swarm-cli");
const out = args.get("out");
if (!swarmCli || !out) {
  console.error("usage: prove-comparison-budgets.mjs --swarm-cli <dist/cli.js> --out <dir>");
  process.exit(2);
}

const git = (cwd, ...words) => {
  const ran = spawnSync(
    "git",
    ["-c", "user.name=fixture", "-c", "user.email=fixture@localhost", ...words],
    { cwd, encoding: "utf8" },
  );
  if (ran.status !== 0) throw new Error(`git ${words.join(" ")}: ${ran.stderr}`);
  return ran.stdout.trim();
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const home = mkdtempSync(join(tmpdir(), "comparison-budgets-"));
try {
  // A task whose base subtracts where it should add, with a lockfile so the product's own
  // fresh-checkout install has something to install from.
  const source = join(home, "source");
  mkdirSync(join(source, "test"), { recursive: true });
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify({ name: "calc", version: "1.0.0", type: "module", scripts: { test: "node test/run.mjs" } })}\n`,
  );
  writeFileSync(
    join(source, "package-lock.json"),
    `${JSON.stringify({ name: "calc", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "calc", version: "1.0.0" } } }, null, 2)}\n`,
  );
  writeFileSync(join(source, "calc.mjs"), "export const add = (a, b) => a - b;\n");
  writeFileSync(
    join(source, "test/run.mjs"),
    'import { add } from "../calc.mjs";\nif (typeof add !== "function") process.exit(1);\n',
  );
  git(source, "init", "-q");
  git(source, "add", "--all");
  git(source, "commit", "-qm", "base");
  const base = git(source, "rev-parse", "HEAD");
  writeFileSync(join(source, "calc.mjs"), "export const add = (a, b) => a + b;\n");
  git(source, "commit", "-qam", "fix add");
  const upstream = git(source, "rev-parse", "HEAD");
  const mirror = join(home, ".cache/swarm-comparison/mirrors/fixture__calc.git");
  mkdirSync(dirname(mirror), { recursive: true });
  git(source, "clone", "--quiet", "--bare", source, mirror);

  // The scripted model, in a process of its own so the runner watches it as it watches a server:
  // it declares the file, writes a wrong fix and claims completion; every later call (the
  // product's repairs and the supervisor's corrections) gets the endpoint's closing text.
  const spend = { promptTokens: 2_000, completionTokens: 50 };
  const turns = [
    {
      text: "Plan: fix add in calc.mjs.",
      toolCalls: [{ name: "declare_file_set", input: { files: ["calc.mjs"] } }],
      usage: spend,
    },
    {
      toolCalls: [
        {
          name: "write",
          input: { path: "calc.mjs", content: "export const add = (a, b) => a * b;\n" },
        },
      ],
      usage: spend,
    },
    { text: "add is fixed.", usage: spend },
  ];
  const ready = join(home, "endpoint.json");
  const server = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      [
        "import { writeFileSync } from 'node:fs';",
        `const { startScriptedEndpoint } = await import(${JSON.stringify(join(dirname(swarmCli), "providers", "scripted-endpoint.js"))});`,
        `const endpoint = await startScriptedEndpoint({ modelId: "stub", turns: ${JSON.stringify(turns)} });`,
        `writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ url: endpoint.url, pid: process.pid }));`,
        "setInterval(() => {}, 1 << 30);",
      ].join("\n"),
    ],
    { stdio: "ignore", detached: true },
  );
  for (let waited = 0; !existsSync(ready); waited += 100) {
    if (waited > 20_000) throw new Error("the scripted endpoint did not start");
    await sleep(100);
  }
  const endpoint = JSON.parse(readFileSync(ready, "utf8"));

  const task = {
    id: "calc-fix-add",
    repository: "fixture/calc",
    workType: "bugfix",
    baseCommit: base,
    upstreamCommit: upstream,
    install: [["npm", "ci", "--ignore-scripts"]],
    build: [],
    projectTest: ["npm", "test"],
    visiblePrefix: "",
    visible: {
      path: "acceptance/visible/check.mjs",
      command: "node acceptance/visible/check.mjs",
      source:
        'import { add } from "../../calc.mjs";\nif (add(2, 3) !== 5) { console.error("add(2, 3) is " + add(2, 3)); process.exit(1); }\n',
    },
    hidden: { testFiles: [], argv: ["node", "acceptance/visible/check.mjs"] },
    immutable: ["test"],
    taskText: "add(a, b) in calc.mjs subtracts instead of adding; make it add.",
  };
  const opencode = spawnSync("opencode", ["--version"], { encoding: "utf8" }).stdout.trim();
  const budgets = {
    wallMsPerInvocation: 15 * 60_000,
    wallGraceMs: 60_000,
    swarmTokenCap: 40_000,
    swarmVerificationReserveMs: 60_000,
    maxCorrections: 2,
  };
  const manifest = {
    schema: "swarm-ordinary-comparison.manifest.v1",
    frozenAt: new Date().toISOString(),
    protocolDigest: null,
    purpose: "budget proof: the pinned Swarm build under the proved runner with a scripted model",
    prerequisites: { browsers: false },
    pins: {
      model: "stub",
      endpoint: endpoint.url,
      swarmCli,
      swarmRevision: readFileSync(join(dirname(swarmCli), "..", "REVISION"), "utf8").trim(),
      swarmCliDigest: digestOf(readFileSync(swarmCli)),
      opencode,
      node: process.version,
      harnessDigest: harnessDigest(),
    },
    budgets,
    seed: "budget-proof",
    tasks: [task],
    launches: launches([task.id]),
  };
  const manifestPath = join(home, "manifest.json");
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(manifestPath, manifestText);
  const runner = spawnSync(
    process.execPath,
    [
      join(import.meta.dirname, "comparison", "run.mjs"),
      "--manifest",
      manifestPath,
      "--arm",
      "swarm",
    ],
    { env: { ...process.env, HOME: home }, encoding: "utf8", timeout: 30 * 60_000 },
  );
  try {
    process.kill(-server.pid, "SIGKILL");
  } catch {}
  const runs = join(home, ".cache/swarm-comparison/runs", digestOf(manifestText).slice(7, 23));
  const recordPath = join(runs, `${task.id}.swarm.json`);
  if (!existsSync(recordPath))
    throw new Error(
      `no record was written (runner exit ${runner.status}):\n${runner.stdout}\n${runner.stderr}`,
    );
  const record = JSON.parse(readFileSync(recordPath, "utf8"));

  // What each Swarm session sealed, and what its loops spent, from its own chain.
  const blob = (digest) =>
    readFileSync(join(home, ".cache/swarm-comparison/blobs", digest.slice(7))).toString("utf8");
  const sessions = record.invocations.map((invocation) => {
    const stdout = blob(invocation.stdoutDigest);
    const result = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .find((line) => line.schema === "swarm.result.v1");
    const directory = join(home, ".swarm/sessions", result.runId);
    const ledger = readFileSync(join(directory, "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const payload = (entry) =>
      JSON.parse(
        readFileSync(join(directory, "blobs", `${entry.payloadDigest.slice(7)}.json`), "utf8"),
      );
    const spec = payload(ledger.find((entry) => entry.type === "run-spec-sealed")).spec;
    const loops = stdout
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line))
      .filter((line) => line.schema === "swarm.event.v1" && line.event?.type === "stopped")
      .map((line) => ({
        reason: line.event.reason,
        tokensUsed: line.event.tokensUsed,
        callsWithUnknownUsage: line.event.callsWithUnknownUsage ?? null,
      }));
    return {
      kind: invocation.kind,
      runId: result.runId,
      allowanceLaunched: invocation.tokenAllowance,
      maxWallMinutesFlag: Number(
        invocation.argv[invocation.argv.indexOf("--max-wall-minutes") + 1],
      ),
      sealed: spec.budgets,
      loops,
      spent: invocation.tokens,
      wallMs: invocation.wallMs,
      exitCode: invocation.exitCode,
    };
  });

  // The checks, each a sentence with its observed values.
  const checks = [];
  const check = (claim, holds, observed) => checks.push({ claim, holds, observed });
  let spentBefore = 0;
  for (const [index, session] of sessions.entries()) {
    check(
      `invocation ${index} was launched with the cap less what the earlier invocations spent`,
      session.allowanceLaunched === budgets.swarmTokenCap - spentBefore,
      { cap: budgets.swarmTokenCap, spentBefore, launched: session.allowanceLaunched },
    );
    check(
      `invocation ${index}'s own session sealed exactly that allowance`,
      session.sealed.maxTokens === session.allowanceLaunched,
      { sealed: session.sealed.maxTokens },
    );
    check(
      `invocation ${index}'s loops (implementation and every internal repair) spent no more than its one allowance`,
      session.loops.reduce((sum, loop) => sum + loop.tokensUsed, 0) <= session.sealed.maxTokens,
      { loops: session.loops },
    );
    check(
      `invocation ${index}'s wall ends the verification reserve before the launch's deadline, and its implementation wall keeps the product's own thirty seconds`,
      session.sealed.maxWallMs <= session.maxWallMinutesFlag * 60_000 - 30_000 &&
        session.maxWallMinutesFlag * 60_000 <=
          budgets.wallMsPerInvocation - budgets.swarmVerificationReserveMs,
      { flagMinutes: session.maxWallMinutesFlag, sealedWallMs: session.sealed.maxWallMs },
    );
    check(
      `invocation ${index} reported every call's usage`,
      session.loops.every((loop) => loop.callsWithUnknownUsage === 0),
      {},
    );
    spentBefore += session.spent ?? 0;
  }
  check("the supervisor corrected the wrong fix twice", record.corrections === 2, {
    corrections: record.corrections,
  });
  check(
    "a correction started only with a minute and the verification reserve left",
    record.invocations.every((one) => one.signal === null),
    { minimumCorrectionMs, reserveMs: budgets.swarmVerificationReserveMs },
  );
  check("the cleanup measured nothing left running", record.cleanup.strays.length === 0, {
    cleanup: record.cleanup,
  });

  mkdirSync(out, { recursive: true });
  const proof = {
    schema: "swarm-comparison-budget-proof.v1",
    recordedAt: new Date().toISOString(),
    product: {
      cli: swarmCli,
      revision: manifest.pins.swarmRevision,
      cliDigest: manifest.pins.swarmCliDigest,
    },
    harnessDigest: manifest.pins.harnessDigest,
    budgets,
    runner: { exitCode: runner.status, stderrTail: runner.stderr.split("\n").slice(-5).join("\n") },
    record: {
      digest: `sha256:${createHash("sha256").update(readFileSync(recordPath)).digest("hex")}`,
      corrections: record.corrections,
      invocations: record.invocations.map(
        ({ kind, tokens, tokenAllowance, usage, wallMs, exitCode, termination }) => ({
          kind,
          tokens,
          tokenAllowance,
          usage,
          wallMs,
          exitCode,
          termination,
        }),
      ),
      cleanup: record.cleanup,
      notes: record.notes,
    },
    sessions,
    checks,
    holds: checks.every((one) => one.holds),
  };
  writeFileSync(join(out, "budget-proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
  for (const one of checks) console.log(`${one.holds ? "holds " : "FAILS "} ${one.claim}`);
  console.log(`wrote ${join(out, "budget-proof.json")}`);
  process.exitCode = proof.holds ? 0 : 1;
} finally {
  rmSync(home, { recursive: true, force: true });
}
