#!/usr/bin/env node
/**
 * The install routes as a new user meets them, from GitHub and the npm registry, in a disposable
 * root with its own HOME, npm prefix and npm cache. No step reaches a model: the one run that would
 * is pointed at port 9, where nothing answers.
 *
 *   node remote-install.mjs --branch <branch> --out <file>
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { branch: { type: "string" }, out: { type: "string" } } });
if (!values.branch || !values.out) throw new Error("usage: remote-install.mjs --branch <b> --out <f>");
const url = "https://github.com/moonrunnerkc/swarm-orchestrator.git";
const root = mkdtempSync(join(tmpdir(), "swarm-remote-install-"));
const home = join(root, "home");
mkdirSync(home, { mode: 0o700 });
const steps = [];
function step(name, command, cwd, prefix) {
  const env = {
    HOME: home,
    PATH: `${join(prefix ?? join(root, "none"), "bin")}:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH}`,
    npm_config_prefix: prefix ?? join(root, "none"),
    npm_config_cache: join(root, "npm-cache"),
    npm_config_update_notifier: "false",
    NO_COLOR: "1",
  };
  const started = Date.now();
  const ran = spawnSync("sh", ["-c", command], { cwd, env, encoding: "utf8", timeout: 900_000 });
  const output = `${ran.stdout}\n${ran.stderr}`.trim().split("\n").filter(Boolean);
  steps.push({ name, command, exitCode: ran.status, elapsedMs: Date.now() - started, head: output.slice(0, 2).map((l) => l.slice(0, 200)), tail: output.slice(-1).map((l) => l.slice(0, 200)) });
  return ran;
}
const source = join(root, "branch");
const prefix = join(root, "prefix");
// A full clone, as the README's own line is: its tags are what a build describes itself against.
step("clone the branch", `git clone -q --branch ${values.branch} ${url} ${source}`, root);
const head = spawnSync("git", ["-C", source, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
step("npm ci", "npm ci --no-audit --no-fund", source, prefix);
step("npm pack", "npm pack", source, prefix);
const tarball = readdirSync(source).find((name) => name.endsWith(".tgz"));
step("install the tarball globally", `npm install -g ./${tarball}`, source, prefix);
step("version", "swarm --version", root, prefix);
step("help", "swarm --help", root, prefix);
const scratch = join(root, "scratch");
mkdirSync(scratch);
// The README's scratch repository, as far as a run needs it to start: a manifest, committed.
writeFileSync(join(scratch, "package.json"), '{ "type": "module", "scripts": { "test": "node --test" } }\n');
spawnSync("sh", ["-c", "git init -q && git add -A && git -c user.name=t -c user.email=t@example.com commit -q -m start"], { cwd: scratch });
step("a misspelt flag", 'swarm "make a change" --plan-check', scratch, prefix);
step("no reachable model", 'swarm "make a change" --model local:qwen3.6:35b-a3b --local-endpoint http://127.0.0.1:9/v1 --no-tui', scratch, prefix);
const released = join(root, "released");
step("install the npm release", "npm install -g swarm-orchestrator", root, released);
step("the release's version", "swarm --version", root, released);
const main = join(root, "default");
step("clone the default branch", `git clone -q --depth 1 ${url} ${main}`, root);
const defaultHead = spawnSync("git", ["-C", main, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
writeFileSync(values.out, `${JSON.stringify({ schema: "swarm-remote-install.v1", url, branch: values.branch, head, defaultHead, ranAt: new Date().toISOString(), node: process.version, steps }, null, 2)}\n`);
console.log(JSON.stringify(steps.map((one) => [one.name, one.exitCode, one.head[0]]), null, 1));
