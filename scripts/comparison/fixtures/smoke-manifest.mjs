/**
 * Two small development tasks for a live smoke of the comparison launcher on the real configured
 * arms: a seconds-handling bug fix and a formatting feature in a tiny dependency-free Node
 * package. They are excluded from every measured campaign; their only purpose is to show that
 * each arm, under its actual configuration, uses its tools, edits, is checked, reports and is
 * cleaned up, under the stop controls. Usage:
 *
 *   node scripts/comparison/fixtures/smoke-manifest.mjs --out <manifest> [--wall-minutes 5]
 *
 * The repository is created with a base and an upstream commit, mirrored bare where the harness
 * looks (`~/.cache/swarm-comparison/mirrors/smoke__duration.git`), and the manifest pins the
 * served model, the endpoint, the Swarm CLI (path, revision label and bytes), the installed
 * OpenCode version, Node and the harness digest, exactly as `run.mjs --freeze` does.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { defaultPins, digestOf } from "../arms.mjs";
import { harnessDigest } from "../harness-identity.mjs";
import { launches, seed } from "../order.mjs";
import { taskSchema } from "../schema.mjs";
import { mirrorOf } from "../workspace.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const word = process.argv[index];
  if (word.startsWith("--")) args.set(word.slice(2), process.argv[index + 1] ?? "true");
}
const repository = "smoke/duration";
const wallMinutes = Number(args.get("wall-minutes") ?? "5");

function run(cwd, command, argv, env = process.env) {
  const ran = spawnSync(command, argv, { cwd, encoding: "utf8", env });
  if (ran.status !== 0)
    throw new Error(`${command} ${argv.join(" ")} failed in ${cwd}:\n${ran.stdout}\n${ran.stderr}`);
  return ran.stdout.trim();
}
const git = (cwd, ...argv) =>
  run(cwd, "git", ["-c", "user.name=smoke", "-c", "user.email=smoke@localhost", ...argv]);

const baseSource = `/**
 * Durations written as "1h30m" or "45m": hours and minutes, in any order, each at most once.
 * Returns the total in seconds.
 */
export function parseDuration(text) {
  let seconds = 0;
  for (const [, amount, unit] of text.matchAll(/(\\d+)([hm])/g)) {
    if (unit === "h") seconds += Number(amount) * 3600;
    else seconds += Number(amount) * 60;
  }
  return seconds;
}
`;
const fixedSource = `/**
 * Durations written as "1h30m", "45m" or "2m5s": hours, minutes and seconds, in any order,
 * each at most once. Returns the total in seconds.
 */
export function parseDuration(text) {
  let seconds = 0;
  for (const [, amount, unit] of text.matchAll(/(\\d+)([hms])/g)) {
    if (unit === "h") seconds += Number(amount) * 3600;
    else if (unit === "m") seconds += Number(amount) * 60;
    else seconds += Number(amount);
  }
  return seconds;
}
`;
const formatSource = `${fixedSource}
/** The inverse: whole seconds to "1h1m5s", omitting zero parts, "0s" for zero. */
export function formatDuration(total) {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const parts = [];
  if (hours > 0) parts.push(\`\${hours}h\`);
  if (minutes > 0) parts.push(\`\${minutes}m\`);
  if (seconds > 0 || parts.length === 0) parts.push(\`\${seconds}s\`);
  return parts.join("");
}
`;
const baseTest = `import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDuration } from "../src/duration.mjs";

test("hours and minutes", () => {
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("45m"), 2700);
  assert.equal(parseDuration("2h"), 7200);
});
`;
const secondsTest = `${baseTest}
test("seconds", () => {
  assert.equal(parseDuration("2m5s"), 125);
  assert.equal(parseDuration("5s"), 5);
  assert.equal(parseDuration("1h0m30s"), 3630);
});
`;
const formatTest = `import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDuration, parseDuration } from "../src/duration.mjs";

test("formats whole seconds", () => {
  assert.equal(formatDuration(3665), "1h1m5s");
  assert.equal(formatDuration(5400), "1h30m");
  assert.equal(formatDuration(59), "59s");
  assert.equal(formatDuration(0), "0s");
});

test("round trips", () => {
  for (const text of ["1h30m", "2m5s", "7200s"])
    assert.equal(formatDuration(parseDuration(text)), formatDuration(parseDuration(formatDuration(parseDuration(text)))));
});
`;

function commit(source, files, message) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), content);
  }
  git(source, "add", "--all");
  git(source, "commit", "-qm", message);
  return git(source, "rev-parse", "HEAD");
}

