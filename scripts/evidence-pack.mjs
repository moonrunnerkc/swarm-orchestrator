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
import { brotliCompressSync, constants } from "node:zlib";
import { z } from "zod";
import { namesADerivedArtifact } from "../src/evidence/blob-manifest.ts";
import { digestOfBytes } from "../src/evidence/canonical-json.ts";
import { unpackArchive } from "./local-campaign/archive.mjs";

export const packDirectoryName = "packed-derived";

const inventorySchema = z.object({
  version: z.literal(1),
  kind: z.literal("derived-artifacts"),
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
  const chosen = input.trackedPaths
    .filter(
      (path) =>
        path.startsWith(inside) &&
        namesADerivedArtifact(path.split("/").at(-1) ?? "") &&
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
  const inventory = `${JSON.stringify(
    inventorySchema.parse({
      version: 1,
      kind: "derived-artifacts",
      root: relative(input.repositoryRoot, root).split("\\").join("/"),
      sourceCommit: input.sourceCommit,
      sources,
    }),
    null,
    2,
  )}\n`;
  archived["inventory.json"] = inventory;
  const expanded = Buffer.from(JSON.stringify(archived));
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
        files: Object.keys(archived).length,
      },
      null,
      2,
    )}\n`,
  };
  for (const [name, bytes] of Object.entries(written)) {
    await writeFile(join(destination, name), bytes, { flag: "wx" });
  }

  const checked = await verifyDerivedPack(destination, input.repositoryRoot);
  if (!checked.ok) {
    throw new Error(`the pack does not restore what it was built from: ${checked.problems[0]}`);
  }
  for (const path of chosen) await rm(path);
  return {
    files: chosen.length,
    expandedBytes: sources.reduce((total, one) => total + one.bytes, 0),
    compressedBytes: compressed.length,
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
    if (!name || !root || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
      throw new Error("usage: evidence-pack.mjs pack <root> --name <lowercase-pack-name>");
    }
    const packed = await packDerivedArtifacts({
      repositoryRoot,
      root,
      name,
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
