#!/usr/bin/env node
/**
 * Puts offloaded payloads back into evidence bundles, from the session blob store.
 *
 * `blobs.digests.json` tells a reader to restore the blobs and check them against it, and for a
 * while nothing said where from. This is the where from. A bundle missing its payloads fails its
 * own verifier, so a bundle nobody can restore is a bundle nobody can check.
 *
 *   node scripts/restore-bundle-blobs.mjs                 # every bundle under docs/evidence
 *   node scripts/restore-bundle-blobs.mjs <dir>...        # named bundles
 *   node scripts/restore-bundle-blobs.mjs --store <dir>   # default ~/.swarm/sessions
 *
 * A payload is written only where its content hashes to the digest the manifest names.
 */
import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { restoreBlobs } from "../dist/evidence/blob-restore.js";

const repositoryRoot = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const storeAt = argv.indexOf("--store");
const store = storeAt === -1 ? join(homedir(), ".swarm", "sessions") : argv[storeAt + 1];
const named = argv.filter((one, index) => !one.startsWith("--") && index !== storeAt + 1);

function bundlesUnder(directory, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  if (entries.some((entry) => entry.name === "blobs.digests.json")) found.push(directory);
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== "blobs") {
      bundlesUnder(join(directory, entry.name), found);
    }
  }
  return found;
}

const bundles =
  named.length > 0 ? named : bundlesUnder(join(repositoryRoot, "docs/evidence")).sort();

console.log(`restoring ${bundles.length} bundle(s) from ${store}\n`);

let restoredTotal = 0;
let incomplete = 0;
let alreadyComplete = 0;
let derivedAbsent = 0;
for (const bundle of bundles) {
  const done = await restoreBlobs({ bundle, store });
  restoredTotal += done.copied;
  const relative = bundle.replace(repositoryRoot, "");
  if (done.missingDerived.length > 0) derivedAbsent += done.missingDerived.length;
  if (done.missing.length === 0 && done.corrupt.length === 0) {
    if (done.copied > 0) console.log(`  restored ${String(done.copied).padStart(5)}  ${relative}`);
    else alreadyComplete += 1;
    continue;
  }
  incomplete += 1;
  console.log(
    `  INCOMPLETE      ${relative}: ${done.copied} restored, ` +
      `${done.missing.length} not in the store` +
      (done.corrupt.length > 0 ? `, ${done.corrupt.length} held under the wrong content` : ""),
  );
}

console.log(
  `\n${restoredTotal} payload(s) restored, ${alreadyComplete} bundle(s) already complete, ` +
    `${incomplete} incomplete`,
);
if (derivedAbsent > 0) {
  console.log(
    `${derivedAbsent} derived artifact(s) were not restored. A bundle regenerates those from its\n` +
      "own records, so their absence does not stop it verifying and is not counted as incomplete.",
  );
}
if (incomplete > 0) {
  console.log(
    "An incomplete bundle cannot verify. Its payloads are in the session store of the machine\n" +
      "that produced the run, which is outside this repository by design: point --store at it.",
  );
}
