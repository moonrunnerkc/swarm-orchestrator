#!/usr/bin/env node
/**
 * Run campaign launches from a frozen manifest, one at a time, resumably, never overwriting.
 *
 *   node scripts/campaign/launch.mjs run <launch id> --manifest <file>
 *   node scripts/campaign/launch.mjs next --manifest <file> [--set development] [--comparison A|B]
 *     [--arm <arm>] [--limit <n>]
 *   node scripts/campaign/launch.mjs status --manifest <file>
 *
 * Each attempt writes `runs/<manifest digest>/<launch id>/attempt-<n>.json` exclusively. A launch
 * whose latest attempt reached a decision is done and is skipped. An attempt that failed for
 * infrastructure (the model endpoint stopped, the container runtime failed, the host ran low on
 * memory) is kept and may be rerun, up to the manifest's infrastructure rerun limit; its failed
 * attempt stays beside the rerun. Nothing here reads a result to decide whether to run again.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { asJsonValue, digestOfBytes, digestOfJson } from "../../src/evidence/canonical-json.ts";
import { runComparisonA } from "./arms-a.mjs";
import { runComparisonB } from "./arms-b.mjs";
import { commandLog } from "./exec.mjs";
import { loadGoalPackage } from "./goal-package.mjs";
import { launchRecordSchema, manifestSchema } from "./schema.mjs";
import { scoreHidden, sealedRoot } from "./truth.mjs";
import { campaignRoot } from "./workspace.mjs";

/**
 * The contract every swarm-verify arm is handed: the visible contract with the reference patch
 * sealed as each requirement's `challenges.references`, which the product's strengthening needs
 * to justify an admitted check. It is harness material; no agent prompt carries it, and the copy
 * plain CI and VERA keep in the tree has it removed.
 */
export function campaignContract(loaded) {
  const { contract, patches } = loaded;
  return {
    ...contract,
    challenges: {
      version: 1,
      mutations: contract.challenges?.mutations ?? "auto",
      fixtures: contract.challenges?.fixtures ?? [],
      references: contract.requirements.map((requirement) => ({
        id: `reference-${requirement.id}`.slice(0, 64),
        requirement: requirement.id,
        description: "the goal's correct reference implementation",
        patch: patches.get("reference"),
      })),
    },
  };
}

/** Attempts already on disk for a launch, oldest first. */
export function attemptsOf(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => /^attempt-\d+\.json$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")));
}

/** Whether a launch still needs an attempt, by the registered retry rule alone. */
export function nextAttempt(attempts, infrastructureReruns) {
  const last = attempts.at(-1);
  if (last === undefined) return 1;
  if (last.decision !== "infrastructure-failure") return null;
  const failures = attempts.filter((one) => one.decision === "infrastructure-failure").length;
  return failures > infrastructureReruns ? null : attempts.length + 1;
}

function freeMemoryPercent() {
  try {
    const line = execFileSync("memory_pressure", { encoding: "utf8" }).trim().split("\n").at(-1);
    return Number(/(\d+)%/.exec(line)?.[1] ?? "100");
  } catch {
    return 100;
  }
}

async function endpointAnswers(endpoint) {
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, "")}/models`, {
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runLaunch(manifest, manifestDigest, launch) {
  const directory = join(campaignRoot, "runs", manifestDigest.slice(7, 23), launch.id);
  const attempts = attemptsOf(directory);
  const attempt = nextAttempt(attempts, manifest.budgets.infrastructureReruns);
  if (attempt === null) return { skipped: true, record: attempts.at(-1) };
  mkdirSync(directory, { recursive: true });
  // A fresh directory per attempt, never one an earlier or interrupted attempt left behind.
  mkdirSync(join(campaignRoot, "work"), { recursive: true });
  const scratch = mkdtempSync(join(campaignRoot, "work", `${launch.id}.attempt-${attempt}-`));
  const log = commandLog(join(campaignRoot, "blobs"));
  const loaded = loadGoalPackage(join(campaignRoot, "goals", launch.goal), { sealedRoot });
  const contractPath = join(scratch, "contract.json");
  writeFileSync(contractPath, `${JSON.stringify(campaignContract(loaded), null, 2)}\n`);
  const context = {
    log,
    loaded,
    scratch,
    pins: manifest.pins,
    contractPath,
    budget: manifest.budgets,
    kill: {},
    wall: new AbortController(),
    notes: [],
    tokensTotal: 0,
    tokensUnknown: false,
    remaining: {
      tokens: manifest.budgets.tokens,
      agentMs: manifest.budgets.launchWallMs - manifest.budgets.finalVerificationReserveMs,
    },
  };
  const startedAt = new Date();
  let outcome;
  let truth = null;
  const modelDriven = launch.comparison === "B";
  try {
    if (freeMemoryPercent() < 25) throw new InfrastructureError("free memory under 25%");
    if (modelDriven && !(await endpointAnswers(manifest.pins.endpoint)))
      throw new InfrastructureError("the model endpoint does not answer");
    // The launch wall cap covers the agent, its repairs and the arm's own verification.
    context.kill = { signal: context.wall.signal };
    const deadline = setTimeout(() => context.wall.abort(), manifest.budgets.launchWallMs);
    try {
      outcome =
        launch.comparison === "A"
          ? await runComparisonA(context, launch)
          : await runComparisonB(context, launch);
    } finally {
      clearTimeout(deadline);
    }
    if (modelDriven && !(await endpointAnswers(manifest.pins.endpoint)))
      throw new InfrastructureError("the model endpoint stopped answering during the launch");
    if (launch.comparison === "A") {
      const condition = loaded.goal.conditions.find((one) => one.id === launch.condition);
      truth = { condition: condition.truth, hiddenOracle: "not-run" };
      context.notes.push("condition truth established by deterministic validation before freeze");
    } else {
      const scored = await scoreHidden(log, loaded.goal, outcome.patch);
      truth = {
        hiddenOracle: scored.hidden,
        finalPatchDigest: digestOfBytes(outcome.patch),
      };
      context.notes.push(`hidden oracle: ${scored.basis}`);
    }
  } catch (cause) {
    // An exception is the harness or the machine failing, never an arm deciding: an arm's
    // decision, inconclusive included, always returns. It is rerun under the registered rule.
    outcome = {
      decision: "infrastructure-failure",
      basis: `${cause instanceof InfrastructureError ? "infrastructure" : "harness"}: ${cause.message}`,
    };
  }
  const endedAt = new Date();
  const record = launchRecordSchema.parse({
    schema: "swarm-campaign.launch-record.v1",
    launch: launch.id,
    attempt,
    manifestDigest,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    wallMs: endedAt.getTime() - startedAt.getTime(),
    host: { platform: platform(), arch: arch(), node: process.version },
    versions: { swarmRevision: manifest.pins.swarmRevision, model: manifest.pins.model },
    inputs: {
      contract: digestOfJson(asJsonValue(campaignContract(loaded))),
      goalHidden: loaded.goal.hidden.digest,
      ...(launch.comparison === "A"
        ? { patch: digestOfBytes(loaded.patches.get(launch.condition)) }
        : {}),
    },
    commands: log.commands,
    tokens: {
      input: null,
      output: null,
      total: launch.comparison === "B" && !context.tokensUnknown ? context.tokensTotal : null,
      basis:
        launch.comparison === "B"
          ? context.tokensUnknown
            ? "an agent invocation reported no stopped event; tokens unmeasured"
            : "sum of the agent's stopped-event tokensUsed (input and output combined)"
          : "no model call in this arm",
    },
    decision: outcome.decision,
    decisionBasis: outcome.basis,
    truth,
    humanInterventions: [],
    notes: context.notes,
  });
  writeFileSync(
    join(directory, `attempt-${attempt}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    {
      flag: "wx",
    },
  );
  return { skipped: false, record };
}

