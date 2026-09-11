import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliDecompressSync } from "node:zlib";
import { z } from "zod";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";

const manifestSchema = z.object({
  version: z.literal(1),
  format: z.literal("utf8-file-map-brotli"),
  digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  expandedBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
  files: z.number().int().positive().max(5000),
});

export async function unpackArchive(directory) {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(directory, "archive-manifest.json"), "utf8")),
  );
  const compressed = await readFile(join(directory, "archive.json.br"));
  if (compressed.length !== manifest.bytes || digestOfBytes(compressed) !== manifest.digest)
    throw new Error("campaign archive digest mismatch; restore the committed archive");
  const expanded = brotliDecompressSync(compressed, { maxOutputLength: manifest.expandedBytes });
  if (expanded.length !== manifest.expandedBytes)
    throw new Error("campaign archive expanded size mismatch");
  const files = z.record(z.string(), z.string()).parse(JSON.parse(expanded.toString("utf8")));
  if (Object.keys(files).length !== manifest.files)
    throw new Error("campaign archive file count mismatch");
  for (const path of Object.keys(files)) {
    if (
      !path ||
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    )
      throw new Error(`invalid campaign archive path ${path}`);
  }
  const destination = await mkdtemp(join(tmpdir(), "swarm-campaign-archive-"));
  const dispose = () => rm(destination, { recursive: true, force: true });
  try {
    for (const [path, content] of Object.entries(files)) {
      const target = join(destination, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, content, { flag: "wx", mode: 0o600 });
    }
    return { directory: destination, dispose };
  } catch (cause) {
    await dispose();
    throw cause;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const unpacked = await unpackArchive(
    resolve(process.argv[2] ?? "docs/evidence/2026-09-11/local-campaign"),
  );
  console.log(
    `Exact artifacts restored to ${unpacked.directory}. Remove that directory when finished reviewing.`,
  );
}
