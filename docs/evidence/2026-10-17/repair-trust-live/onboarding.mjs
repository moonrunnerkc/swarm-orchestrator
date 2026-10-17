#!/usr/bin/env node
/**
 * The README's first run, walked as written in a disposable root: a private HOME and npm prefix,
 * the source cloned at one commit, `npm ci`, `npm pack` and a global install of the tarball, the version
 * and help, two command lines the README's reader could get wrong, then the scratch repository and
 * the task, with the model the README names. Two departures, both forced: the clone is of this
 * local repository at the frozen commit (the branch is not published), and the scratch
 * repository's commit names a throwaway identity, since the private HOME has none.
 *
 * Off a terminal, as a script is: the run's one interactive question is not asked.
 *
 *   node onboarding.mjs --source <repository> --commit <sha> --out <dir> [--deadline-minutes 15]
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    source: { type: "string" },
    commit: { type: "string" },
    out: { type: "string" },
    "deadline-minutes": { type: "string", default: "15" },
  },
});
if (!values.source || !values.commit || !values.out)
  throw new Error("usage: onboarding.mjs --source <repository> --commit <sha> --out <dir>");
mkdirSync(values.out, { recursive: true });
if (readdirSync(values.out).length > 0) throw new Error(`${values.out} is not empty`);

const root = mkdtempSync(join(tmpdir(), "swarm-onboarding-"));
const home = join(root, "home");
const prefix = join(root, "prefix");
mkdirSync(home, { recursive: true, mode: 0o700 });
mkdirSync(prefix, { recursive: true });
// Only what a fresh shell would carry: the system PATH with the private prefix first, no keys.
const env = {
  HOME: home,
  PATH: `${join(prefix, "bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
  npm_config_prefix: prefix,
  npm_config_cache: join(root, "npm-cache"),
  NO_COLOR: "1",
};
const steps = [];
function step(name, command, { cwd = root, timeoutMs = 600_000 } = {}) {
  const started = Date.now();
  const ran = spawnSync("/bin/sh", ["-c", command], {
    cwd,
    env,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const record = {
    name,
    command,
    cwd: cwd.replace(root, "<root>"),
    exitCode: ran.status,
    signal: ran.signal,
    elapsedMs: Date.now() - started,
    stdout: ran.stdout?.replaceAll(root, "<root>") ?? "",
    stderr: ran.stderr?.replaceAll(root, "<root>") ?? "",
  };
  steps.push(record);
  console.log(`${name}: exit ${ran.status}${ran.signal ? ` (${ran.signal})` : ""} in ${record.elapsedMs} ms`);
  return record;
}

const source = join(root, "swarm-orchestrator");
step("clone", `git clone -q ${values.source} swarm-orchestrator && git -C swarm-orchestrator checkout -q ${values.commit}`);
step("npm ci", "npm ci --no-audit --no-fund", { cwd: source });
step("pack", "npm pack", { cwd: source });
step("install the packed tarball", "npm install -g ./swarm-orchestrator-*.tgz", { cwd: source });
step("version", "swarm --version", { cwd: home });
step("help", "swarm --help", { cwd: home });
step("a misspelt flag", 'swarm --plan-check "fix the parser"', { cwd: home });

const demo = join(root, "slug-demo");
mkdirSync(demo);
step(
  "scratch repository",
  [
    "git init -q",
    `echo '{ "type": "module", "scripts": { "test": "node --test" } }' > package.json`,
    "echo 'export const slugify = (text) => text.toLowerCase();' > slug.js",
    `cat > slug.test.js <<'END'
import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "./slug.js";
test("lowercases", () => assert.equal(slugify("Hello"), "hello"));
END`,
    'git add -A && git -c user.name=demo -c user.email=demo@example.com commit -qm "start"',
  ].join("\n"),
  { cwd: demo },
);
step("no model reachable", 'swarm "fix the parser" --local-endpoint http://127.0.0.1:9/v1', { cwd: demo });
const task = step(
  "the task",
  'swarm "make slugify in slug.js turn each run of spaces into one dash, and add a test for it" --model local:qwen3.6:35b-a3b',
  { cwd: demo, timeoutMs: Number(values["deadline-minutes"]) * 60_000 },
);
step("review the change", "git status --short && git diff", { cwd: demo });
const bundle = /bundle[^\n]*?(\/[^\s]+\/bundle)\b/.exec(`${task.stdout}\n${task.stderr}`.replaceAll("<root>", root))?.[1];
if (bundle !== undefined) step("verify the bundle", `swarm verify ${bundle}`, { cwd: demo });

writeFileSync(
  join(values.out, "onboarding.json"),
  `${JSON.stringify({ schema: "swarm-onboarding-trial.v1", commit: values.commit, root: "<root>", steps }, null, 2)}\n`,
);
console.log(`root: ${root}`);
