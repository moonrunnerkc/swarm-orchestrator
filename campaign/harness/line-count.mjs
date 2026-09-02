/**
 * Non-blank lines of one language under a tree, by the sealed rule: the language's own
 * extensions, never inside the excluded directories, never a file matching the excluded
 * patterns. Deterministic over the same tree, which is what lets the count be committed
 * beside the decision it made.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { excludedDirectories, excludedFilePatterns, extensionsByLanguage } from "./criteria.mjs";

export function countsAs(language, relativePath) {
  const extensions = extensionsByLanguage[language];
  if (extensions === undefined) {
    throw new Error(`no extensions are sealed for ${language}`);
  }
  if (!extensions.includes(extname(relativePath))) {
    return false;
  }
  return !excludedFilePatterns.some((pattern) => pattern.test(relativePath));
}

export function nonBlankLines(text) {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.trim().length > 0) {
      count += 1;
    }
  }
  return count;
}

export async function countLines(root, language) {
  let total = 0;
  let files = 0;

  async function walk(relative) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!excludedDirectories.includes(entry.name)) {
          await walk(path);
        }
      } else if (entry.isFile() && countsAs(language, path)) {
        total += nonBlankLines(await readFile(join(root, path), "utf8"));
        files += 1;
      }
    }
  }

  await walk("");
  return { lines: total, files };
}
