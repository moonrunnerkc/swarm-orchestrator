#!/usr/bin/env node
// The tracked working tree's weight, held to a ceiling.
//
// Bulk evidence blobs are the whole of this repository's size: hundreds of megabytes of prompts
// and tool output that almost nobody reads and everybody downloads. Removing them once fixes a
// number; a check that fails when they come back fixes the cause. The digests stay committed, so
// an offloaded bundle is still checkable, which is the property that makes the removal safe.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Where the ceiling sits and why it is not lower.
 *
 * Blob payloads were 409 MB of this tree and are gone. What is left is 72 MB of ledgers, DAGs,
 * manifests, the digests that make the offload checkable, and one self-contained verifier per
 * bundle. Those are the evidence and the ability to check it, so they stay: a bundle whose
 * ledger lives somewhere else is a promise rather than a record, and a verifier that is not
 * beside its bundle is not "verify anywhere".
 *
 * A shallow clone of this tree packs to 19 MB, which is the number a person downloading it
 * actually pays. The ceiling here is on the uncompressed tracked bytes, set where it catches
 * the failure that matters: blobs coming back would take it past 400 MB.
 */
export const ceilingBytes = 100 * 1024 * 1024;

/**
 * Room the next experiment needs, held free at all times and not found missing when it lands.
 *
 * The reach-pressure experiment was committed into a tree at 99.8 MB of 100, so the evidence of a
 * finished run had 0.2 MB to fit in, and the work that followed it had none. A ceiling that is
 * only checked after the bytes exist fails at the one moment nothing can be done but delete
 * something. Sized from what experiments here have cost in tracked bytes: reach-pressure 0.6 MB,
 * the local campaign 1.6 MB, a calibration sweep 7 to 12 MB before its derived artifacts are
 * packed. `node scripts/evidence-pack.mjs pack <root> --name <pack>` is how room is made.
 */
export const requiredHeadroomBytes = 6 * 1024 * 1024;

/** Two failures and not one: past the ceiling, and under it with no room left to work in. */
export function weightVerdict(totalBytes) {
  const headroom = ceilingBytes - totalBytes;
  return {
    headroom,
    status:
      totalBytes > ceilingBytes
        ? "over-ceiling"
        : headroom < requiredHeadroomBytes
          ? "inadequate-headroom"
          : "ok",
  };
}

function main() {
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

  const { status, headroom } = weightVerdict(total);
  if (status === "over-ceiling") {
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

  if (status === "inadequate-headroom") {
    console.error(
      `the tracked tree is ${megabytes(total)}, which leaves ${megabytes(headroom)} under the ` +
        `${megabytes(ceilingBytes)} ceiling and the next experiment needs ${megabytes(requiredHeadroomBytes)}.\n` +
        "Pack derived artifacts (rendered review pages, raw transcripts) losslessly with\n" +
        "`node scripts/evidence-pack.mjs pack <root> --name <pack>` before committing more evidence.\n" +
        "The heaviest tracked paths:",
    );
    for (const entry of heaviest.slice(0, 10)) {
      console.error(`  ${megabytes(entry.size).padStart(9)}  ${entry.path}`);
    }
    process.exit(1);
  }

  console.log(
    `under the ${megabytes(ceilingBytes)} ceiling with ${megabytes(headroom)} of headroom ` +
      `(${megabytes(requiredHeadroomBytes)} required). A shallow clone of this packs to about ` +
      "19 MB, which is what a person downloading it pays.",
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main();
}
