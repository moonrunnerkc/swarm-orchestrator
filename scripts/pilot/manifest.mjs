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
 *
 * Stage B is the two predeclared repetitions (bugfix and feature) under distinct task ids, so a
 * second manifest's cells can never be read as already recorded by the first's.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { commandLog } from "../campaign/exec.mjs";
import { defaultPins, digestOf } from "../comparison/arms.mjs";
import { opencodeVersion } from "../comparison/control.mjs";
import { harnessDigest } from "../comparison/harness-identity.mjs";
import { launches, seed } from "../comparison/order.mjs";
import { taskSchema } from "../comparison/schema.mjs";
import { comparisonRoot, resolveFull } from "../comparison/workspace.mjs";
import { amendmentDate, developmentStages, developmentTasks } from "./amendments.mjs";
import { stageTasks } from "./tasks.mjs";

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
const developmentStage = stage in developmentStages;
if (stage !== "A" && stage !== "B" && !developmentStage) {
  console.error(
    `usage: manifest.mjs --stage A|B|${Object.keys(developmentStages).join("|")} --out <file> --swarm-cli <path> --swarm-revision <commit> [--protocol <file>] [--wall-minutes 19]`,
  );
  process.exit(2);
}
const swarmCli = args.get("swarm-cli");
if (!swarmCli || !existsSync(swarmCli)) {
  console.error(`--swarm-cli must name the built CLI entry; ${swarmCli ?? "nothing"} is not there`);
  process.exit(2);
}
const wallMinutes = Number(args.get("wall-minutes") ?? "19");
const protocolPath = args.get("protocol") ?? "docs/evidence/2026-10-14/real-task-pilot/protocol.md";
const tasks = developmentStage ? developmentTasks(stage) : stageTasks(stage);
const purposes = {
  A: "four fresh tasks, one launch per arm",
  B: "the predeclared bugfix and feature repeated once per arm in fresh sessions",
  dev: "development validation of the repairs on known tasks under the amended oracle: the upgrade and the feature once per arm; not comparative evidence and not a repetition of the pilot",
  "dev-bugfix":
    "development validation of the repairs on the known bug fix, one clean launch under Swarm; not comparative evidence",
  "dev-bugfix2":
    "a second, independent development launch of the bug fix under Swarm, run only under the condition the development protocol states",
};
// A development stage freezes exactly the cells it launches, so its published evidence is
// complete when every frozen cell has a record.
const stageLaunches = (ids) => {
  const arms = developmentStage ? developmentStages[stage].arms : null;
  const all = launches(ids);
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
const helpers = {};
for (const name of readdirSync(import.meta.dirname).filter(
  (one) => one.endsWith(".mjs") && !one.endsWith(".test.mjs"),
))
  helpers[`scripts/pilot/${name}`] = digestOf(readFileSync(join(import.meta.dirname, name)));

const manifest = {
  schema: "swarm-ordinary-comparison.manifest.v1",
  frozenAt: new Date().toISOString(),
  protocolDigest: existsSync(protocolPath) ? digestOf(readFileSync(protocolPath, "utf8")) : null,
  purpose: `real-task pilot 2026-10-14, stage ${stage}: ${purposes[stage]}`,
  // What a launch's fresh home must show before dispatch: no browser cache, because no task
  // here needs one and this launcher provisions none. Read by the launcher before every launch.
  prerequisites: { browsers: false },
  oracle: developmentStage
    ? `amended ${amendmentDate} (scripts/pilot/amendments.mjs)`
    : "frozen (scripts/pilot/tasks.mjs)",
  pins: {
    ...defaultPins,
    swarmCli,
    swarmRevision: args.get("swarm-revision") ?? "unknown",
    swarmCliDigest: digestOf(readFileSync(swarmCli)),
    // The CLI entry imports its siblings, so its bytes alone do not pin the build; the whole
    // dist tree does.
    swarmDistDigest: treeDigest(dirname(swarmCli)),
    opencode: opencodeVersion(),
    node: process.version,
    harnessDigest: harnessDigest(join(import.meta.dirname, "..", "comparison")),
    pilotHelpers: helpers,
    stage,
  },
  budgets: {
    // One deadline per launch: every invocation, including each scripted correction, ends at
    // it; the runner starts a correction with at least a minute, so 19 keeps the whole launch's
    // agent time under the pilot's 20-minute maximum. The grace is cleanup time after the
    // deadline, tracked separately.
    wallMsPerInvocation: wallMinutes * 60_000,
    wallGraceMs: 60_000,
    // The cap the Swarm arm is launched with, per invocation (`scripts/comparison/arms.mjs`,
    // the same constant). OpenCode has no equivalent native cap; recorded, not matched.
    swarmTokenCap: 600_000,
    maxCorrections: 2,
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
