#!/usr/bin/env node
// The tracked working tree's weight, held to a ceiling.
//
// Bulk evidence blobs are the whole of this repository's size: hundreds of megabytes of prompts
// and tool output that almost nobody reads and everybody downloads. Removing them once fixes a
// number; a check that fails when they come back fixes the cause. The digests stay committed, so
// an offloaded bundle is still checkable, which is the property that makes the removal safe.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

const ceilingBytes = 50 * 1024 * 1024;

// A repository this size overruns execFileSync's default buffer, and the failure is a decoded
// byte array rather than an error anybody can read.
const tracked = execFileSync("git", ["ls-files", "-z"], { maxBuffer: 64 * 1024 * 1024 })
  .toString("utf8")
  .split("\0")
  .filter((path) => path.length > 0);

let total = 0;
const heaviest = [];
for (const path of tracked) {
  let size = 0;
  try {
    size = statSync(path).size;
  } catch {
    continue;
  }
  total += size;
  heaviest.push({ path, size });
}

heaviest.sort((left, right) => right.size - left.size);

const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
console.log(`tracked working tree: ${megabytes(total)} across ${tracked.length} file(s)`);

if (total > ceilingBytes) {
  console.error(
    `the tracked tree is ${megabytes(total)}, over the ${megabytes(ceilingBytes)} ceiling.\n` +
      "Bulk evidence blobs belong outside the repository with their digests committed beside " +
      "them: see src/evidence/blob-manifest.ts and scripts/offload-bundle-blobs.mjs.\n" +
      "The heaviest tracked paths:",
  );
  for (const entry of heaviest.slice(0, 10)) {
    console.error(`  ${megabytes(entry.size).padStart(9)}  ${entry.path}`);
  }
  process.exit(1);
}

console.log(`under the ${megabytes(ceilingBytes)} ceiling.`);
