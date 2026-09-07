import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Puts a bundle's offloaded payloads back, from a blob store that still holds them.
 *
 * Bulk evidence is moved out of the repository to keep it clonable, leaving `blobs.digests.json`
 * behind. That file says to restore the blobs and check them, and until this existed nothing said
 * how, which made a documented recovery path a documented intention. A bundle whose payloads are
 * absent fails its own verifier, so an evidence bundle nobody can restore is an evidence bundle
 * nobody can check.
 *
 * Content addressing is what makes this safe to automate: a candidate is accepted only where it
 * hashes to the digest the manifest names, so a store holding the wrong file for a name is
 * reported rather than copied over the top.
 */
export interface BlobRestoreResult {
  readonly copied: number;
  /** Payloads the bundle already held, correct, before anything was restored. */
  readonly alreadyPresent: number;
  /** Digests of ledger payloads no store under the root held. A bundle missing one cannot verify. */
  readonly missing: readonly string[];
  /**
   * Names of derived artifacts no store held, a rendered review page say. A bundle regenerates
   * these from its own records, so their absence is not a failure to verify and is not counted
   * beside one.
   */
  readonly missingDerived: readonly string[];
  /** Digests a store held under the right name, whose content hashes to something else. */
  readonly corrupt: readonly string[];
}

interface BlobEntry {
  readonly name: string;
  readonly digest: string;
}

/** Every `blobs/` directory under the store root, one per session, searched in listing order. */
async function blobDirectories(store: string): Promise<string[]> {
  const found: string[] = [];
  const direct = join(store, "blobs");
  if (await isDirectory(direct)) found.push(direct);
  let entries: string[] = [];
  try {
    entries = await readdir(store);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const nested = join(store, entry, "blobs");
    if (await isDirectory(nested)) found.push(nested);
  }
  return found;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export async function restoreBlobs(input: {
  bundle: string;
  store: string;
}): Promise<BlobRestoreResult> {
  const manifest = JSON.parse(await readFile(join(input.bundle, "blobs.digests.json"), "utf8")) as {
    blobs?: readonly BlobEntry[];
  };
  const wanted = manifest.blobs ?? [];
  const directories = await blobDirectories(input.store);
  const destination = join(input.bundle, "blobs");
  await mkdir(destination, { recursive: true });

  let copied = 0;
  let alreadyPresent = 0;
  const missing: string[] = [];
  const missingDerived: string[] = [];
  const corrupt: string[] = [];

  for (const entry of wanted) {
    // A payload the bundle already holds needs no store. Counting it as missing would send a
    // reader hunting for a store to repair a bundle that already verifies.
    if (await holdsCorrectly(join(destination, entry.name), entry.digest)) {
      alreadyPresent += 1;
      continue;
    }
    let placed = false;
    let sawWrongContent = false;
    for (const directory of directories) {
      const candidate = join(directory, entry.name);
      let content: Buffer;
      try {
        content = await readFile(candidate);
      } catch {
        continue;
      }
      const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
      if (digest !== entry.digest) {
        sawWrongContent = true;
        continue;
      }
      await copyFile(candidate, join(destination, entry.name));
      copied += 1;
      placed = true;
      break;
    }
    if (placed) continue;
    // A store that held the name but not the content is a different finding from a store that
    // held neither, and collapsing them would hide a tampered or superseded blob behind "missing".
    if (sawWrongContent) corrupt.push(entry.digest);
    else if (isLedgerPayload(entry)) missing.push(entry.digest);
    else missingDerived.push(entry.name);
  }

  return { copied, alreadyPresent, missing, missingDerived, corrupt };
}

/**
 * Content addressing is the test, not the extension: a ledger payload is stored under its own
 * digest (invariant 4), so a manifest entry whose name is not its digest is a derived artifact.
 */
function isLedgerPayload(entry: BlobEntry): boolean {
  return entry.name === `${entry.digest.replace(/^sha256:/, "")}.json`;
}

async function holdsCorrectly(path: string, digest: string): Promise<boolean> {
  try {
    const content = await readFile(path);
    return `sha256:${createHash("sha256").update(content).digest("hex")}` === digest;
  } catch {
    return false;
  }
}
