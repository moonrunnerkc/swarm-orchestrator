#!/usr/bin/env node
/**
 * What the study's working area holds, read-only. Runs under the versioned layout are listed
 * with their identity and each arm's attempts; everything else at the top of the working root
 * (the unversioned clones, `diffs/`, `reports/`, `bundles/`, `bundles-a2/` of the runs before the
 * layout existed) is listed and labelled legacy. Nothing is moved, rewritten or deleted.
 *
 *   node scripts/ai-pr-study/inventory.mjs [--working-root <dir>] [--json]
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { layoutPaths, layoutVersion } from "./attempts.mjs";

/** Count the regular files under a directory, without following symlinks. */
function countFiles(directory) {
  let files = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const status = lstatSync(join(dir, name));
      if (status.isDirectory()) walk(join(dir, name));
      else if (status.isFile()) files += 1;
    }
  };
  walk(directory);
  return files;
}

/** The inventory of a working root: `{ runs, objects, legacy }`. */
export function inventory(workingRoot) {
  const result = { workingRoot, layout: layoutVersion, runs: [], objects: [], legacy: [] };
  if (!existsSync(workingRoot)) return result;
  const layout = layoutPaths(workingRoot);
  if (existsSync(layout.runs))
    for (const runId of readdirSync(layout.runs).sort()) {
      const manifestPath = join(layout.runs, runId, "run.json");
      const manifest = existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : null;
      const rowsDirectory = join(layout.runs, runId, "rows");
      const attempts = {};
      const unfinished = [];
      if (existsSync(rowsDirectory))
        for (const name of readdirSync(rowsDirectory)) {
          const match = name.match(/^(\d+)\.([a-z0-9]+)\.attempt-(\d+)(\.started)?\.json$/);
          if (match === null) continue;
          if (match[4] === undefined) attempts[match[2]] = (attempts[match[2]] ?? 0) + 1;
          else if (!existsSync(join(rowsDirectory, name.replace(".started.json", ".json"))))
            unfinished.push(`${match[1]}.${match[2]}.attempt-${match[3]}`);
        }
      result.runs.push({
        runId,
        manifest: manifest === null ? "missing" : "present",
        development: manifest?.development ?? null,
        verifierVersion: manifest?.verifierVersion ?? null,
        harnessCommit: manifest?.harnessCommit ?? null,
        createdAt: manifest?.createdAt ?? null,
        finishedAttempts: attempts,
        unfinishedAttempts: unfinished.sort(),
      });
    }
  if (existsSync(layout.objects)) result.objects = readdirSync(layout.objects).sort();
  for (const name of readdirSync(workingRoot).sort()) {
    if (name === layoutVersion) continue;
    const path = join(workingRoot, name);
    const status = lstatSync(path);
    const kind = !status.isDirectory()
      ? "file"
      : existsSync(join(path, ".git"))
        ? "unversioned clone"
        : ["diffs", "reports", "bundles", "bundles-a2"].includes(name)
          ? "unversioned results"
          : "directory";
    result.legacy.push({
      name,
      kind,
      label: "legacy (before the versioned layout; kept, not reused)",
      files: kind === "unversioned results" ? countFiles(path) : undefined,
    });
  }
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--working-root");
  const { defaultWorkingRoot } = await import("./study-run.mjs");
  const root = at === -1 ? defaultWorkingRoot : args[at + 1];
  const found = inventory(root);
  if (args.includes("--json")) console.log(JSON.stringify(found, null, 2));
  else {
    console.log(`working root ${found.workingRoot} (layout ${found.layout})`);
    console.log(`\nruns (${found.runs.length}):`);
    for (const entry of found.runs)
      console.log(
        `  ${entry.runId}${entry.development ? " [development]" : ""}: verifier ${entry.verifierVersion}, harness ${entry.harnessCommit?.slice(0, 12)}, created ${entry.createdAt}; finished attempts ${JSON.stringify(entry.finishedAttempts)}${entry.unfinishedAttempts.length > 0 ? `; unfinished ${entry.unfinishedAttempts.join(", ")}` : ""}`,
      );
    console.log(
      `\nversioned object clones (${found.objects.length}): ${found.objects.join(", ") || "none"}`,
    );
    console.log(`\nlegacy (${found.legacy.length}):`);
    for (const entry of found.legacy)
      console.log(
        `  ${entry.name}: ${entry.kind}${entry.files === undefined ? "" : `, ${entry.files} file(s)`}; ${entry.label}`,
      );
  }
}
