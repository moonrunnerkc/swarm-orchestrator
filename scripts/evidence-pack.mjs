#!/usr/bin/env node
/**
 * Packs derived evidence artifacts into one lossless in-tree archive, and checks every such pack.
 *
 * The tracked tree has reached its ceiling twice, and each time the answer was one file compressed
 * by hand. A rendered review page or a raw run transcript is a view of the records or a log
 * beside them: nothing verifies against it and no check reads it, yet together they were a tenth
 * of the tree. They compress about ten to one, so they stay in the repository, byte for byte
 * recoverable from a clone with no second repository and no history walk, and stop costing what
 * they cost expanded.
 *
 * What never goes in a pack is what a bundle is: its ledger, DAG, manifest, payload digests and
 * verifiers. `namesADerivedArtifact` is the one definition of what may, shared with the offload.
 *
 *   node scripts/evidence-pack.mjs pack <root> --name <pack>   # tracked derived artifacts under root
 *   node scripts/evidence-pack.mjs pack <root> --name <pack> --completed-corpus
 *                                        # every tracked file of a finished corpus whose payloads moved out
 *   node scripts/evidence-pack.mjs pack-blobs <stage>/blobs --name <pack>
 *                                        # a comparison stage's content-addressed blobs, decompressed
 *   node scripts/evidence-pack.mjs pack-gz <root> --name <pack>
 *                                        # every other gzip text file under root, decompressed
 *   node scripts/evidence-pack.mjs pack-records <stage>     # a published stage's records, byte for byte
 *   node scripts/evidence-pack.mjs verify                      # every pack git tracks
 *   node scripts/evidence-pack.mjs restore <pack directory>    # exact bytes, to a temporary directory
 *
 * The format is the existing `utf8-file-map-brotli` one and `scripts/local-campaign/archive.mjs`
 * is its only unpacker. Brotli output can differ between zlib versions, so nothing depends on
 * recompressing to the same bytes: the manifest carries the digest of the compressed file as
 * committed, and the inventory carries the digest of every original.
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants, gunzipSync } from "node:zlib";
import { z } from "zod";
import { namesADerivedArtifact } from "../src/evidence/blob-manifest.ts";
import { digestOfBytes } from "../src/evidence/canonical-json.ts";
import { unpackArchive } from "./local-campaign/archive.mjs";

export const packDirectoryName = "packed-derived";

const inventorySchema = z.object({
  version: z.literal(1),
  /**
   * `derived-artifacts`: views of or logs beside the records, chosen by name. `completed-corpus`:
   * every tracked file of a finished campaign corpus whose bundle payloads already live outside
   * the repository, packed whole so its many identical embedded verifiers stop costing their size
   * once each; nothing about it is dropped, and `restore` gives back every bundle as it was.
   * `content-addressed-blobs`: a comparison stage's `blobs/<hex>.gz` payloads, each held as its
   * decompressed content under its digest. The digest is of that content, which is what every
   * record cites and what `restore` gives back exactly; the gzip framing around it was incidental
   * and is not kept, so a restored blob is `<hex>`, not `<hex>.gz`. `decompressed-gzip`: every
   * other gzip-compressed text file under a root (a session excerpt, a replay's stdout), held as
   * its content under its path without `.gz`, for the same reason and on the same terms.
   * `stage-records`: a published comparison stage's `records/` files, byte for byte; the
   * analyzer and the replays read a record from the pack where the file is not in the tree.
   */
  kind: z.enum([
    "derived-artifacts",
    "completed-corpus",
    "content-addressed-blobs",
    "decompressed-gzip",
    "stage-records",
  ]),
  /** Repository-relative directory the source paths are relative to. */
  root: z.string().min(1),
  /** The commit whose tree still held the originals, which is the second place they live. */
  sourceCommit: z.string().regex(/^[0-9a-f]{40}$/),
  sources: z
    .array(
      z.object({
        path: z.string().min(1),
        bytes: z.number().int().nonnegative(),
        digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      }),
    )
    .min(1),
});

async function filesUnder(directory) {
  const found = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name < right.name ? -1 : 1,
  )) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) for (const below of await filesUnder(path)) found.push(below);
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

