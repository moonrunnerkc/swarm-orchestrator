#!/usr/bin/env node
/**
 * Pack the campaign's goal packages (task text, visible contract, reference, conditions and
 * goal.json; never the sealed oracles, never authoring notes) into the repository's existing
 * `utf8-file-map-brotli` archive format, so the frozen material travels with the protocol and
 * `scripts/local-campaign/archive.mjs` restores it byte for byte.
 *
 *   node scripts/campaign/pack-goals.mjs --goals <id list> --out <directory>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { listFiles } from "./goal-package.mjs";
import { campaignRoot } from "./workspace.mjs";

/** Only the files a goal package is defined by; a validation record an author wrote is not one. */
export const packedFile = (path) =>
  ["goal.json", "task.md", "contract.json", "reference.patch"].includes(path) ||
  /^conditions\/[a-z0-9-]+\.patch$/.test(path);

export function packGoals(ids, goalsRoot) {
  const files = {};
  for (const id of ids)
    for (const path of listFiles(join(goalsRoot, id)).filter(packedFile)) {
      const bytes = readFileSync(join(goalsRoot, id, path));
      const text = bytes.toString("utf8");
      if (!Buffer.from(text, "utf8").equals(bytes))
        throw new Error(`${id}/${path} is not UTF-8, and this archive format holds text only`);
      files[`${id}/${path}`] = text;
    }
  const expanded = Buffer.from(JSON.stringify(files));
  const compressed = brotliCompressSync(expanded, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  });
  return {
    compressed,
    manifest: {
      version: 1,
      format: "utf8-file-map-brotli",
      digest: digestOfBytes(compressed),
      bytes: compressed.length,
      expandedBytes: expanded.length,
      files: Object.keys(files).length,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flag = (name) => args[args.indexOf(name) + 1];
  const ids = readFileSync(flag("--goals"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const out = resolve(flag("--out"));
  const { compressed, manifest } = packGoals(ids, join(campaignRoot, "goals"));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "archive.json.br"), compressed);
  writeFileSync(join(out, "archive-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${manifest.files} files, ${manifest.expandedBytes} bytes, packed to ${manifest.bytes}`,
  );
}
