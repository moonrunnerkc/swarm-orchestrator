/**
 * Verification replay of a known patch: the retained chai feature patch, applied byte for byte
 * to the recorded base in a fresh checkout, judged by the product's ordinary goal-contract run
 * with a scripted model that only declares the file set and claims completion. No live model
 * generates anything; what runs is the product's own gates, its sealed acceptance gate and its
 * final independent verification, wired from the workspace's swarm.toml through the command
 * line exactly as a normal run is. Beside the replay, three controls: the unchanged base, a
 * deliberately wrong candidate, and the same valid patch with the tests override withheld so
 * the manifest's browser suite is what the verification would have to run.
 *
 *   node scripts/pilot/replay-feature-verification.mjs --out docs/evidence/<date>/verification-replay \
 *     --swarm-cli <dist/cli.js> --swarm-revision <commit>
 *
 * Reads the frozen task (scripts/pilot/amendments.mjs), the retained patch and record, and the
 * published session's gate runs for the sealed contract digest; needs the local mirror of the
 * repository the comparison harness keeps, and network for the checkout's dependencies.
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
import { swarmContract, swarmResult } from "../comparison/arms.mjs";
import { hiddenVerdict } from "../comparison/checks.mjs";
import {
  applyPatch,
  browserCacheIn,
  cloneAtBase,
  commitVisibleCheck,
  comparisonRoot,
  installEnvironment,
  prepare,
  resolveFull,
  swarmConfigurationText,
  workRoot,
} from "../comparison/workspace.mjs";
import { developmentTasks } from "./amendments.mjs";
import { readStageRecord } from "./stage-files.mjs";
import { readSession } from "./swarm-session.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const out = args.get("out");
const swarmCli = args.get("swarm-cli");
const swarmRevision = args.get("swarm-revision");
if (!out || !swarmCli || !swarmRevision) {
  console.error(
    "usage: replay-feature-verification.mjs --out <dir> --swarm-cli <dist/cli.js> --swarm-revision <commit>",
  );
  process.exit(2);
}

const taskId = "chai-feature-deep-contain-oneof-dev";
const retainedRoot = "docs/evidence/2026-10-14/real-task-pilot/development/dev";
const retainedSession = "20261015T050949-5dce50";
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

// The retained inputs, each checked against the record that names it.
const task = developmentTasks("dev").find((one) => one.id === taskId);
if (task === undefined) throw new Error(`frozen task ${taskId} is not in the development stage`);
const record = JSON.parse(readStageRecord(join(retainedRoot, "records", `${taskId}.swarm.json`)));
const patch = readFileSync(join(retainedRoot, "patches", `${taskId}.swarm.patch`), "utf8");
if (digestOf(patch) !== record.finalPatchDigest)
  throw new Error(
    `the retained patch digests to ${digestOf(patch)}, not the record's ${record.finalPatchDigest}`,
  );
if (Buffer.byteLength(patch) !== record.finalPatchBytes)
  throw new Error("the retained patch's size differs from the record's");
const gateRuns = JSON.parse(
  gunzipSync(
    readFileSync(join(retainedRoot, "sessions", retainedSession, "gate-runs.json.gz")),
  ).toString("utf8"),
);
const sealedTitle = JSON.stringify(gateRuns).match(/sealed goal (sha256:[0-9a-f]{64})/);
if (sealedTitle === null) throw new Error("the retained gate runs name no sealed goal digest");
const sealedDigest = sealedTitle[1];

const { freezeGoalContract } = await import(
  pathToFileURL(join(dirname(swarmCli), "evidence", "goal-contract.js")).href
);
const { startScriptedEndpoint } = await import(
  pathToFileURL(join(dirname(swarmCli), "providers", "scripted-endpoint.js")).href
);
const contract = swarmContract(task);
const regenerated = freezeGoalContract(contract);
if (regenerated.digest !== sealedDigest)
  throw new Error(
    `the contract regenerated from the frozen task digests to ${regenerated.digest}; the run was sealed under ${sealedDigest}`,
  );

mkdirSync(out, { recursive: true });
// Harness command output goes to the comparison cache, as the pilot kept it; the manifest names each digest.
const log = commandLog(join(comparisonRoot, "blobs"));
const resolved = await resolveFull(log, task);

/** The wrong candidate: the valid patch with its deep comparison replaced by "always contained". */
function wrongCandidate(valid) {
  const replaced = valid.replace(
    "            return eql(element, possibility);",
    "            return true;",
  );
  if (replaced === valid)
    throw new Error("the wrong candidate could not be derived from the patch");
  return replaced;
}

