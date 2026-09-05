import { createHash } from "node:crypto";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ownerOnlyFile } from "./store-mode.ts";

/**
 * Moving bulk evidence out of the repository, without moving out the ability to check it.
 *
 * Blobs are the whole of this repository's weight: a fresh clone carries hundreds of megabytes
 * of prompts and tool output that almost nobody reads and everybody downloads. They can live
 * somewhere else. What cannot live somewhere else is the ability to say whether a restored copy
 * is the same bytes, so the digests stay committed: an offload without them is a deletion with a
 * promise attached.
 */
export interface BlobManifestEntry {
  readonly name: string;
  readonly digest: string;
  readonly bytes: number;
}

export interface BlobManifest {
  readonly version: 1;
  readonly blobs: readonly BlobManifestEntry[];
  readonly totalBytes: number;
  readonly note: string;
}

export const blobManifestFileName = "blobs.digests.json";

export async function buildBlobManifest(blobsDirectory: string): Promise<BlobManifest> {
  const names = (await readdir(blobsDirectory)).sort();
  const blobs: BlobManifestEntry[] = [];
  for (const name of names) {
    const path = join(blobsDirectory, name);
    if (!(await stat(path)).isFile()) {
      continue;
    }
    const bytes = await readFile(path);
    blobs.push({
      name,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      bytes: bytes.length,
    });
  }
  return {
    version: 1,
    blobs,
    totalBytes: blobs.reduce((total, blob) => total + blob.bytes, 0),
    note:
      "These blobs are stored outside the repository. Restore them into this directory and " +
      "check them against this file: every name must be present and every digest must match. " +
      "A restored copy that does not verify is not the evidence this bundle refers to.",
  };
}

export interface ManifestCheck {
  readonly verified: boolean;
  readonly missing: readonly string[];
  readonly mismatched: readonly string[];
  readonly extra: readonly string[];
}

export async function verifyAgainstManifest(
  blobsDirectory: string,
  manifest: BlobManifest,
): Promise<ManifestCheck> {
  const present = new Set<string>();
  try {
    for (const name of await readdir(blobsDirectory)) {
      present.add(name);
    }
  } catch {
    // A directory that is not there holds nothing, which the missing list below then says.
  }

  const missing: string[] = [];
  const mismatched: string[] = [];
  for (const blob of manifest.blobs) {
    if (!present.has(blob.name)) {
      missing.push(blob.name);
      continue;
    }
    present.delete(blob.name);
    const bytes = await readFile(join(blobsDirectory, blob.name));
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== blob.digest) {
      mismatched.push(blob.name);
    }
  }

  return {
    // Extra files do not fail the check: a restored directory may carry a README beside the
    // blobs. Missing and changed both do, because either means the evidence is not the same.
    verified: missing.length === 0 && mismatched.length === 0,
    missing,
    mismatched,
    extra: [...present].sort(),
  };
}

export interface Offloaded {
  readonly manifest: BlobManifest;
  readonly manifestPath: string;
  readonly removedBytes: number;
}

/**
 * Writes the manifest first and removes the blobs second, never the other way round. A process
 * killed between the two leaves the blobs and no manifest, which is recoverable; the other order
 * leaves the manifest and no blobs and nothing to rebuild it from.
 */
export async function offloadBlobs(blobsDirectory: string): Promise<Offloaded> {
  let manifest: BlobManifest;
  try {
    manifest = await buildBlobManifest(blobsDirectory);
  } catch (cause) {
    throw new Error(
      `there are no blobs at ${blobsDirectory} to offload (${
        cause instanceof Error ? cause.message : String(cause)
      })`,
    );
  }

  const manifestPath = join(dirname(blobsDirectory), blobManifestFileName);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: ownerOnlyFile,
  });

  for (const blob of manifest.blobs) {
    await rm(join(blobsDirectory, blob.name), { force: true });
  }

  return { manifest, manifestPath, removedBytes: manifest.totalBytes };
}

/** What a person restoring a copy is told to run, named rather than left to be worked out. */
export function restoreVerification(blobsDirectory: string): string {
  return (
    `restore the blobs into ${blobsDirectory}, then check them against ` +
    `${join(dirname(blobsDirectory), blobManifestFileName)}: every name present, every digest ` +
    "matching. A copy that does not verify is not the evidence this bundle refers to."
  );
}

/**
 * Derived artifacts, which are the rest of the weight once the blobs are gone: a rendered review
 * page, a raw run transcript, a raw search result set. Each is a view of, or a log beside, the
 * evidence rather than the evidence itself, so each can live elsewhere with its digest committed.
 *
 * The chain, the DAG and the manifest never move whatever their size. They are what the bundle
 * is, and a bundle whose ledger lives somewhere else is a promise rather than a record.
 */
const derivedNames: readonly RegExp[] = [
  /^review\.html$/,
  /^run-transcript\.txt$/,
  /\.jsonl\.gz$/,
  /^candidates\.json$/,
];

const neverOffloaded: ReadonlySet<string> = new Set([
  "ledger.jsonl",
  "dag.json",
  "manifest.json",
  "verify.mjs",
  "rederive.mjs",
  blobManifestFileName,
]);

export interface DerivedOffload {
  readonly offloaded: readonly BlobManifestEntry[];
  readonly manifest: BlobManifest | null;
  readonly removedBytes: number;
}

export async function offloadDerivedArtifacts(
  directory: string,
  options: {
    readonly overBytes: number;
    /**
     * Files to leave alone whatever their size. The caller passes "git is not tracking this",
     * because deleting is only recoverable through history and a file history has never seen
     * cannot be put back.
     */
    readonly keepUntracked?: (name: string) => boolean;
  },
): Promise<DerivedOffload> {
  const entries = await readdir(directory, { withFileTypes: true });
  const chosen: BlobManifestEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || neverOffloaded.has(entry.name)) {
      continue;
    }
    if (!derivedNames.some((pattern) => pattern.test(entry.name))) {
      continue;
    }
    if (options.keepUntracked?.(entry.name) === true) {
      continue;
    }
    const path = join(directory, entry.name);
    const bytes = await readFile(path);
    if (bytes.length <= options.overBytes) {
      continue;
    }
    chosen.push({
      name: entry.name,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      bytes: bytes.length,
    });
  }

  if (chosen.length === 0) {
    return { offloaded: [], manifest: null, removedBytes: 0 };
  }

  // Merged into the same manifest the blobs use, so one file says what is missing from here.
  const manifestPath = join(directory, blobManifestFileName);
  let existing: BlobManifest | null = null;
  try {
    existing = JSON.parse(await readFile(manifestPath, "utf8")) as BlobManifest;
  } catch {
    existing = null;
  }
  const merged: BlobManifest = {
    version: 1,
    blobs: [...(existing?.blobs ?? []), ...chosen].sort((left, right) =>
      left.name < right.name ? -1 : 1,
    ),
    totalBytes: (existing?.totalBytes ?? 0) + chosen.reduce((total, one) => total + one.bytes, 0),
    note:
      existing?.note ??
      "These files are stored outside the repository. Restore them into this directory and " +
        "check them against this file: every name must be present and every digest must match.",
  };
  await writeFile(manifestPath, `${JSON.stringify(merged, null, 2)}\n`, {
    encoding: "utf8",
    mode: ownerOnlyFile,
  });

  for (const entry of chosen) {
    await rm(join(directory, entry.name), { force: true });
  }

  return {
    offloaded: chosen,
    manifest: merged,
    removedBytes: chosen.reduce((total, one) => total + one.bytes, 0),
  };
}
