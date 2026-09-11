import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { campaignRoot } from "./evidence.mjs";

const destination = resolve("docs/evidence/2026-09-11/local-campaign");
const roots = [
  "setup.json",
  "swarm-preflight.json",
  "authored",
  "checked",
  "admissions.json",
  "cases.json",
  "baseline-selection.json",
  "protocol.json",
  "summary.json",
  "runs",
  "attacks",
  "attacks.json",
  "security-protocol.json",
  "security-summary.json",
  "bundles",
  "tested-sources",
  "recheck",
  "contracts",
  "validation",
];

async function pathsUnder(relative) {
  const absolute = join(campaignRoot, relative);
  const metadata = await stat(absolute);
  if (!metadata.isDirectory()) return [relative];
  return (
    await Promise.all(
      (
        await readdir(absolute)
      )
        .sort()
        .filter((name) => name !== "index.html")
        .map((name) => pathsUnder(join(relative, name))),
    )
  ).flat();
}

const paths = (await Promise.all(roots.map(pathsUnder))).flat().sort();
const readable = paths.filter(
  (path) => !path.startsWith("bundles/") && !path.startsWith("tested-sources/"),
);
if (process.argv.includes("--list")) {
  console.log(
    JSON.stringify(
      [...readable, "inventory.json", "archive.json.br", "archive-manifest.json"].map((path) =>
        join(destination, path),
      ),
    ),
  );
} else {
  const inventory = [];
  const archived = {};
  for (const relative of paths) {
    const bytes = await readFile(join(campaignRoot, relative));
    const content = bytes.toString("utf8");
    if (!Buffer.from(content).equals(bytes))
      throw new Error(`non-UTF8 artifact ${relative} needs a binary archive format`);
    archived[relative] = content;
    inventory.push({ path: relative, bytes: bytes.length, digest: digestOfBytes(bytes) });
  }
  archived["inventory.json"] =
    `${JSON.stringify({ version: 1, sources: inventory, limits: "Local model-generated synthetic experiment. No independent human review, real-user observations or population reliability claim. Bundle signatures use ephemeral keys; the git commit anchors the published inventory." }, null, 2)}\n`;
  const expanded = Buffer.from(JSON.stringify(archived));
  const compressed = brotliCompressSync(expanded, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_LGWIN]: 24,
    },
  });
  const outputs = {
    ...Object.fromEntries([...readable, "inventory.json"].map((path) => [path, archived[path]])),
    "archive.json.br": compressed,
    "archive-manifest.json": `${JSON.stringify({ version: 1, format: "utf8-file-map-brotli", digest: digestOfBytes(compressed), bytes: compressed.length, expandedBytes: expanded.length, files: Object.keys(archived).length }, null, 2)}\n`,
  };
  for (const [path, bytes] of Object.entries(outputs)) {
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
  }
  console.log(
    JSON.stringify({ files: inventory.length, compressedBytes: compressed.length, destination }),
  );
}