/**
 * The originals are removed only after the written archive has been unpacked again and every
 * file in it compared with the bytes on disk. A process killed before that leaves the originals
 * and a pack beside them, which `verify` accepts; the other order could leave neither.
 */
export async function packDerivedArtifacts(input) {
  const root = resolve(input.repositoryRoot, input.root);
  const destination = join(root, packDirectoryName, input.name);
  // Chosen from what git tracks and never from a walk of the disk: deleting is recoverable only
  // for a file history has seen, and a campaign directory holds gigabytes git never has.
  const inside = `${relative(input.repositoryRoot, root).split("\\").join("/")}/`;
  const completedCorpus = input.completedCorpus === true;
  const chosen = input.trackedPaths
    .filter(
      (path) =>
        path.startsWith(inside) &&
        (completedCorpus || namesADerivedArtifact(path.split("/").at(-1) ?? "")) &&
        !path.split("/").includes(packDirectoryName),
    )
    .sort()
    .map((path) => join(input.repositoryRoot, path));
  if (chosen.length === 0) return { files: 0, expandedBytes: 0, compressedBytes: 0, destination };

  const archived = {};
  const sources = [];
  for (const path of chosen) {
    const bytes = await readFile(path);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes)) {
      throw new Error(`${path} is not UTF-8, and this archive format holds text only`);
    }
    const name = relative(root, path).split("\\").join("/");
    archived[name] = content;
    sources.push({ path: name, bytes: bytes.length, digest: digestOfBytes(bytes) });
  }
  await writePack(
    destination,
    input.repositoryRoot,
    archived,
    inventorySchema.parse({
      version: 1,
      kind: completedCorpus ? "completed-corpus" : "derived-artifacts",
      root: relative(input.repositoryRoot, root).split("\\").join("/"),
      sourceCommit: input.sourceCommit,
      sources,
    }),
  );
  for (const path of chosen) await rm(path);
  return {
    files: chosen.length,
    expandedBytes: sources.reduce((total, one) => total + one.bytes, 0),
    compressedBytes: (await stat(join(destination, "archive.json.br"))).size,
    destination,
  };
}

/** The archive, its manifest and its inventory, written once and checked by restoring them. */
async function writePack(destination, repositoryRoot, archived, parsedInventory) {
  const inventory = `${JSON.stringify(parsedInventory, null, 2)}\n`;
  const files = { ...archived, "inventory.json": inventory };
  const expanded = Buffer.from(JSON.stringify(files));
  const compressed = brotliCompressSync(expanded, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 },
  });
  await mkdir(destination, { recursive: true });
  const written = {
    "inventory.json": inventory,
    "archive.json.br": compressed,
    "archive-manifest.json": `${JSON.stringify(
      {
        version: 1,
        format: "utf8-file-map-brotli",
        digest: digestOfBytes(compressed),
        bytes: compressed.length,
        expandedBytes: expanded.length,
        files: Object.keys(files).length,
      },
      null,
      2,
    )}\n`,
  };
  for (const [name, bytes] of Object.entries(written)) {
    await writeFile(join(destination, name), bytes, { flag: "wx" });
  }
  const checked = await verifyDerivedPack(destination, repositoryRoot);
  if (!checked.ok) {
    throw new Error(`the pack does not restore what it was built from: ${checked.problems[0]}`);
  }
}

/**
 * A comparison stage's blobs, packed: every tracked `blobs/<hex>.gz` whose content is UTF-8 and
 * hashes to its name is held decompressed under `<hex>`, and the `.gz` is removed once the pack
 * restores. Each blob file compressed on its own, a stage's repeated runner output and event
 * streams were stored once per launch; in one archive they compress together. A blob that is not
 * UTF-8 or does not match its name stays where it is.
 */
