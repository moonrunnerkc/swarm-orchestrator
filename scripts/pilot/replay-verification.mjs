/**
 * Verification replay of fixed patches through Swarm's ordinary goal-contract run, with no live
 * model: each patch is applied byte for byte to the task's base in a fresh checkout configured
 * exactly as a launch's workspace is (the visible check committed, the lockfile installed, the
 * harness's swarm.toml with the task's tests gate, the sealed contract the harness derives from
 * the frozen task), and a scripted model only declares the files the patch touches and claims
 * completion. What judges the tree is the product's own gates, its sealed acceptance gate and
 * its final independent verification, run from the command line as a launch runs them.
 *
 * Beside the product's verdict, each scenario is measured without it: the visible check and the
 * project's tests in a fresh checkout (the supervisor's reading), and the hidden oracle in a
 * separate scoring checkout that no solver or product run can see. The verdicts are kept apart,
 * each with what it covered.
 *
 *   node scripts/pilot/replay-verification.mjs --plan <plan.json> --out <dir> \
 *     --swarm-cli <dist/cli.js> --swarm-revision <commit>
 *
 * The plan names the task set, stage and task, the retained sessions whose sealed contract the
 * regenerated one must match, and the scenarios: `patch` (a retained patch, checked against the
 * record that names its digest), `base` (no change) or `reference` (the maintainer's change to
 * the task's authorized paths, scripts/pilot/reference.mjs).
 */
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { commandLog } from "../campaign/exec.mjs";
import { swarmContract, swarmResult, swarmTokenCap } from "../comparison/arms.mjs";
import { hiddenVerdict, patchedPaths, visibleVerdict } from "../comparison/checks.mjs";
import {
  applyPatch,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  installEnvironment,
  prepare,
  resolveFull,
  swarmConfigurationText,
} from "../comparison/workspace.mjs";
import { solverReference } from "./reference.mjs";
import { readSession } from "./swarm-session.mjs";
import { taskSet } from "./task-sets.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const out = args.get("out");
const swarmCli = args.get("swarm-cli");
const swarmRevision = args.get("swarm-revision");
const planPath = args.get("plan");
if (!out || !swarmCli || !swarmRevision || !planPath) {
  console.error(
    "usage: replay-verification.mjs --plan <plan.json> --out <dir> --swarm-cli <dist/cli.js> --swarm-revision <commit>",
  );
  process.exit(2);
}
const planBytes = readFileSync(planPath);
const plan = JSON.parse(planBytes.toString("utf8"));
const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function treeDigest(root) {
  const hash = createHash("sha256");
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else {
        hash.update(`${relative(root, path)}\n`);
        hash.update(readFileSync(path));
        hash.update("\n");
      }
    }
  };
  walk(root);
  return `sha256:${hash.digest("hex")}`;
}

const { stageTasks } = await taskSet(plan.set);
const task = stageTasks(plan.stage).find((one) => one.id === plan.task);
if (task === undefined)
  throw new Error(`${plan.task} is not in stage ${plan.stage} of ${plan.set}`);

const { freezeGoalContract } = await import(
  pathToFileURL(join(dirname(swarmCli), "evidence", "goal-contract.js")).href
);
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
);
// The contract the harness derives from the frozen task, which must be the one the retained
// launches were sealed under: the same visible criterion, nothing added from hidden material.
const contract = swarmContract(task);
const regenerated = freezeGoalContract(contract);
const sealedDigests = (plan.sealedFrom ?? []).map((path) => {
  const text = gunzipSync(readFileSync(path)).toString("utf8");
  const found = text.match(/sealed goal (sha256:[0-9a-f]{64})/);
  if (found === null) throw new Error(`${path} names no sealed goal digest`);
  return { path, digest: found[1] };
});
for (const sealed of sealedDigests)
  if (sealed.digest !== regenerated.digest)
    throw new Error(
      `the contract regenerated from the frozen task digests to ${regenerated.digest}; ${sealed.path} was sealed under ${sealed.digest}`,
    );

mkdirSync(out, { recursive: true });
const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);

