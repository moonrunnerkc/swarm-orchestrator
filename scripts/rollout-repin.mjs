#!/usr/bin/env node
/**
 * Move every open rollout pull request to a newer distribution commit: check out its branch,
 * rewrite the one `uses:` pin, commit and push. The pull request's own run then re-verifies
 * against the new candidate. Nothing else in the repositories is touched.
 *
 *   node scripts/rollout-repin.mjs <distribution sha> <version label> <owner/repo#number>...
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [sha, label, ...pulls] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(sha ?? "") || !label || pulls.length === 0) {
  console.error(
    "usage: rollout-repin.mjs <distribution sha> <version label> <owner/repo#number>...",
  );
  process.exit(2);
}
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();

for (const pull of pulls) {
  const [repository, number] = pull.split("#");
  const branch = run("gh", [
    "pr",
    "view",
    number,
    "--repo",
    repository,
    "--json",
    "headRefName",
    "--jq",
    ".headRefName",
  ]);
  const checkout = join(mkdtempSync(join(tmpdir(), "swarm-repin-")), "repo");
  run("gh", [
    "repo",
    "clone",
    repository,
    checkout,
    "--",
    "--quiet",
    "--depth",
    "50",
    "--branch",
    branch,
  ]);
  const path = join(checkout, ".github", "workflows", "swarm-verify.yml");
  const before = readFileSync(path, "utf8");
  const after = before.replace(
    /uses: moonrunnerkc\/swarm-verify@[0-9a-f]{40} # [^\n]*/,
    `uses: moonrunnerkc/swarm-verify@${sha} # ${label}`,
  );
  if (after === before) {
    console.log(`${pull}: pin unchanged`);
    continue;
  }
  writeFileSync(path, after);
  run("git", ["add", ".github/workflows/swarm-verify.yml"], { cwd: checkout });
  run(
    "git",
    [
      "-c",
      "user.name=moonrunnerkc",
      "-c",
      "user.email=bradkinnard@proton.me",
      "commit",
      "-q",
      "-m",
      `Pin swarm-verify to ${label}`,
    ],
    { cwd: checkout },
  );
  run("git", ["push", "-q", "origin", branch], { cwd: checkout });
  console.log(`${pull}: pinned to ${sha.slice(0, 9)} (${label})`);
}
