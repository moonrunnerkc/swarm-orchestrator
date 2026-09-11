import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { expect, it } from "vitest";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { unpackArchive } from "./archive.mjs";
import { verifyArchive } from "./verify-archive.mjs";

it("restores exact bytes and refuses tampered archives or escaping paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "campaign-compression-"));
  const writeArchive = async (files) => {
    const expanded = Buffer.from(JSON.stringify(files));
    const compressed = brotliCompressSync(expanded);
    await writeFile(join(directory, "archive.json.br"), compressed);
    await writeFile(
      join(directory, "archive-manifest.json"),
      JSON.stringify({
        version: 1,
        format: "utf8-file-map-brotli",
        digest: digestOfBytes(compressed),
        bytes: compressed.length,
        expandedBytes: expanded.length,
        files: Object.keys(files).length,
      }),
    );
  };
  try {
    await writeArchive({ "bundle/record.json": '{"value":"exact\\nbytes"}\n' });
    const unpacked = await unpackArchive(directory);
    try {
      expect(await readFile(join(unpacked.directory, "bundle/record.json"), "utf8")).toBe(
        '{"value":"exact\\nbytes"}\n',
      );
    } finally {
      await unpacked.dispose();
    }
    await writeFile(join(directory, "archive.json.br"), "tampered");
    await expect(unpackArchive(directory)).rejects.toThrow("digest mismatch");
    await writeArchive({
      "observation.json": "{}",
      "inventory.json": JSON.stringify({
        version: 1,
        sources: [{ path: "observation.json", bytes: 2, digest: digestOfBytes("{}") }],
      }),
    });
    await writeFile(join(directory, "observation.json"), "[]");
    expect((await verifyArchive(directory)).problems).toContain(
      "published readable artifact mismatch observation.json",
    );
    await writeArchive({ "../escape": "refused" });
    await expect(unpackArchive(directory)).rejects.toThrow("invalid campaign archive path");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
