/**
 * Freeze one stage of the real-task pilot as a manifest the proved comparison runner
 * (`scripts/comparison/run.mjs --manifest`) launches unchanged. The pilot's task set lives in
 * `scripts/pilot/tasks.mjs`, not in the comparison's own set, so the harness and its digest are
 * untouched; what this adds is the pilot's own identity: the isolated Swarm build (path, source
 * commit, the bytes of the CLI entry and of the whole dist tree), the protocol's digest, the
 * stage and the digests of these helper scripts.
 *
 *   node scripts/pilot/manifest.mjs --stage A|B --out <file> --swarm-cli <dist/cli.js>
 *     --swarm-revision <commit> [--protocol <file>] [--wall-minutes 19]
 *     [--verification-reserve-seconds <n>] [--swarm-gates <json file>] [--purpose-note <text>]
 *     [--swarm-flags '["--prompt-profile","concise"]']
 *
 * `--swarm-gates` names, per task id, the gates declared advisory for Swarm (the product's own
 * command, `severity: "advisory"`), where the task's base already fails them; the launcher writes
 * them into the workspace's swarm.toml and checks the product's plan reads them so.
 *
 * Stage B is the two predeclared repetitions (bugfix and feature) under distinct task ids, so a
 * second manifest's cells can never be read as already recorded by the first's.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { defaultPins, digestOf, swarmTokenCap, swarmWorkflowFlags } from "../comparison/arms.mjs";
import { opencodeVersion } from "../comparison/control.mjs";
import { harnessDigest } from "../comparison/harness-identity.mjs";
import { launches, repeatedLaunches, seed } from "../comparison/order.mjs";
import { taskSchema } from "../comparison/schema.mjs";
import {
  comparisonRoot,
  declaredNpm,
  npmToolchain,
  resolveFull,
  taskEnvironment,
} from "../comparison/workspace.mjs";
import { amendmentDate, developmentStages, developmentTasks } from "./amendments.mjs";
import { taskSet } from "./task-sets.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}

/** One digest over every file under a directory, by sorted relative path, so a rebuilt tree is told apart. */
export function treeDigest(root) {
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

const stage = args.get("stage");
const { stageTasks, setName, stagePurposes, repetitions } = await taskSet(args.get("set"));
// A set that names its own stages owns them; the pilot's development stages are the pilot's.
const ownStage = stagePurposes !== undefined && stage in stagePurposes;
const developmentStage = stagePurposes === undefined && stage in developmentStages;
if (stage !== "A" && stage !== "B" && stage !== "calibration" && !developmentStage && !ownStage) {
  console.error(
    `usage: manifest.mjs --stage A|B|${Object.keys(developmentStages).join("|")} --out <file> --swarm-cli <path> --swarm-revision <commit> [--protocol <file>] [--wall-minutes 19] [--model <served name>] [--endpoint <url>]`,
  );
  process.exit(2);
}
const swarmCli = args.get("swarm-cli");
if (!swarmCli || !existsSync(swarmCli)) {
  console.error(`--swarm-cli must name the built CLI entry; ${swarmCli ?? "nothing"} is not there`);
  process.exit(2);
}
const wallMinutes = Number(args.get("wall-minutes") ?? "19");
const reserveSeconds = Number(args.get("verification-reserve-seconds") ?? "0");
const swarmGates = args.has("swarm-gates")
  ? JSON.parse(readFileSync(args.get("swarm-gates"), "utf8"))
  : undefined;
const protocolPath = args.get("protocol") ?? "docs/evidence/2026-10-14/real-task-pilot/protocol.md";
// Swarm's own workflow flags for every launch of this stage, checked by the launcher's own rule.
const swarmFlags = args.has("swarm-flags") ? JSON.parse(args.get("swarm-flags")) : [];
swarmWorkflowFlags(swarmFlags);
const tasks = developmentStage ? developmentTasks(stage) : stageTasks(stage);
// Which arms this stage launches, where it is not both: a stage freezes only the cells it runs.
const armsOnly = args.has("arms") ? args.get("arms").split(",") : null;
if (armsOnly !== null && !armsOnly.every((arm) => ["swarm", "opencode"].includes(arm)))
  throw new Error(`--arms names swarm and opencode only, not ${args.get("arms")}`);
const purposes = {
  A: "four fresh tasks, one launch per arm",
  B: "the predeclared bugfix and feature repeated once per arm in fresh sessions",
  calibration:
    "the declared calibration task under both arms, which each tool must deliver before the comparison is frozen; excluded from scoring",
  dev: "development validation of the repairs on known tasks under the amended oracle: the upgrade and the feature once per arm; not comparative evidence and not a repetition of the pilot",
  "dev-bugfix":
    "development validation of the repairs on the known bug fix, one clean launch under Swarm; not comparative evidence",
  "dev-bugfix2":
    "a second, independent development launch of the bug fix under Swarm, run only under the condition the development protocol states",
  "diagnosis-1":
    "live diagnosis launch 1 of 2026-10-15: the known bug fix under Swarm on the repaired loop; not comparative evidence",
  "diagnosis-2":
    "live diagnosis launch 2 of 2026-10-15: the known bug fix under Swarm with a second installed local model; not comparative evidence",
  "diagnosis-3":
    "live diagnosis launch 3 of 2026-10-15: the known bug fix under OpenCode; not comparative evidence",
  "diagnosis-4":
    "live diagnosis launch 4 of 2026-10-15: the known bug fix under OpenCode on the Ollama configuration with thinking off; not comparative evidence",
};
// A development stage freezes exactly the cells it launches, so its published evidence is
// complete when every frozen cell has a record.
const stageLaunches = (ids) => {
  const arms = developmentStage ? developmentStages[stage].arms : armsOnly;
  const repeated = repetitions?.[stage];
  const all =
    repeated === undefined ? launches(ids) : repeatedLaunches(repeated.tasks, repeated.suffixes);
  return arms === null
    ? all
    : all.filter((one) => arms.includes(one.arm)).map((one, order) => ({ ...one, order }));
};
const log = commandLog(join(comparisonRoot, "blobs"));
for (const task of tasks) {
  taskSchema.parse(task);
  const resolved = await resolveFull(log, task);
  if (resolved.base !== task.baseCommit || resolved.upstream !== task.upstreamCommit)
    throw new Error(`${task.id}: the task must pin full commit ids that resolve in the mirror`);
}
// The package manager each task's base declares, provisioned before the freeze and observed now.
const toolchains = {};
for (const task of tasks) {
  const version = declaredNpm(task);
  if (version === null) continue;
  const environment = taskEnvironment(task);
  const observed = spawnSync("npm", ["--version"], { env: environment, encoding: "utf8" });
  if (observed.stdout.trim() !== version)
    throw new Error(
      `${task.id} declares npm@${version} and the provisioned one reports ${observed.stdout.trim()}`,
    );
  toolchains[task.id] = {
    npm: version,
    path: npmToolchain(version),
    observed: observed.stdout.trim(),
  };
}
const helpers = {};
for (const name of readdirSync(import.meta.dirname).filter(
  (one) => one.endsWith(".mjs") && !one.endsWith(".test.mjs"),
))
  helpers[`scripts/pilot/${name}`] = digestOf(readFileSync(join(import.meta.dirname, name)));

const manifest = {
  schema: "swarm-ordinary-comparison.manifest.v1",
  frozenAt: new Date().toISOString(),
  protocolDigest: existsSync(protocolPath) ? digestOf(readFileSync(protocolPath, "utf8")) : null,
  purpose: `${setName}, stage ${stage}: ${ownStage ? stagePurposes[stage] : purposes[stage]}${args.has("purpose-note") ? ` (${args.get("purpose-note")})` : ""}`,
  // What a launch's fresh home must show before dispatch: no browser cache, because no task
  // here needs one and this launcher provisions none. Read by the launcher before every launch.
  prerequisites: { browsers: false },
  ...(swarmGates === undefined ? {} : { swarmGates }),
  oracle: developmentStage
    ? `amended ${amendmentDate} (scripts/pilot/amendments.mjs)`
    : `frozen (${args.get("set") === undefined ? "scripts/pilot/tasks.mjs" : `scripts/pilot/tasks-${args.get("set")}.mjs`})`,
  pins: {
    ...defaultPins,
    // A diagnosis launch may name another served model or endpoint; a pilot stage never does.
    ...(args.has("model") ? { model: args.get("model") } : {}),
    ...(args.has("endpoint") ? { endpoint: args.get("endpoint") } : {}),
    swarmCli,
    swarmRevision: args.get("swarm-revision") ?? "unknown",
    ...(swarmFlags.length === 0 ? {} : { swarmFlags }),
    swarmCliDigest: digestOf(readFileSync(swarmCli)),
    // The CLI entry imports its siblings, so its bytes alone do not pin the build; the whole
    // dist tree does.
    swarmDistDigest: treeDigest(dirname(swarmCli)),
    opencode: opencodeVersion(),
    node: process.version,
    harnessDigest: harnessDigest(join(import.meta.dirname, "..", "comparison")),
    pilotHelpers: helpers,
    stage,
    toolchains,
  },
  budgets: {
    // One deadline per launch: every invocation, including each scripted correction, ends at
    // it; the runner starts a correction with at least a minute, so 19 keeps the whole launch's
    // agent time under the pilot's 20-minute maximum. The grace is cleanup time after the
    // deadline, tracked separately.
    wallMsPerInvocation: wallMinutes * 60_000,
    wallGraceMs: 60_000,
    // Swarm's token allowance for the whole launch, shared by its corrections
    // (`scripts/comparison/arms.mjs`, the same constant). OpenCode has no equivalent native
    // cap; recorded, not matched.
    swarmTokenCap,
    maxCorrections: 2,
    // Kept inside each launch's deadline for Swarm's final verification of its tree, which the
    // product runs after its own wall (scripts/comparison/arms.mjs, verificationReserveMs).
    ...(reserveSeconds > 0 ? { swarmVerificationReserveMs: reserveSeconds * 1000 } : {}),
    // The product's own documented limits, unchanged for this comparison and named so a reader
    // need not infer them: steps per loop, gate-repair attempts, output tokens per call, and the
    // part of its wall it keeps for its final verification.
    swarmProductLimits: {
      maxStepsPerLoop: 40,
      attempts: 3,
      maxOutputTokensPerCall: 8192,
      finalVerificationReserveMs: 30_000,
    },
  },
  seed,
  tasks,
  launches: stageLaunches(tasks.map((task) => task.id)),
};
const out = args.get("out") ?? `pilot-stage-${stage}.json`;
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `stage ${stage}: ${manifest.launches.length} launches over ${tasks.length} tasks, ${wallMinutes} min each, frozen to ${out}; order ${manifest.launches.map((one) => `${one.task}/${one.arm}`).join(", ")}`,
);