const scenarios = [
  {
    id: "retained-patch",
    purpose: "the retained correct patch under the run's sealed gates",
    patch,
    override: true,
    expected:
      "acceptable: exit 0, the sealed tests gate npm run test-node and the final verification both pass",
  },
  {
    id: "unchanged-base",
    purpose: "control: the base with no change, judged by the same sealed criteria",
    patch: "",
    override: true,
    expected: "not acceptable: the visible check is rejected on the base",
  },
  {
    id: "wrong-candidate",
    purpose: "control: a candidate whose deep form accepts everything",
    patch: null,
    override: true,
    expected: "not acceptable: the visible check's negative case is rejected",
  },
  {
    id: "override-withheld",
    purpose:
      "control: the retained patch with no tests override, so the manifest's browser suite is the tests gate",
    patch,
    override: false,
    expected:
      "not acceptable, and never a pass: the tests gate is unavailable in a clean HOME, so the run is unmeasured",
  },
];

const results = [];
for (const scenario of scenarios) {
  const startedAt = Date.now();
  mkdirSync(workRoot, { recursive: true });
  const scratch = mkdtempSync(join(workRoot, `replay-${scenario.id}-`));
  const workspace = join(scratch, "workspace");
  const home = join(scratch, "home");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  let endpoint = null;
  try {
    await cloneAtBase(log, task, resolved.base, workspace);
    const base = await commitVisibleCheck(log, task, workspace);
    const prepared = await prepare(log, task, workspace);
    if (!prepared.ok) throw new Error(`${scenario.id}: preparation failed: ${prepared.detail}`);
    const candidate = scenario.patch === null ? wrongCandidate(patch) : scenario.patch;
    if (scenario.id === "wrong-candidate")
      writeFileSync(join(out, "wrong-candidate.patch"), candidate);
    if (candidate !== "" && !(await applyPatch(log, workspace, candidate)))
      throw new Error(`${scenario.id}: the patch did not apply`);
    // The same configuration the harness writes for a Swarm arm, or one with no [gates] table.
    const configuration = scenario.override
      ? swarmConfigurationText("http://127.0.0.1:1/v1", task)
      : "[providers]\nlocal_thinking = false\n";
    writeFileSync(join(workspace, "swarm.toml"), configuration);
    writeFileSync(join(workspace, ".git", "info", "exclude"), "swarm.toml\n.swarm/\n", {
      flag: "a",
    });
    const contractPath = join(scratch, "contract.json");
    writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

    endpoint = await startScriptedEndpoint({
      modelId: "stub",
      turns: [
        {
          text: "Plan: the change is already in the working tree; declare it and finish.",
          toolCalls: [
            { name: "declare_file_set", input: { files: ["lib/chai/core/assertions.js"] } },
          ],
        },
        { text: "The deep form of contain.oneOf is implemented in lib/chai/core/assertions.js." },
      ],
    });
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
      "--install",
      "--lockfile",
      "package-lock.json",
      "--max-tokens",
      "600000",
      "--max-wall-minutes",
      "19",
      "--approve",
      "auto",
      "--no-tui",
      "--no-open-evidence",
      "--json",
    ];
    const browsersBefore = browserCacheIn(home);
    const ran = await log.run(argv, {
      cwd: workspace,
      timeoutMs: 25 * 60_000,
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
    const stdout = ran.stdout.toString();
    const stderr = ran.stderr.toString();
    const result = swarmResult(stdout);
    const sessionDirectory = result?.bundleDirectory ? join(result.bundleDirectory, "..") : null;
    const session = sessionDirectory === null ? null : readSession(sessionDirectory);
    // The child HOME the run allocated for itself: fresh, and holding no browser afterwards.
    const childHome = session?.envelope?.childHome ?? null;
    const oracle =
      candidate === ""
        ? null
        : await hiddenVerdict(log, task, resolved.base, resolved.upstream, candidate);
    const scenarioOut = join(out, "scenarios", scenario.id);
    mkdirSync(scenarioOut, { recursive: true });
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
      purpose: scenario.purpose,
      expected: scenario.expected,
      base,
      patchDigest: candidate === "" ? null : digestOf(candidate),
      override: scenario.override ? task.projectTest.join(" ") : null,
      exitCode: ran.exitCode,
      signal: ran.signal ?? null,
      wallMs: Date.now() - startedAt,
      verdict: result?.verdict ?? null,
      finalVerification: result?.outcome?.finalVerification ?? null,
      requirements: result?.outcome?.requirements ?? null,
      sessionId: result?.runId ?? null,
      contractDigest: session?.contractDigest ?? null,
      sealedTestsGate: session?.sealedTestsGate ?? null,
      childHome,
      childHomeState: session?.envelope?.childHomeState ?? null,
      childHomeHeldBrowsersBefore: browsersBefore,
      childHomeHeldBrowsersAfter: childHome === null ? null : browserCacheIn(childHome),
      operatorHomeHeldBrowsersAfter: browserCacheIn(home),
      independentVerification: session?.lastVerification ?? null,
      hiddenOracle: oracle,
      stdoutDigest: digestOf(stdout),
      stderrDigest: digestOf(stderr),
    });
    console.log(
      `${scenario.id}: exit ${ran.exitCode}, acceptable ${result?.verdict?.acceptable ?? "none"}, regression ${result?.outcome?.finalVerification?.regression ?? "none"}, unmeasured ${result?.outcome?.finalVerification?.unmeasured ?? "none"}, oracle ${oracle?.verdict ?? "n/a"}`,
    );
  } finally {
    if (endpoint !== null) await endpoint.close();
    if (args.get("keep") !== "true") rmSync(scratch, { recursive: true, force: true });
  }
}

