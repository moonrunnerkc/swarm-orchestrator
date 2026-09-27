#!/usr/bin/env node
/**
 * Roll the swarm-verify Action out to one owned repository through an ordinary branch and pull
 * request: clone it fresh, add the workflow pinned to an exact distribution commit, commit,
 * push the branch and open the pull request. Nothing here touches the default branch, disables
 * a protection or deploys anything; the pull request is where the first signed verdict lands
 * and where a person merges.
 *
 *   node scripts/rollout-action.mjs <owner/repo> <distribution sha> <version label> [--install] [--image <image>] [--dry-run]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const [repository, sha, label] = args;
const install = args.includes("--install");
const dryRun = args.includes("--dry-run");
const imageIndex = args.indexOf("--image");
const image = imageIndex === -1 ? null : args[imageIndex + 1];
if (!repository || !/^[0-9a-f]{40}$/.test(sha ?? "") || !label) {
  console.error(
    "usage: rollout-action.mjs <owner/repo> <distribution sha> <version label> [--install] [--image <image>] [--dry-run]",
  );
  process.exit(2);
}

const workflow = `# Added by the swarm-verify rollout. Verifies each pull request's head in a network-disabled
# container, signs the verdict as a GitHub attestation and posts one comment bound to the head.
# Pinned by full commit; the tag it corresponds to is in the comment beside the pin.
name: swarm-verify
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
  id-token: write
  attestations: write
  artifact-metadata: write
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: moonrunnerkc/swarm-verify@${sha} # ${label}
${install || image !== null ? "        with:\n" : ""}${install ? "          install: true\n" : ""}${image === null ? "" : `          image: ${image}\n`}`;

const scratch = mkdtempSync(join(tmpdir(), "swarm-rollout-"));
const checkout = join(scratch, "repo");
const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();

run("gh", ["repo", "clone", repository, checkout, "--", "--quiet", "--depth", "50"]);
const defaultBranch = run("git", ["rev-parse", "--abbrev-ref", "origin/HEAD"], {
  cwd: checkout,
}).replace("origin/", "");
const branch = "swarm-verify-rollout";
run("git", ["checkout", "-q", "-b", branch], { cwd: checkout });
mkdirSync(join(checkout, ".github", "workflows"), { recursive: true });
const path = join(checkout, ".github", "workflows", "swarm-verify.yml");
writeFileSync(path, workflow);
console.log(`${repository}: default branch ${defaultBranch}, workflow written:\n${workflow}`);
if (dryRun) {
  console.log("dry run: nothing committed or pushed");
  process.exit(0);
}
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
    `Verify pull requests with swarm-verify ${label}\n\nAdds the swarm-verify Action, pinned to ${sha}: each pull request's head is verified in a\nnetwork-disabled container, the verdict is signed as a GitHub attestation, and one comment\nbound to the head says what was measured and what was not.`,
  ],
  { cwd: checkout },
);
run("git", ["push", "-q", "-u", "origin", branch], { cwd: checkout });
const url = run(
  "gh",
  [
    "pr",
    "create",
    "--repo",
    repository,
    "--base",
    defaultBranch,
    "--head",
    branch,
    "--title",
    `Verify pull requests with swarm-verify ${label}`,
    "--body",
    `Adds the swarm-verify Action pinned to \`${sha}\` (${label}). The first run on this pull request is the rollout control: a regression-only verdict over this repository's declared checks, signed as a GitHub attestation, posted as one comment bound to the head. Task correctness is unmeasured here, since no requirement contract is supplied, and the comment says so.\n\nNothing else changes: existing workflows and deployment stay as they are.`,
  ],
  { cwd: checkout },
);
console.log(`pull request: ${url}`);