export async function packContentAddressedBlobs(input) {
  const root = resolve(input.repositoryRoot, input.root);
  const inside = `${relative(input.repositoryRoot, root).split("\\").join("/")}/`;
  const archived = {};
  const sources = [];
  const chosen = [];
  for (const path of input.trackedPaths.filter((one) => one.startsWith(inside)).sort()) {
    const name = path.slice(inside.length);
    const found = /^([0-9a-f]{64})\.gz$/.exec(name);
    if (found === null) continue;
    const bytes = gunzipSync(await readFile(join(input.repositoryRoot, path)));
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes) || digestOfBytes(bytes) !== `sha256:${found[1]}`)
      continue;
    archived[found[1]] = content;
    sources.push({ path: found[1], bytes: bytes.length, digest: digestOfBytes(bytes) });
    chosen.push(join(input.repositoryRoot, path));
  }
  const destination = join(root, packDirectoryName, input.name);
  if (chosen.length === 0) return { files: 0, expandedBytes: 0, compressedBytes: 0, destination };
  await writePack(
    destination,
    input.repositoryRoot,
    archived,
    inventorySchema.parse({
      version: 1,
      kind: "content-addressed-blobs",
      root: relative(input.repositoryRoot, root).split("\\").join("/"),
      sourceCommit: input.sourceCommit,
      sources,
    }),
  );
  for (const path of chosen) await rm(path);
  return {
    files: chosen.length,
    expandedBytes: sources.reduce((total, one) => total + one.bytes, 0),
    compressedBytes: (await stat(join(destination, "archive.json.br"))).size,
    destination,
  };
}

/**
 * Every tracked gzip file under a root whose content is UTF-8, packed as that content under its
 * path without `.gz`, and removed once the pack restores. Files compressed one at a time paid
 * gzip's whole overhead and none of the shared vocabulary of a stage's sessions and replays.
 */
export async function packDecompressedGzip(input) {
  const root = resolve(input.repositoryRoot, input.root);
  const inside = `${relative(input.repositoryRoot, root).split("\\").join("/")}/`;
  const archived = {};
  const sources = [];
  const chosen = [];
  for (const path of input.trackedPaths.filter((one) => one.startsWith(inside)).sort()) {
    if (!path.endsWith(".gz") || path.split("/").includes(packDirectoryName)) continue;
    let bytes;
    try {
      bytes = gunzipSync(await readFile(join(input.repositoryRoot, path)));
    } catch {
      continue;
    }
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes)) continue;
    const name = path.slice(inside.length, -".gz".length);
    archived[name] = content;
    sources.push({ path: name, bytes: bytes.length, digest: digestOfBytes(bytes) });
    chosen.push(join(input.repositoryRoot, path));
  }
  const destination = join(root, packDirectoryName, input.name);
  if (chosen.length === 0) return { files: 0, expandedBytes: 0, compressedBytes: 0, destination };
  await writePack(
    destination,
    input.repositoryRoot,
    archived,
    inventorySchema.parse({
      version: 1,
      kind: "decompressed-gzip",
      root: relative(input.repositoryRoot, root).split("\\").join("/"),
      sourceCommit: input.sourceCommit,
      sources,
    }),
  );
  for (const path of chosen) await rm(path);
  return {
    files: chosen.length,
    expandedBytes: sources.reduce((total, one) => total + one.bytes, 0),
    compressedBytes: (await stat(join(destination, "archive.json.br"))).size,
    destination,
  };
}

/**
 * A published stage's records, packed byte for byte under `records/<name>` at the stage's own
 * `packed-derived/records`, and removed once the pack restores. Every record of a stage repeats
 * the same manifest digest, pins and command shapes, which one archive stores once.
 */
export async function packStageRecords(input) {
  const root = resolve(input.repositoryRoot, input.root);
  const inside = `${relative(input.repositoryRoot, root).split("\\").join("/")}/records/`;
  const archived = {};
  const sources = [];
  const chosen = [];
  for (const path of input.trackedPaths.filter((one) => one.startsWith(inside)).sort()) {
    const name = path.slice(inside.length);
    if (name.includes("/")) continue;
    const bytes = await readFile(join(input.repositoryRoot, path));
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes)) continue;
    archived[`records/${name}`] = content;
    sources.push({ path: `records/${name}`, bytes: bytes.length, digest: digestOfBytes(bytes) });
    chosen.push(join(input.repositoryRoot, path));
  }
  const destination = join(root, packDirectoryName, "records");
  if (chosen.length === 0) return { files: 0, expandedBytes: 0, compressedBytes: 0, destination };
  await writePack(
    destination,
    input.repositoryRoot,
    archived,
    inventorySchema.parse({
      version: 1,
      kind: "stage-records",
      root: relative(input.repositoryRoot, root).split("\\").join("/"),
      sourceCommit: input.sourceCommit,
      sources,
    }),
  );
  for (const path of chosen) await rm(path);
  return {
    files: chosen.length,
    expandedBytes: sources.reduce((total, one) => total + one.bytes, 0),
    compressedBytes: (await stat(join(destination, "archive.json.br"))).size,
    destination,
  };
}

