#!/usr/bin/env node
/**
 * The post-launch exposure search the protocol registers: every launch record of the stage, both
 * arms, its invocations' whole output streams (the runner's content-addressed blobs) and, for
 * Swarm, its evidence directory, searched for a route to the sealed material: the mirror's path,
 * this repository's path (where the hidden checks live), and the upstream commit ids in full and
 * short. A hit names the launch, the stream and the pattern; nothing is inferred from it.
 *
 *   node exposure-search.mjs --manifest <stage manifest.json> --records <runs directory> --out <json>
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { comparisonRoot } from "../../../../scripts/comparison/workspace.mjs";

const { values } = parseArgs({
  options: { manifest: { type: "string" }, records: { type: "string" }, out: { type: "string" } },
});
for (const name of ["manifest", "records", "out"])
  if (values[name] === undefined) throw new Error(`--${name} is required`);
const out = resolve(values.out);
if (existsSync(out)) throw new Error(`${out} exists; a record is never overwritten`);
const manifest = JSON.parse(readFileSync(resolve(values.manifest), "utf8"));
const blobs = join(comparisonRoot, "blobs");

const results = [];
for (const name of readdirSync(resolve(values.records)).sort()) {
  if (!/\.(swarm|opencode)(\.halted-\d+)?\.json$/.test(name)) continue;
  const record = JSON.parse(readFileSync(join(resolve(values.records), name), "utf8"));
  const task = manifest.tasks.find((one) => one.id === record.task);
  // The protocol's three: the mirror's path, this repository's path, the upstream commit ids.
  const patterns = [
    "swarm-comparison/mirrors",
    "projects/swarm-orchestrator",
    task.upstreamCommit,
    task.upstreamCommit.slice(0, 9),
  ];
  const sources = record.invocations.flatMap((invocation, index) =>
    ["stdoutDigest", "stderrDigest"]
      .filter((field) => typeof invocation[field] === "string")
      .map((field) => ({
        label: `invocation ${index} ${field.replace("Digest", "")}`,
        path: join(blobs, invocation[field].slice(7)),
      })),
  );
  const evidence = record.invocations.map((one) => one.evidenceDirectory).filter(Boolean);
  const hits = [];
  for (const source of sources) {
    if (!existsSync(source.path)) {
      hits.push({ source: source.label, pattern: null, note: "stream blob not on this machine" });
      continue;
    }
    const text = readFileSync(source.path, "utf8");
    for (const pattern of patterns)
      if (text.includes(pattern)) hits.push({ source: source.label, pattern });
  }
  for (const directory of evidence) {
    if (!existsSync(directory)) continue;
    for (const pattern of patterns) {
      const found = spawnSync("grep", ["-rlF", "-e", pattern, directory], { encoding: "utf8" });
      for (const file of found.stdout.trim().split("\n").filter(Boolean))
        hits.push({ source: file, pattern });
    }
  }
  results.push({
    record: name,
    task: record.task,
    arm: record.arm,
    streamsSearched: sources.length,
    evidenceDirectories: evidence,
    hits,
  });
}
writeFileSync(out, `${JSON.stringify({ patternsNote: "per task: the mirror path, this repository's path, the upstream id full and short", results }, null, 2)}\n`);
for (const one of results)
  console.log(`${one.record}: ${one.hits.length === 0 ? "no hit" : one.hits.map((hit) => `${hit.pattern} in ${hit.source}`).join("; ")}`);
