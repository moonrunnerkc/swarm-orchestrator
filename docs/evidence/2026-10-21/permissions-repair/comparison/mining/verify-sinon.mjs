// Verify two sinon candidates the way the comparison scores: the upstream test file over the
// base must fail under mocha, the upstream commit must pass it, and the base must pass test-node.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const clone = process.argv[2];
const out = process.argv[3];
const run = (argv, cwd) => {
  const ran = spawnSync(argv[0], argv.slice(1), {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 900_000,
    env: { ...process.env, npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false" },
  });
  return { status: ran.status, tail: `${ran.stdout}\n${ran.stderr}`.trim().split("\n").slice(-8).join("\n") };
};
const candidates = [
  { sha: "002ee82bc", tests: ["test/src/stub-test.js"] },
  { sha: "40de5a48c", tests: ["test/src/mock-test.js"] },
];
const rows = [];
for (const candidate of candidates) {
  const tree = join(dirname(clone), `sinon-${candidate.sha}`);
  rmSync(tree, { recursive: true, force: true });
  run(["git", "worktree", "prune"], clone);
  run(["git", "worktree", "add", "--detach", "--quiet", tree, `${candidate.sha}^`], clone);
  const row = { sha: candidate.sha, base: run(["git", "rev-parse", "HEAD"], tree).tail };
  const manifest = JSON.parse(readFileSync(join(tree, "package.json"), "utf8"));
  row.main = manifest.main ?? null;
  row.exports = manifest.exports ?? null;
  row.install = run(["npm", "ci", "--ignore-scripts"], tree).status;
  row.build = run(["npm", "run", "build-artifacts"], tree).status;
  for (const path of candidate.tests) {
    const shown = run(["git", "show", `${candidate.sha}:${path}`], clone);
    mkdirSync(dirname(join(tree, path)), { recursive: true });
    writeFileSync(join(tree, path), spawnSync("git", ["show", `${candidate.sha}:${path}`], { cwd: clone, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).stdout);
    void shown;
  }
  const hiddenAtBase = run(["npx", "mocha", "-R", "dot", ...candidate.tests], tree);
  row.hiddenAtBase = { exit: hiddenAtBase.status, tail: hiddenAtBase.tail };
  run(["git", "checkout", "--quiet", "--", "."], tree);
  const started = Date.now();
  const baseProject = run(["npm", "run", "test-node"], tree);
  row.baseTestNode = { exit: baseProject.status, wallMs: Date.now() - started, tail: baseProject.tail.slice(-300) };
  run(["git", "checkout", "--quiet", "--detach", candidate.sha], tree);
  run(["npm", "ci", "--ignore-scripts"], tree);
  run(["npm", "run", "build-artifacts"], tree);
  const hiddenAtUpstream = run(["npx", "mocha", "-R", "dot", ...candidate.tests], tree);
  row.hiddenAtUpstream = { exit: hiddenAtUpstream.status, tail: hiddenAtUpstream.tail.slice(-200) };
  const upstreamProject = run(["npm", "run", "test-node"], tree);
  row.upstreamTestNode = { exit: upstreamProject.status, tail: upstreamProject.tail.slice(-300) };
  rows.push(row);
  console.log(JSON.stringify(row, null, 1));
  run(["git", "worktree", "remove", "--force", tree], clone);
}
writeFileSync(out, `${JSON.stringify(rows, null, 2)}\n`);
