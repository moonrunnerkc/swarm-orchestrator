/**
 * Reading a published comparison stage whose files may have been packed in place
 * (`node scripts/evidence-pack.mjs pack-blobs | pack-gz | pack-records`): each pack under a
 * directory's `packed-derived/` holds files by their path relative to that directory, a blob by
 * its hex digest and a gzip file by its path without `.gz`. A pack whose compressed bytes do not
 * match its manifest contributes nothing, so what it held reads as missing, never as other bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { brotliDecompressSync } from "node:zlib";

const digestOf = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/** Every file the packs under `directory/packed-derived` hold, by the path each pack holds it under. */
export function packedFiles(directory) {
  const found = new Map();
  const packs = join(directory, "packed-derived");
  if (!existsSync(packs)) return found;
  for (const name of readdirSync(packs)) {
    const pack = join(packs, name);
    try {
      const manifest = JSON.parse(readFileSync(join(pack, "archive-manifest.json"), "utf8"));
      const compressed = readFileSync(join(pack, "archive.json.br"));
      if (digestOf(compressed) !== manifest.digest) continue;
      const files = JSON.parse(
        brotliDecompressSync(compressed, { maxOutputLength: manifest.expandedBytes }).toString(
          "utf8",
        ),
      );
      for (const [path, content] of Object.entries(files))
        if (path !== "inventory.json") found.set(path, content);
    } catch {}
  }
  return found;
}

/** A stage's record file by path: from the tree, or from the stage's records pack. */
export function readStageRecord(path) {
  if (existsSync(path)) return readFileSync(path, "utf8");
  const content = packedFiles(dirname(dirname(path))).get(`records/${basename(path)}`);
  if (content === undefined)
    throw new Error(`${path} is neither in the tree nor in its stage's packs`);
  return content;
}

/** The record file names of a stage, whether they are in the tree or in its records pack. */
export function stageRecordNames(root) {
  const recordsDir = join(root, "records");
  const inTree = existsSync(recordsDir) ? readdirSync(recordsDir) : [];
  const packed = [...packedFiles(root).keys()]
    .filter((path) => path.startsWith("records/"))
    .map((path) => path.slice("records/".length));
  return [...new Set([...inTree, ...packed])].sort();
}