async function candidateOf(scenario) {
  if (scenario.kind === "base") return { patch: "", source: "no change" };
  if (scenario.kind === "reference")
    return {
      patch: await solverReference(log, task, resolved.base, resolved.upstream),
      source: `the maintainer's change to ${task.hidden.allowedPaths.join(", ")}`,
    };
  const patch = readFileSync(scenario.patch, "utf8");
  const record = JSON.parse(readFileSync(scenario.record, "utf8"));
  if (
    digestOf(patch) !== record.finalPatchDigest ||
    Buffer.byteLength(patch) !== record.finalPatchBytes
  )
    throw new Error(`${scenario.patch} is not the patch ${scenario.record} names`);
  return {
    patch,
    source: scenario.patch,
    record: scenario.record,
    recordDigest: record.finalPatchDigest,
  };
}

const results = [];
for (const scenario of plan.scenarios) {
  const candidate = await candidateOf(scenario);
  const startedAt = Date.now();
  const scratch = mkdtempSync(join(comparisonRoot, "work", `replay-${scenario.id}-`));
  const workspace = join(scratch, "workspace");
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  let endpoint = null;
  try {
    await cloneAtBase(log, task, resolved.base, workspace);
    const base = await commitVisibleCheck(log, task, workspace);
    const prepared = await prepare(log, task, workspace);
    if (!prepared.ok) throw new Error(`${scenario.id}: preparation failed: ${prepared.detail}`);
    if (candidate.patch !== "" && !(await applyPatch(log, workspace, candidate.patch)))
      throw new Error(`${scenario.id}: the patch did not apply`);
    writeFileSync(
      join(workspace, "swarm.toml"),
      swarmConfigurationText("http://127.0.0.1:1/v1", task),
    );
    writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", {
      flag: "a",
    });
    const contractPath = join(scratch, "contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
    const touched = patchedPaths(candidate.patch);
    endpoint = await startScriptedEndpoint({
      modelId: "stub",
      turns: [
        {
          text: "Plan: the change is already in the working tree; declare it and finish.",
          toolCalls: [
            {
              name: "declare_file_set",
              input: {
                files: touched.length > 0 ? touched : (task.hidden.allowedPaths ?? []).slice(0, 1),
              },
            },
          ],
        },
        { text: "The change is in the working tree." },
      ],
    });
    // A launch's argv, as scripts/comparison/arms.mjs builds it, with the scripted endpoint.
    const argv = [
      "node",
      swarmCli,
      task.taskText.trim(),
      "--model",
      "local:stub",
      "--local-endpoint",
      endpoint.url,
      "--workspace",
      workspace,
      "--base",
      base,
      "--goal-contract",
      contractPath,
      ...(task.workType === "upgrade" ? ["--preset", "upgrade"] : []),
      "--install",
      "--lockfile",
      "package-lock.json",
      "--max-tokens",
      String(swarmTokenCap),
      "--max-wall-minutes",
      "15",
      "--approve",
      "auto",
      "--no-tui",
      "--no-open-evidence",
      "--json",
    ];
    const ran = await log.run(argv, {
      cwd: workspace,
      timeoutMs: 20 * 60_000,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        NO_COLOR: "1",
        ...Object.fromEntries(
          Object.entries(installEnvironment()).filter(
            ([name]) => name.startsWith("npm_config_") || name === "PUPPETEER_SKIP_DOWNLOAD",
          ),
        ),
      },
    });
    const productMs = Date.now() - startedAt;
    const stdout = ran.stdout.toString();
    const stderr = ran.stderr.toString();
    const result = swarmResult(stdout);
    const sessionDirectory = result?.bundleDirectory ? join(result.bundleDirectory, "..") : null;
    const session = sessionDirectory === null ? null : readSession(sessionDirectory);
    // Measured without the product: the supervisor's visible reading and, apart, the oracle.
    const visible = await visibleVerdict(log, task, resolved.base, candidate.patch);
    const oracle = await hiddenVerdict(
      log,
      task,
      resolved.base,
      resolved.upstream,
      candidate.patch,
      {
        executeEmpty: true,
      },
    );
    const scenarioOut = join(out, "scenarios", scenario.id);
    mkdirSync(scenarioOut, { recursive: true });
    if (scenario.kind !== "patch")
      writeFileSync(join(scenarioOut, "candidate.patch"), candidate.patch);
    writeFileSync(join(scenarioOut, "stdout.txt.gz"), gzipSync(stdout));
    writeFileSync(join(scenarioOut, "stderr.txt.gz"), gzipSync(stderr));
    if (sessionDirectory !== null) {
      writeFileSync(
        join(scenarioOut, "ledger.jsonl.gz"),
        gzipSync(readFileSync(join(sessionDirectory, "ledger.jsonl"))),
      );
      for (const payload of session.retainedPayloads)
        writeFileSync(
          join(scenarioOut, `${payload.digest.slice(7)}.json.gz`),
          gzipSync(payload.bytes),
        );
    }
    results.push({
      id: scenario.id,
      kind: scenario.kind,
      purpose: scenario.purpose,
      candidate: {
        source: candidate.source,
        record: candidate.record ?? null,
        patchDigest: candidate.patch === "" ? null : digestOf(candidate.patch),
        patchBytes: Buffer.byteLength(candidate.patch),
        paths: touched,
      },
      base,
      visible: {
        passed: visible.passed,
        checkExit: visible.checkExit,
        projectTestExit: visible.projectTestExit,
        covers: `${task.visible.command}; then ${task.projectTest.join(" ")}`,
        detailDigest: digestOf(visible.detail),
        detailTail: visible.detail.split("\n").slice(-12).join("\n"),
      },
      swarm: {
        exitCode: ran.exitCode,
        signal: ran.signal ?? null,
        acceptable: result?.verdict?.acceptable ?? null,
        verdict: result?.verdict ?? null,
        finalVerification: result?.outcome?.finalVerification ?? null,
        requirements: result?.outcome?.requirements ?? null,
        covers: {
          sealedRequirements: contract.requirements.map((one) => `${one.id}: ${one.description}`),
          sealedChecks: contract.checks.map((one) => `${one.id}: ${one.command}`),
          sealedGates: session?.sealedGates ?? [],
        },
        sessionId: result?.runId ?? null,
        contractDigest: session?.contractDigest ?? null,
        sealedTestsGate: session?.sealedTestsGate ?? null,
        independentVerification: session?.lastVerification ?? null,
        timing: { productRunMs: productMs, ...(session?.timing ?? {}) },
        stdoutDigest: digestOf(stdout),
        stderrDigest: digestOf(stderr),
      },
      hidden: {
        verdict: oracle.verdict,
        basis: oracle.basis,
        covers: `the upstream commit's ${task.hidden.testFiles.join(", ") || "suite"} (${task.hidden.argv.join(" ")})${task.hidden.allowedPaths ? `, the authorized paths ${task.hidden.allowedPaths.join(", ")}` : ""}${(task.hidden.structural ?? []).length ? ", the structural counts" : ""}${(task.hidden.upgrade ?? []).length ? ", the locked, installed and declared versions" : ""}, and the project tests`,
        detailTail: (oracle.detail ?? "").split("\n").slice(-30).join("\n"),
      },
    });
    console.log(
      `${scenario.id}: swarm exit ${ran.exitCode} acceptable ${result?.verdict?.acceptable ?? "none"} (final verification ${session?.timing?.finalVerificationMs ?? "?"} ms, run ${productMs} ms); visible ${visible.passed}; hidden ${oracle.verdict} (${oracle.basis})`,
    );
  } finally {
    if (endpoint !== null) await endpoint.close();
    if (args.get("keep") !== "true") rmSync(scratch, { recursive: true, force: true });
  }
}

const manifest = {
  schema: "swarm-verification-replay.v2",
  recordedAt: new Date().toISOString(),
  purpose: plan.purpose,
  plan: { path: planPath, digest: digestOf(planBytes) },
  product: {
    sourceCommit: swarmRevision,
    cli: swarmCli,
    cliDigest: digestOf(readFileSync(swarmCli)),
    distTreeDigest: treeDigest(dirname(swarmCli)),
    node: process.version,
    platform: process.platform,
  },
  task: {
    id: task.id,
    set: plan.set,
    stage: plan.stage,
    repository: task.repository,
    base: resolved.base,
    upstream: resolved.upstream,
    projectTest: task.projectTest,
  },
  contract: {
    regeneratedDigest: regenerated.digest,
    sealedInRetainedSessions: sealedDigests,
  },
  model:
    "scripted endpoint (src/providers/scripted-endpoint.ts): declares the patch's files and claims completion; generates no code",
  scenarios: results,
  harnessCommands: log.commands.length,
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(out, "harness-commands.json.gz"),
  gzipSync(JSON.stringify(log.commands, null, 1)),
);
console.log(`wrote ${join(out, "manifest.json")}`);