/** Build the repository: the bugfix task's base and upstream, then the feature's base and upstream. */
function buildRepository() {
  const source = mkdtempSync(join(tmpdir(), "smoke-duration-"));
  writeFileSync(
    join(source, "package.json"),
    `${JSON.stringify(
      { name: "duration", version: "1.0.0", type: "module", scripts: { test: "node --test" } },
      null,
      2,
    )}\n`,
  );
  run(source, "npm", [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  git(source, "init", "-q");
  const bugfixBase = commit(
    source,
    { "src/duration.mjs": baseSource, "test/duration.test.mjs": baseTest },
    "hours and minutes",
  );
  const bugfixUpstream = commit(
    source,
    { "src/duration.mjs": fixedSource, "test/duration.test.mjs": secondsTest },
    "parse seconds",
  );
  const featureUpstream = commit(
    source,
    { "src/duration.mjs": formatSource, "test/format.test.mjs": formatTest },
    "formatDuration",
  );
  // The upstream trees must pass their own tests, or the task is not valid to begin with.
  run(source, "node", ["--test"]);
  const mirror = mirrorOf(repository);
  if (existsSync(mirror)) rmSync(mirror, { recursive: true, force: true });
  mkdirSync(dirname(mirror), { recursive: true });
  git(source, "clone", "--quiet", "--bare", source, mirror);
  rmSync(source, { recursive: true, force: true });
  return { bugfixBase, bugfixUpstream, featureBase: bugfixUpstream, featureUpstream };
}

const common = {
  repository,
  install: [["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"]],
  build: [],
  projectTest: ["node", "--test"],
  visiblePrefix: "",
  immutable: ["test"],
};

function tasks(commits) {
  return [
    {
      ...common,
      id: "smoke-bugfix-parse-seconds",
      workType: "bugfix",
      baseCommit: commits.bugfixBase,
      upstreamCommit: commits.bugfixUpstream,
      visible: {
        path: "acceptance/visible/check.mjs",
        command: "node acceptance/visible/check.mjs",
        source: `import assert from "node:assert/strict";
import { parseDuration } from "../../src/duration.mjs";
assert.equal(parseDuration("2m5s"), 125);
assert.equal(parseDuration("1h30m"), 5400);
console.log("visible check passed");
`,
      },
      hidden: {
        testFiles: ["test/duration.test.mjs"],
        argv: ["node", "--test", "test/duration.test.mjs"],
      },
      taskText: `parseDuration in src/duration.mjs accepts hours ("h") and minutes ("m") but silently ignores a seconds part, so parseDuration("2m5s") returns 120 instead of 125 and parseDuration("5s") returns 0. Make it accept an "s" unit (whole seconds) alongside "h" and "m", in any order, so that "2m5s" is 125, "5s" is 5 and "1h0m30s" is 3630. Keep the existing behavior for hours and minutes and keep the function's documentation accurate. Do not change the tests under test/.`,
    },
    {
      ...common,
      id: "smoke-feature-format-duration",
      workType: "feature",
      baseCommit: commits.featureBase,
      upstreamCommit: commits.featureUpstream,
      visible: {
        path: "acceptance/visible/check.mjs",
        command: "node acceptance/visible/check.mjs",
        source: `import assert from "node:assert/strict";
import { formatDuration } from "../../src/duration.mjs";
assert.equal(formatDuration(3665), "1h1m5s");
assert.equal(formatDuration(0), "0s");
console.log("visible check passed");
`,
      },
      hidden: {
        testFiles: ["test/format.test.mjs"],
        argv: ["node", "--test", "test/format.test.mjs"],
      },
      taskText: `Add an exported function formatDuration(totalSeconds) to src/duration.mjs, the inverse of parseDuration: it takes a whole number of seconds and returns the compact text with hours, minutes and seconds in that order, omitting any part that is zero, so formatDuration(3665) is "1h1m5s", formatDuration(5400) is "1h30m", formatDuration(59) is "59s", and formatDuration(0) is "0s". parseDuration(formatDuration(n)) must equal n for every non-negative integer n. Do not change the tests under test/.`,
    },
  ];
}

const commits = buildRepository();
const taskSet = tasks(commits);
for (const task of taskSet) taskSchema.parse(task);
const version = (argv) => {
  const ran = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" });
  return (ran.stdout || ran.stderr || "").trim().split("\n")[0] ?? "unknown";
};
const manifest = {
  schema: "swarm-ordinary-comparison.manifest.v1",
  frozenAt: new Date().toISOString(),
  protocolDigest: null,
  purpose: "live smoke of the stop controls on the real arm configuration; not a measured campaign",
  pins: {
    ...defaultPins,
    swarmRevision: args.get("swarm-revision") ?? "unknown",
    swarmCliDigest: existsSync(defaultPins.swarmCli)
      ? digestOf(readFileSync(defaultPins.swarmCli))
      : null,
    opencode: version(["opencode", "--version"]),
    node: process.version,
    harnessDigest: harnessDigest(join(import.meta.dirname, "..")),
  },
  budgets: {
    wallMsPerInvocation: wallMinutes * 60_000,
    wallGraceMs: 60_000,
    swarmTokenCap: 600_000,
    maxCorrections: 2,
  },
  seed,
  tasks: taskSet,
  launches: launches(taskSet.map((task) => task.id)),
};
const out = args.get("out") ?? "smoke-manifest.json";
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `smoke manifest at ${out}: ${manifest.launches.length} launches, ${wallMinutes} min each, model ${manifest.pins.model} at ${manifest.pins.endpoint}`,
);