const manifest = {
  schema: "swarm-feature-verification-replay.v1",
  recordedAt: new Date().toISOString(),
  purpose:
    "verification replay of a known patch through the product's ordinary goal-contract run, with controls; not a new autonomous task delivery",
  product: {
    sourceCommit: swarmRevision,
    cli: swarmCli,
    cliDigest: digestOf(readFileSync(swarmCli)),
    distTreeDigest: treeDigest(dirname(swarmCli)),
    node: process.version,
    platform: process.platform,
  },
  task: {
    id: taskId,
    repository: task.repository,
    base: resolved.base,
    upstream: resolved.upstream,
    projectTest: task.projectTest,
  },
  retained: {
    record: `${retainedRoot}/records/${taskId}.swarm.json`,
    patch: `${retainedRoot}/patches/${taskId}.swarm.patch`,
    patchDigest: record.finalPatchDigest,
    patchBytes: record.finalPatchBytes,
    session: retainedSession,
    sealedContractDigest: sealedDigest,
    regeneratedContractDigest: regenerated.digest,
  },
  model:
    "scripted endpoint (src/providers/scripted-endpoint.ts): declares the file set and claims completion; generates no code",
  scenarios: results,
  harnessCommands: log.commands.length,
};
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  join(out, "harness-commands.json.gz"),
  gzipSync(JSON.stringify(log.commands, null, 1)),
);
console.log(`wrote ${join(out, "manifest.json")}`);
