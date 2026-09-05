#!/usr/bin/env node
// Moves a bundle's blobs out of the repository, leaving their digests behind.
//
// The manifest is written before anything is removed. A process killed between the two leaves
// the blobs and no manifest, which is recoverable; the other order leaves a manifest and no
// blobs and nothing to rebuild it from.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { offloadBlobs, offloadDerivedArtifacts } from "../dist/evidence/blob-manifest.js";

/**
 * Bundles the suite actually runs against. These are minimal fixtures rather than bulk
 * evidence: offloading one would leave a test asserting on blobs that are not there, which is a
 * test that stops proving anything rather than a test that fails.
 */
/**
 * Bundles the suite runs against. Their blobs stay: a test asserting on blobs that are not there
 * is a test that stops proving anything rather than one that fails. Their rendered pages do not,
 * because nothing reads those and one of them is eleven megabytes on its own.
 */
const keptBlobs = [
  "docs/evidence/2026-08-18/live-frontier",
  "docs/evidence/2026-08-18/live-local",
  "docs/evidence/2026-08-23/calibration",
];

/**
 * Only files git is tracking. This script deletes, and git history is the whole of what makes
 * deleting recoverable: a file git has never seen is a file this cannot put back. It removed 89
 * MB of somebody's uncommitted corpus once, and nothing in the script's own logic objected,
 * because the logic was about size and the question was about ownership.
 */
const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { maxBuffer: 256 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0),
);

const roots = process.argv.slice(2);
if (roots.length === 0) {
  console.error(
    "usage: node scripts/offload-bundle-blobs.mjs <directory>...\n" +
      "Walks each directory for `blobs/` folders and offloads every one it finds.",
  );
  process.exit(2);
}

function blobDirectoriesUnder(root) {
  const found = [];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const path = join(directory, entry.name);
      if (entry.name === "blobs") {
        if (keptBlobs.some((keep) => path.startsWith(keep))) {
          continue;
        }
        found.push(path);
      } else {
        walk(path);
      }
    }
  };
  walk(root);
  return found;
}

/** Big enough that removing it is worth the indirection, small enough to catch every one. */
const derivedOverBytes = 128 * 1024;

function directoriesUnder(root) {
  const found = [root];
  const walk = (directory) => {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const path = join(directory, entry.name);
        found.push(path);
        walk(path);
      }
    }
  };
  walk(root);
  return found;
}

let freed = 0;
for (const root of roots) {
  for (const directory of directoriesUnder(root)) {
    const derived = await offloadDerivedArtifacts(directory, {
      overBytes: derivedOverBytes,
      keepUntracked: (name) => !tracked.has(join(directory, name)),
    });
    if (derived.offloaded.length > 0) {
      freed += derived.removedBytes;
      console.log(
        `${directory}: ${derived.offloaded.length} derived artifact(s), ` +
          `${(derived.removedBytes / 1024 / 1024).toFixed(1)} MB`,
      );
    }
  }
  for (const blobs of blobDirectoriesUnder(root)) {
    const held = readdirSync(blobs).filter((name) => tracked.has(join(blobs, name)));
    if (held.length === 0) {
      const untracked = readdirSync(blobs).length;
      if (untracked > 0) {
        console.log(`${blobs}: skipped, ${untracked} blob(s) git does not track`);
      }
      continue;
    }
    const offloaded = await offloadBlobs(blobs);
    freed += offloaded.removedBytes;
    console.log(
      `${blobs}: ${offloaded.manifest.blobs.length} blob(s), ` +
        `${(offloaded.removedBytes / 1024 / 1024).toFixed(1)} MB -> ${offloaded.manifestPath}`,
    );
  }
}

console.log(`freed ${(freed / 1024 / 1024).toFixed(1)} MB from the tracked tree`);
