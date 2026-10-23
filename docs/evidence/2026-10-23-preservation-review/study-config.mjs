// Writes the study configuration `scripts/comparison/study.mjs --freeze` reads, for this stage's
// development study or its fresh block. The order is the comparison's seeded `studyOrder` for
// sample 1, and the same tasks with the arms rotated one place further for sample 2, so no arm
// holds one position in every task.
//
// usage: node study-config.mjs dev|fresh <swarm revision> <out config.json> [tasks module]
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { studyOrder } from "../../../scripts/comparison/study.mjs";

const [block, revision, out, tasksModuleArgument] = process.argv.slice(2);
if (!["dev", "fresh"].includes(block) || !revision || !out)
  throw new Error("usage: node study-config.mjs dev|fresh <swarm revision> <out> [tasks module]");

const home = homedir();
const cache = (path) => join(home, ".cache", path);
const studyRoot = cache("swarm-study-2026-10-23c");
const tool = cache(`swarm-comparison/tools/swarm-study-${revision}`);

const studies = {
  dev: {
    tasksModule: tasksModuleArgument ?? join(studyRoot, "dev-tasks.mjs"),
    taskIds: [
      "svgo-bugfix-remove-scripts-anchor-bypass",
      "markdown-it-feature-reference-definition-token",
      "p-limit-bugfix-limit-function-clear-queue",
    ],
    protocol: resolve("docs/evidence/2026-10-23-preservation-review/development-protocol.md"),
    arms: ["swarm-control", "swarm-prose", "swarm"],
    armSettings: {
      "swarm-control": { flags: ["--adaptive"] },
      "swarm-prose": { flags: ["--adaptive", "--review", "prose"] },
      swarm: { flags: ["--adaptive", "--review", "executable"] },
    },
  },
};

const study = studies[block];
if (study === undefined) throw new Error(`no ${block} study is defined yet`);

const rotate = (arms, by) => arms.map((_, index) => arms[(index + by) % arms.length]);
const sample1 = studyOrder(study.taskIds, study.arms);
const sample2 = studyOrder(study.taskIds, rotate(study.arms, 1));
const launches = [
  ...sample1.map((launch) => ({ ...launch, sample: 1 })),
  ...sample2.map((launch) => ({ ...launch, order: launch.order + sample1.length, sample: 2 })),
];

const config = {
  ...study,
  order: "listed",
  launches,
  pins: {
    model: "qwen3.6:35b-a3b",
    endpoint: "http://127.0.0.1:11434/v1",
    nodeBin: "/usr/local/bin/node",
    swarmCli: join(tool, "dist/cli.js"),
    swarmRevision: revision,
    opencodeBin: cache("swarm-capability-tools/opencode/node_modules/.bin/opencode"),
  },
  budgets: {
    wallMsPerLaunch: 720500,
    wallGraceMs: 59500,
    swarmTokenCap: 8000000,
    swarmVerificationReserveMs: 60000,
    readinessSequences: 2,
  },
  isolation: {
    protectedRoots: [
      studyRoot,
      cache("swarm-study-2026-10-23"),
      cache("swarm-heldout-2026-10-23"),
      cache("swarm-heldout-2026-10-23c"),
      cache("swarm-study-2026-10-22"),
      cache("swarm-heldout-2026-10-22"),
      cache("swarm-comparison/tools"),
      cache("swarm-comparison/runs"),
      cache("swarm-comparison/work"),
      cache("swarm-comparison-b"),
      cache("swarm-ai-pr-study"),
      cache("swarm-campaign"),
      cache("swarm-live-runs"),
      cache("swarm-pr-tasks"),
      cache("swarm-redesign-pilot"),
      "/private/tmp/claude-501",
    ],
    readableRoots: [tool, cache("swarm-comparison/tools/npm-11.2.0")],
    reprotectedRoots: ["docs", "scripts", "campaign", "fuzz"].map((part) => join(tool, part)),
    canary: join(studyRoot, "sealed-canary/canary.txt"),
  },
  // The canary's own marker, so an arm that read the sealed root is caught by its text.
  exposureMarkers: [
    readFileSync(join(studyRoot, "sealed-canary/canary.txt"), "utf8").trim(),
    "swarm-comparison/mirrors",
    "swarm-heldout-2026-10-22",
    "swarm-study-2026-10-22",
    "swarm-heldout-2026-10-23",
    "swarm-study-2026-10-23",
    "swarm-heldout-2026-10-23c",
    "swarm-study-2026-10-23c",
  ],
  inputRoots: [cache("swarm-study-2026-10-22/heldout-inputs"), cache("swarm-study-2026-10-23/heldout-inputs")],
  harnessLockfiles: {
    "p-limit-bugfix-limit-function-clear-queue": {
      name: "p-limit-bugfix-limit-function-clear-queue/package-lock.json",
      digest: "sha256:b10b86fdb3858fcee1130872616159bc0c96f33affd6ee2260afe3ef415e3e0f",
    },
    "svgo-bugfix-remove-scripts-anchor-bypass": {
      name: "svgo-bugfix-remove-scripts-anchor-bypass/package-lock.json",
      digest: "sha256:5a61a1a968736c0b192b2b7f6bd36d5d2251e8778ed89add20fc0280f6e9cfec",
    },
  },
};
writeFileSync(out, `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
console.log(`${launches.length} launches over ${study.taskIds.length} tasks written to ${out}`);
