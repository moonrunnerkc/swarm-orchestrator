#!/usr/bin/env node
/**
 * Freezes the one manifest of [protocol.md](protocol.md) for the comparison runner, which
 * launches it unchanged. The runner's own `--freeze` writes the task set, the resolved commits,
 * the harness digest, this protocol's digest and the request bounds it declares by default; this
 * narrows it to one task and one Swarm launch with `--plan-checks`, pins the model, the endpoint
 * and the frozen Swarm build (its entry file's bytes and its whole `dist/` tree's digest), and sets
 * the limits the protocol states. Nothing is launched here.
 *
 *   node freeze.mjs --out <manifest.json> --build <commit> --purpose "<text>"
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: { out: { type: "string" }, build: { type: "string" }, purpose: { type: "string" } },
});
for (const name of ["out", "build", "purpose"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const repository = new URL("../../../../", import.meta.url).pathname;
const out = resolve(values.out);
const build = values.build;
const tool = join(homedir(), `.cache/swarm-comparison/tools/swarm-${build.slice(0, 9)}`);
const swarmCli = join(tool, "dist/cli.js");
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** The sorted per-file SHA-256 list of `dist/`, hashed: the whole built tree's identity. */
function distTreeDigest(root) {
  const files = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(root);
  files.sort();
  const list = files
    .map((path) => `${digest(readFileSync(path))}  ${relative(root, path)}`)
    .join("\n");
  return { digest: digest(`${list}\n`), files: files.length };
}

const frozen = spawnSync(
  process.execPath,
  [
    "scripts/comparison/run.mjs",
    "--freeze",
    "--out",
    out,
    "--protocol",
    "docs/evidence/2026-10-19/endpoint-readiness-trial/protocol.md",
    "--swarm-revision",
    build,
  ],
  { cwd: repository, encoding: "utf8" },
);
if (frozen.status !== 0) throw new Error(`the runner did not freeze: ${frozen.stderr}`);
const manifest = JSON.parse(readFileSync(out, "utf8"));
const tree = distTreeDigest(join(tool, "dist"));
const pinned = {
  ...manifest,
  purpose: values.purpose,
  pins: {
    ...manifest.pins,
    model: "qwen3.6:35b-a3b",
    endpoint: "http://127.0.0.1:11434/v1",
    swarmCli,
    swarmRevision: build,
    swarmCliDigest: digest(readFileSync(swarmCli)),
    swarmDistTreeDigest: tree.digest,
    swarmDistFiles: tree.files,
    swarmFlags: ["--plan-checks"],
  },
  budgets: {
    ...manifest.budgets,
    // Fourteen minutes and half a second, so Swarm's whole minutes come to 14 however many
    // milliseconds pass between the deadline and the spawn; the kill falls at fifteen minutes.
    wallMsPerInvocation: 14 * 60_000 + 500,
    wallGraceMs: 59_500,
    swarmVerificationReserveMs: 0,
    maxCorrections: 0,
    // The request bounds the protocol declares: three minutes of quiet on an open model call,
    // thirty seconds per readiness request, ninety per sequence, two sequences at most.
    inferenceDeadlineMs: 180_000,
    readinessRequestDeadlineMs: 30_000,
    readinessSequenceDeadlineMs: 90_000,
    readinessSequences: 2,
  },
  tasks: manifest.tasks.filter((one) => one.id === "marked-bugfix-www-case"),
  launches: [{ task: "marked-bugfix-www-case", arm: "swarm", order: 1 }],
};
if (pinned.tasks.length !== 1) throw new Error("marked-bugfix-www-case is not in the task set");
writeFileSync(out, `${JSON.stringify(pinned, null, 2)}\n`);
console.log(
  JSON.stringify(
    { out, digest: digest(readFileSync(out)), pins: pinned.pins, budgets: pinned.budgets },
    null,
    2,
  ),
);
