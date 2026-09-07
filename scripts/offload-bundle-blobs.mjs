#!/usr/bin/env node
// Moves a bundle's large derived artifacts out of the repository, leaving their digests behind.
//
// It used to move the blobs too, and that was wrong. A blob is a ledger record's payload, so a
// bundle without them fails its own verifier: 47 of 51 bundles in this tree stopped verifying
// from a clone, four of them cited in the README and claims.md as evidence that verifies. A
// project whose thesis is that every claim resolves to checkable evidence cannot ship evidence
// that does not check, and 23 MB was never worth it. Derived artifacts are different in kind:
// a rendered review page is regenerated from the records, so removing one costs nothing a reader
// cannot rebuild.
//
// The manifest is written before anything is removed. A process killed between the two leaves
// the artifacts and no manifest, which is recoverable; the other order leaves a manifest and
// nothing to rebuild it from. Restore with scripts/restore-bundle-blobs.mjs.
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

/** The files in a directory, or none where there is no such directory. */
const namesIn = (path) => {
  try {
    return readdirSync(path);
  } catch {
    return [];
  }
};
import { join } from "node:path";
import { offloadBlobs, offloadDerivedArtifacts } from "../dist/evidence/blob-manifest.js";

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

const argv = process.argv.slice(2);
const alsoPayloads = argv.includes("--payloads");
const roots = argv.filter((one) => !one.startsWith("--"));
if (roots.length === 0) {
  console.error(
    "usage: node scripts/offload-bundle-blobs.mjs <directory>...\n" +
      "Walks each directory for `blobs/` folders and offloads every one it finds.",
  );
  process.exit(2);
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
    if (!alsoPayloads) {
      continue;
    }
    const blobs = join(directory, "blobs");
    const held = namesIn(blobs).filter((name) => tracked.has(join(blobs, name)));
    if (held.length === 0) {
      continue;
    }
    const offloaded = await offloadBlobs(blobs);
    freed += offloaded.removedBytes;
    console.log(
      `${blobs}: ${offloaded.manifest.blobs.length} payload(s), ` +
        `${(offloaded.removedBytes / 1024 / 1024).toFixed(1)} MB -> ${offloaded.manifestPath}`,
    );
  }
}

console.log(`freed ${(freed / 1024 / 1024).toFixed(1)} MB from the tracked tree`);
