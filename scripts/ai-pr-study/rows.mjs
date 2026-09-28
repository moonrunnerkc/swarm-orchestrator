/**
 * The study's rows, as a directory of JSON files while they are being produced and as one
 * brotli archive once they are recorded: the archive is what the repository tracks (the tree
 * has a weight ceiling and fifty rows with their check outputs pass it), and every analysis
 * reads either form the same way. `unpack` restores the directory byte for byte.
 *
 *   node scripts/ai-pr-study/rows.mjs pack <rows directory> <rows.json.br>
 *   node scripts/ai-pr-study/rows.mjs unpack <rows.json.br> <rows directory>
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";

/** Every row, from a directory of `NN.json` files or from a `.json.br` archive of them. */
export function loadRows(source) {
  if (statSync(source).isDirectory()) {
    return readdirSync(source)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort()
      .map((name) => JSON.parse(readFileSync(join(source, name), "utf8")));
  }
  const archive = JSON.parse(brotliDecompressSync(readFileSync(source)).toString("utf8"));
  return archive.rows.map((entry) => entry.row);
}

/** A digest over the rows' bytes, the same for the directory and for its archive. */
export function rowsDigest(source) {
  const hash = createHash("sha256");
  if (statSync(source).isDirectory()) {
    for (const name of readdirSync(source)
      .filter((n) => /^\d+\.json$/.test(n))
      .sort())
      hash.update(readFileSync(join(source, name)));
  } else {
    const archive = JSON.parse(brotliDecompressSync(readFileSync(source)).toString("utf8"));
    for (const entry of archive.rows) hash.update(entry.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

const [mode, from, to] = process.argv.slice(2);
if (import.meta.url === `file://${process.argv[1]}` && mode !== undefined) {
  if (mode === "pack") {
    const names = readdirSync(from)
      .filter((name) => /^\d+\.json$/.test(name))
      .sort();
    const rows = names.map((name) => {
      const bytes = readFileSync(join(from, name), "utf8");
      return { name, bytes, row: JSON.parse(bytes) };
    });
    writeFileSync(
      to,
      brotliCompressSync(JSON.stringify({ version: 1, kind: "ai-pr-study-rows", rows })),
    );
    console.log(`${rows.length} row(s) packed to ${to} (${statSync(to).size} bytes)`);
  } else if (mode === "unpack") {
    const archive = JSON.parse(brotliDecompressSync(readFileSync(from)).toString("utf8"));
    mkdirSync(to, { recursive: true });
    for (const entry of archive.rows)
      if (!existsSync(join(to, entry.name))) writeFileSync(join(to, entry.name), entry.bytes);
    console.log(`${archive.rows.length} row(s) unpacked to ${to}`);
  } else {
    console.error(
      "usage: rows.mjs pack <rows directory> <rows.json.br> | unpack <rows.json.br> <rows directory>",
    );
    process.exit(2);
  }
}
