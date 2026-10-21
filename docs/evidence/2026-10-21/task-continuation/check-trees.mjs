// The real sinon checks over the reconstructed trees of both launches, with no model: each
// tree's own focused test file, the project's lint and node suite, the visible check, the hidden
// API check, the sealed upstream test file overlaid (the hidden oracle's reading, which is what
// reproduces launch 2's resetBehavior failure apart from any worker), and the tree's own test
// file over the base's source (the differential reading of its tests).
//
//   node check-trees.mjs --patches <dir from reconstruct-launches.mjs> --out <json> [--mirror <bare clone>]
//   node check-trees.mjs --tree <name>=<patch file> [--tree ...] --out <json> [--mirror <bare clone>]
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { tasks } from "../../../../scripts/comparison/tasks.mjs";
import { cloneBase, digestOf, ensureMirror, git, resetTree, upstream } from "./replay-edits.mjs";
import { readFileSync } from "node:fs";

const { values } = parseArgs({
  options: {
    patches: { type: "string" },
    tree: { type: "string", multiple: true },
    out: { type: "string" },
    mirror: { type: "string" },
  },
});
if ((values.patches === undefined && values.tree === undefined) || values.out === undefined)
  throw new Error("usage: check-trees.mjs (--patches <dir> | --tree <name>=<patch> ...) --out <json> [--mirror <bare clone>]");
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const task = tasks.find((one) => one.id === "sinon-bugfix-stub-accessor-calls-v2");
const apiCheck = task.hidden.files.find((file) => file.path === "acceptance/hidden/api-check.mjs").source;
const tree = cloneBase(ensureMirror(values.mirror), mkdtempSync(join(tmpdir(), "sinon-check-trees-")));
const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "true", npm_config_fund: "false", npm_config_audit: "false", npm_config_update_notifier: "false", CI: "1" };
execFileSync("npm", ["ci", "--ignore-scripts"], { cwd: tree, env, stdio: "ignore" });

const run = (argv) => {
  const started = Date.now();
  const result = spawnSync(argv[0], argv.slice(1), { cwd: tree, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 600_000 });
  const text = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  return {
    argv,
    exitCode: result.status,
    durationMs: Date.now() - started,
    passing: Number(/(\d+) passing/.exec(text)?.[1] ?? NaN) || null,
    failing: Number(/(\d+) failing/.exec(text)?.[1] ?? NaN) || null,
    failedTitles: [...text.matchAll(/^\s+\d+\) (.+)$/gm)].map((match) => match[1]).slice(0, 40),
    lintProblems: /✖ (\d+) problems? \((\d+) errors?/.exec(text)?.slice(1, 3).map(Number) ?? null,
    tail: text.slice(-1200),
  };
};
const trees =
  values.tree === undefined
    ? {
        "launch-1 first": "launch-1/first.patch",
        "launch-1 repair-1": "launch-1/repair-1.patch",
        "launch-1 repair-2": "launch-1/repair-2.patch",
        "launch-2 first": "launch-2/first.patch",
        "launch-2 final": "launch-2/repair-1.patch",
      }
    : Object.fromEntries(values.tree.map((entry) => [entry.slice(0, entry.indexOf("=")), resolve(entry.slice(entry.indexOf("=") + 1))]));
const results = {};
for (const [name, relative] of Object.entries(trees)) {
  const patch = values.tree === undefined ? join(resolve(values.patches), relative) : relative;
  resetTree(tree);
  git(tree, "apply", patch);
  const result = { patch: relative, patchDigest: digestOf(readFileSync(patch)) };
  result.ownFocusedTests = run(["npx", "mocha", "-R", "dot", "test/src/stub-test.js"]);
  result.lint = run(["npm", "run", "lint"]);
  result.testNode = run(["npm", "run", "test-node"]);
  mkdirSync(join(tree, task.visible.path, ".."), { recursive: true });
  writeFileSync(join(tree, task.visible.path), task.visible.source);
  result.visibleCheck = run(["node", task.visible.path]);
  // The hidden check is written where the task's scoring checkout holds it, never in a worker's tree.
  mkdirSync(join(tree, "acceptance/hidden"), { recursive: true });
  writeFileSync(join(tree, "acceptance/hidden/api-check.mjs"), apiCheck);
  result.apiCheck = run(["node", "acceptance/hidden/api-check.mjs"]);
  writeFileSync(join(tree, "test/src/stub-test.js"), git(tree, "show", `${upstream}:test/src/stub-test.js`));
  result.sealedTestsOverlaid = run(["npx", "mocha", "-R", "dot", "test/src/stub-test.js"]);
  resetTree(tree);
  git(tree, "apply", "--include=test/*", patch);
  result.ownTestsOnBaseSource = run(["npx", "mocha", "-R", "dot", "test/src/stub-test.js"]);
  resetTree(tree);
  results[name] = result;
  const say = (one) => `exit ${one.exitCode}${one.passing === null ? "" : `, ${one.passing} passing`}${one.failing === null ? "" : `, ${one.failing} failing`}${one.lintProblems ? `, ${one.lintProblems[0]} lint problem(s)` : ""}`;
  console.log(`${name}: own tests ${say(result.ownFocusedTests)}; lint ${say(result.lint)}; test-node ${say(result.testNode)}; visible ${say(result.visibleCheck)}; api-check ${say(result.apiCheck)}; sealed overlay ${say(result.sealedTestsOverlaid)}${result.sealedTestsOverlaid.failedTitles.length ? ` [${result.sealedTestsOverlaid.failedTitles.join("; ")}]` : ""}; own tests on base source ${say(result.ownTestsOnBaseSource)}`);
}
writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), node: process.version, results }, null, 2)}\n`);