/**
 * Whether a pack restores exactly what its committed inventory names.
 *
 * A path the inventory names may exist in the tree again, restored in place by somebody reading
 * it. It may not exist there with other bytes: two answers to what a file held is the state this
 * whole arrangement exists to rule out.
 */
export async function verifyDerivedPack(directory, repositoryRoot) {
  const problems = [];
  let inventory;
  try {
    inventory = inventorySchema.parse(
      JSON.parse(await readFile(join(directory, "inventory.json"), "utf8")),
    );
  } catch (cause) {
    return { ok: false, files: 0, problems: [`unreadable inventory: ${cause.message}`] };
  }
  let unpacked;
  try {
    unpacked = await unpackArchive(directory);
  } catch (cause) {
    return { ok: false, files: 0, problems: [cause.message] };
  }
  try {
    const committed = await readFile(join(directory, "inventory.json"));
    const carried = await readFile(join(unpacked.directory, "inventory.json")).catch(() => null);
    if (carried === null || !carried.equals(committed)) {
      problems.push("the inventory inside the archive is not the committed inventory");
    }
    const restored = new Set(
      (await filesUnder(unpacked.directory)).map((path) => relative(unpacked.directory, path)),
    );
    restored.delete("inventory.json");
    for (const source of inventory.sources) {
      const bytes = await readFile(join(unpacked.directory, source.path)).catch(() => null);
      restored.delete(source.path);
      if (bytes === null) {
        problems.push(`${source.path} is named by the inventory and absent from the archive`);
        continue;
      }
      if (bytes.length !== source.bytes || digestOfBytes(bytes) !== source.digest) {
        problems.push(`${source.path} does not restore to the digest the inventory names`);
      }
      if (
        inventory.kind === "content-addressed-blobs" &&
        source.digest !== `sha256:${source.path}`
      ) {
        problems.push(`${source.path} is a content-addressed blob whose digest is not its name`);
      }
      const inTree = await readFile(join(repositoryRoot, inventory.root, source.path)).catch(
        () => null,
      );
      if (inTree !== null && digestOfBytes(inTree) !== source.digest) {
        problems.push(`${source.path} is in the tree with bytes the inventory does not name`);
      }
    }
    for (const extra of restored) problems.push(`${extra} is in the archive and in no inventory`);
  } finally {
    await unpacked.dispose();
  }
  return { ok: problems.length === 0, files: inventory.sources.length, problems };
}

function trackedPaths(repositoryRoot) {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    maxBuffer: 256 * 1024 * 1024,
  })
    .toString("utf8")
    .split("\0")
    .filter((path) => path.length > 0);
}

