#!/usr/bin/env node
/**
 * Applies criteria 5 to 7 of selection-rule.md to one candidate commit, with no model: install at
 * the base and at the commit, the project test command on each, and the commit's test files
 * overlaid on the base under the hidden argv. Prints each command's exit code and the end of its
 * output; writes the record to --out.
 *
 *   node validate.mjs --mirror <bare mirror> --sha <commit> --test "<command>" --hidden "<command>"
 *     --tests <file,file> --scratch <dir> --out <json>
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    mirror: { type: "string" },
    sha: { type: "string" },
    test: { type: "string" },
    hidden: { type: "string" },
    tests: { type: "string" },
    scratch: { type: "string" },
    out: { type: "string" },
  },
});
const tail = (text) => text.split("\n").slice(-25).join("\n");
const environment = {
  ...process.env,
  CI: "true",
  PUPPETEER_SKIP_DOWNLOAD: "true",
  npm_config_cache: join(process.env.HOME ?? "", ".cache/swarm-comparison/npm-cache"),
};
const shell = (cwd, command) => {
  const started = Date.now();
  const ran = spawnSync("sh", ["-c", command], {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    timeout: 900_000,
  });
  return {
    command,
    exitCode: ran.status,
    signal: ran.signal,
    wallMs: Date.now() - started,
    outputTail: tail(`${ran.stdout ?? ""}\n${ran.stderr ?? ""}`),
  };
};
const base = execFileSync("git", ["--git-dir", values.mirror, "rev-parse", `${values.sha}^`], {
  encoding: "utf8",
}).trim();
const tree = (name, commit) => {
  const directory = join(values.scratch, name);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(values.scratch, { recursive: true });
  execFileSync("git", ["clone", "--quiet", "--no-checkout", values.mirror, directory]);
  execFileSync("git", ["-C", directory, "checkout", "--quiet", commit]);
  return directory;
};
const record = { sha: values.sha, base, test: values.test, hidden: values.hidden, steps: {} };
const atBase = tree("base", base);
record.steps.baseInstall = shell(atBase, "npm ci --ignore-scripts --no-audit --no-fund");
record.steps.baseTest = shell(atBase, values.test);
const overlaid = tree("overlaid", base);
record.steps.overlaidInstall = shell(overlaid, "npm ci --ignore-scripts --no-audit --no-fund");
for (const file of values.tests.split(","))
  execFileSync("sh", ["-c", `git -C '${overlaid}' show ${values.sha}:'${file}' > '${join(overlaid, file)}'`]);
record.steps.baseHidden = shell(overlaid, values.hidden);
const atCommit = tree("commit", values.sha);
record.steps.commitInstall = shell(atCommit, "npm ci --ignore-scripts --no-audit --no-fund");
record.steps.commitHidden = shell(atCommit, values.hidden);
record.steps.commitTest = shell(atCommit, values.test);
const exit = (step) => record.steps[step].exitCode;
record.criteria = {
  install: exit("baseInstall") === 0 && exit("commitInstall") === 0,
  basePassesProjectTest: exit("baseTest") === 0,
  baseFailsHidden: exit("baseHidden") !== 0,
  commitPassesBoth: exit("commitHidden") === 0 && exit("commitTest") === 0,
};
record.eligible = Object.values(record.criteria).every(Boolean);
writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
for (const [step, result] of Object.entries(record.steps))
  console.log(`${step}: exit ${result.exitCode} in ${result.wallMs} ms`);
console.log(JSON.stringify({ criteria: record.criteria, eligible: record.eligible }));