export class InfrastructureError extends Error {
  constructor(message) {
    super(message);
    this.name = "InfrastructureError";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const flag = (name, fallback = undefined) => {
    const at = rest.indexOf(name);
    return at === -1 ? fallback : rest[at + 1];
  };
  const manifestPath = flag("--manifest");
  const bytes = readFileSync(manifestPath);
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
  const manifestDigest = digestOfBytes(bytes);
  const selected = manifest.launches.filter(
    (launch) =>
      (flag("--set") === undefined || launch.set === flag("--set")) &&
      (flag("--comparison") === undefined || launch.comparison === flag("--comparison")) &&
      (flag("--arm") === undefined || launch.arm === flag("--arm")) &&
      (flag("--goal") === undefined || launch.goal === flag("--goal")),
  );
  if (command === "run") {
    const launch = manifest.launches.find((one) => one.id === rest[0]);
    if (launch === undefined) throw new Error(`no launch ${rest[0]} in the manifest`);
    const { skipped, record } = await runLaunch(manifest, manifestDigest, launch);
    console.log(
      `${launch.id}: ${skipped ? "already done" : record.decision} ${record?.decisionBasis ?? ""}`,
    );
  } else if (command === "next") {
    let budget = Number(flag("--limit", "1"));
    for (const launch of selected) {
      if (budget <= 0) break;
      const { skipped, record } = await runLaunch(manifest, manifestDigest, launch);
      if (skipped) continue;
      budget -= 1;
      console.log(
        `${launch.id}: ${record.decision} in ${Math.round(record.wallMs / 1000)}s; truth ${JSON.stringify(record.truth)}`,
      );
    }
  } else if (command === "rows") {
    // One compact row per recorded attempt, for evidence pages: the full records stay in the cache.
    const rows = [];
    for (const launch of selected)
      for (const record of attemptsOf(
        join(campaignRoot, "runs", manifestDigest.slice(7, 23), launch.id),
      ))
        rows.push({
          launch: launch.id,
          attempt: record.attempt,
          decision: record.decision,
          wallSeconds: Math.round(record.wallMs / 1000),
          agentSeconds: Math.round(
            record.commands
              .filter((one) => one.argv.some((word) => word === manifest.pins.swarmCli))
              .reduce((sum, one) => sum + one.wallMs, 0) / 1000,
          ),
          tokens: record.tokens.total,
          truth: record.truth,
          basis: record.decisionBasis.slice(0, 200),
          notes: record.notes.filter((note) => !note.startsWith("hidden oracle:")),
        });
    console.log(JSON.stringify({ manifest: manifestDigest, rows }, null, 1));
  } else if (command === "status") {
    const counts = {};
    for (const launch of selected) {
      const directory = join(campaignRoot, "runs", manifestDigest.slice(7, 23), launch.id);
      const last = attemptsOf(directory).at(-1);
      const state = last?.decision ?? "pending";
      counts[state] = (counts[state] ?? 0) + 1;
    }
    console.log(JSON.stringify(counts));
  } else {
    console.error("usage: launch.mjs run <id> | next | status --manifest <file>");
    process.exit(2);
  }
}