async function main(argv) {
  const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
  const [command, ...rest] = argv;
  if (command === "pack") {
    const at = rest.indexOf("--name");
    const name = at === -1 ? null : rest[at + 1];
    const root = rest.find((one, index) => !one.startsWith("--") && index !== at + 1);
    // A corpus is packed whole only where its bundles' payloads were already moved out: a bundle
    // still carrying its blobs is live evidence a reader verifies where it sits.
    if (rest.includes("--completed-corpus")) {
      const carrying = trackedPaths(repositoryRoot).filter(
        (path) =>
          path.startsWith(`${root.replace(/\/$/, "")}/`) && path.split("/").includes("blobs"),
      );
      if (carrying.length > 0)
        throw new Error(
          `${root} still tracks bundle payloads (${carrying[0]}); only a corpus whose payloads were moved out is packed whole`,
        );
    }
    if (!name || !root || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error(
        "usage: evidence-pack.mjs pack <root> --name <lowercase-pack-name> [--completed-corpus]",
      );
    }
    const packed = await packDerivedArtifacts({
      repositoryRoot,
      root,
      name,
      completedCorpus: rest.includes("--completed-corpus"),
      trackedPaths: trackedPaths(repositoryRoot),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    });
    const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    console.log(
      packed.files === 0
        ? `no tracked derived artifact under ${root}`
        : `${packed.files} file(s), ${megabytes(packed.expandedBytes)} packed to ` +
            `${megabytes(packed.compressedBytes)}: ${relative(repositoryRoot, packed.destination)}`,
    );
    return;
  }
  if (command === "pack-records") {
    const root = rest.find((one) => !one.startsWith("--"));
    if (!root) throw new Error("usage: evidence-pack.mjs pack-records <stage directory>");
    const packed = await packStageRecords({
      repositoryRoot,
      root,
      trackedPaths: trackedPaths(repositoryRoot),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    });
    console.log(
      `${packed.files} record(s), ${(packed.expandedBytes / 1048576).toFixed(2)} MiB, packed to ` +
        `${(packed.compressedBytes / 1048576).toFixed(2)} MiB: ${relative(repositoryRoot, packed.destination)}`,
    );
    return;
  }
  if (command === "pack-gz") {
    const at = rest.indexOf("--name");
    const name = at === -1 ? null : rest[at + 1];
    const root = rest.find((one, index) => !one.startsWith("--") && index !== at + 1);
    if (!name || !root || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error("usage: evidence-pack.mjs pack-gz <root> --name <lowercase-pack-name>");
    }
    const packed = await packDecompressedGzip({
      repositoryRoot,
      root,
      name,
      trackedPaths: trackedPaths(repositoryRoot),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    });
    console.log(
      `${packed.files} gzip file(s), ${(packed.expandedBytes / 1048576).toFixed(1)} MiB expanded, packed to ` +
        `${(packed.compressedBytes / 1048576).toFixed(2)} MiB: ${relative(repositoryRoot, packed.destination)}`,
    );
    return;
  }
  if (command === "pack-blobs") {
    const at = rest.indexOf("--name");
    const name = at === -1 ? null : rest[at + 1];
    const root = rest.find((one, index) => !one.startsWith("--") && index !== at + 1);
    if (
      !name ||
      !root ||
      !/^[a-z0-9][a-z0-9-]*$/.test(name) ||
      !root.replace(/\/$/, "").endsWith("/blobs")
    ) {
      throw new Error(
        "usage: evidence-pack.mjs pack-blobs <stage>/blobs --name <lowercase-pack-name>",
      );
    }
    const packed = await packContentAddressedBlobs({
      repositoryRoot,
      root,
      name,
      trackedPaths: trackedPaths(repositoryRoot),
      sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot })
        .toString("utf8")
        .trim(),
    });
    console.log(
      `${packed.files} blob(s), ${(packed.expandedBytes / 1048576).toFixed(1)} MiB expanded, packed to ` +
        `${(packed.compressedBytes / 1048576).toFixed(2)} MiB: ${relative(repositoryRoot, packed.destination)}`,
    );
    return;
  }
  if (command === "verify") {
    const directories =
      rest.length > 0
        ? rest.map((one) => resolve(one))
        : trackedPaths(repositoryRoot)
            .filter((path) => path.split("/").at(-3) === packDirectoryName)
            .filter((path) => path.endsWith("/archive-manifest.json"))
            .map((path) => join(repositoryRoot, dirname(path)));
    let failed = 0;
    for (const directory of directories) {
      const checked = await verifyDerivedPack(directory, repositoryRoot);
      const named = relative(repositoryRoot, directory);
      if (checked.ok) {
        console.log(`  restores  ${named}: ${checked.files} file(s)`);
        continue;
      }
      failed += 1;
      console.error(`  FAILED    ${named}\n            ${checked.problems.join("\n            ")}`);
    }
    if (failed > 0) process.exit(1);
    console.log(`all ${directories.length} derived-artifact pack(s) restore their inventories`);
    return;
  }
  if (command === "restore") {
    const directory = resolve(rest[0] ?? "");
    if (!(await stat(join(directory, "archive-manifest.json")).catch(() => null))) {
      throw new Error("usage: evidence-pack.mjs restore <pack directory>");
    }
    const unpacked = await unpackArchive(directory);
    console.log(
      `Exact artifacts restored to ${unpacked.directory}. Remove that directory when finished.`,
    );
    return;
  }
  throw new Error("usage: evidence-pack.mjs pack <root> --name <pack> | verify | restore <dir>");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((cause) => {
    console.error(cause?.message ?? cause);
    process.exit(1);
  });
}
