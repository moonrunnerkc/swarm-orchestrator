import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const root = mkdtempSync(join(homedir(), ".swarm/upgrade-validation/pr-cli-"));
const workspace = join(root, "repository");
const observations = [];
function run(file, args, expected = 0, cwd = root) {
  const result = spawnSync(file, args, {
    cwd,
    env: { PATH: process.env.PATH, HOME: homedir(), NO_COLOR: "1" },
    encoding: "utf8",
    timeout: 180000,
    maxBuffer: 16000000,
  });
  observations.push({
    file,
    args,
    expected,
    exit: result.status,
    stdout: result.stdout.slice(-4000),
    stderr: result.stderr.slice(-4000),
  });
  writeFileSync(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
    mode: 0o600,
  });
  if (result.status !== expected)
    throw Error(`PR fixture ${root}: expected ${expected}, got ${result.status}: ${result.stderr}`);
  return result.stdout;
}
run("git", ["clone", "--no-hardlinks", "--quiet", resolve(import.meta.dirname, ".."), workspace]);
writeFileSync(join(workspace, "personal.txt"), "preserve untracked input\n");
const binary = process.argv[2] ?? resolve("packages/swarm-verify/dist/swarm-verify.js");
const common = [
  binary,
  "ci",
  "--workspace",
  workspace,
  "--oracle-only",
  "--oracle",
  "node --check src/cli.ts",
  "--json",
];
const pr = JSON.parse(
  run(process.execPath, [...common, "--pr", "moonrunnerkc/swarm-orchestrator#73"], 1),
);
const identity = pr.sourceIdentity;
if (
  identity.mode !== "pr" ||
  identity.pullRequest !== 73 ||
  !identity.head ||
  !identity.comparisonBase
)
  throw Error("immutable PR identity missing");
const patch = join(root, "snapshot.patch");
writeFileSync(
  patch,
  run(
    "git",
    [
      "-c",
      "core.quotePath=true",
      "diff",
      "--binary",
      "--full-index",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      identity.comparisonBase,
      identity.head,
      "--",
    ],
    0,
    workspace,
  ),
);
const semantic = (report) =>
  JSON.stringify([
    report.verified,
    report.regression,
    report.task,
    report.oracleReach,
    report.oracleBond,
  ]);
for (const input of [
  ["--patch", patch],
  ["--branch", identity.head],
]) {
  const report = JSON.parse(
    run(process.execPath, [...common, "--base", identity.comparisonBase, ...input], 1),
  );
  if (
    semantic(report) !== semantic(pr) ||
    report.sourceIdentity.patchDigest !== identity.patchDigest ||
    report.sourceIdentity.comparisonBase !== identity.comparisonBase
  )
    throw Error("equivalent snapshots disagreed");
}
if (
  pr.task !== "vacuous" ||
  pr.verified ||
  readFileSync(join(workspace, "personal.txt"), "utf8") !== "preserve untracked input\n"
)
  throw Error("vacuous control or preservation failed");
writeFileSync(join(root, "identity.json"), JSON.stringify(identity, null, 2));
console.log(
  JSON.stringify({
    root,
    observations: observations.length,
    status: "passed",
    semantic: JSON.parse(semantic(pr)),
  }),
);
