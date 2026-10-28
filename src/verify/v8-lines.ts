import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export interface CoverageRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

export type LineHits = Readonly<Record<number, number>>;

/**
 * Executions per line, or null where an offset runs past the file: the runner transformed the
 * source first, so the offsets address text nobody wrote.
 */
export function lineHitsFromRanges(
  source: string,
  ranges: readonly CoverageRange[],
): LineHits | null {
  if (ranges.some((range) => range.endOffset > source.length)) return null;
  // Outer ranges first so an inner block's count overwrites the function around it.
  const nested = [...ranges].sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset,
  );
  const perOffset = new Int32Array(source.length).fill(-1);
  for (const range of nested) perOffset.fill(range.count, range.startOffset, range.endOffset);
  const hits: Record<number, number> = {};
  let line = 1;
  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset] ?? "";
    if (character === "\n") {
      line += 1;
      continue;
    }
    // Whitespace carries no count, so a blank line is not executable.
    if (/\s/.test(character)) continue;
    const count = perOffset[offset] ?? -1;
    if (count !== -1) hits[line] = Math.max(hits[line] ?? 0, count);
  }
  return hits;
}

interface Script {
  readonly url?: unknown;
  readonly functions?: readonly { readonly ranges?: readonly CoverageRange[] }[];
}

/**
 * Line hits for the named files from everything NODE_V8_COVERAGE wrote: one file per process,
 * merged by the highest count a line reached. Null hits for a file means it was never loaded.
 */
export async function readV8Coverage(
  directory: string,
  root: string,
  files: readonly string[],
): Promise<{ readonly hits: ReadonlyMap<string, LineHits>; readonly unusable: string | null }> {
  const written = await readdir(directory).catch(() => [] as string[]);
  if (!written.some((name) => name.endsWith(".json"))) {
    return { hits: new Map(), unusable: "no Node process wrote V8 coverage" };
  }
  const wanted = new Set(files);
  const realRoot = await realpath(root);
  const ranges = new Map<string, CoverageRange[][]>();
  for (const name of written.filter((entry) => entry.endsWith(".json"))) {
    let scripts: readonly Script[] = [];
    try {
      scripts = JSON.parse(await readFile(join(directory, name), "utf8")).result ?? [];
    } catch {
      continue;
    }
    for (const script of scripts) {
      if (typeof script.url !== "string" || !script.url.startsWith("file://")) continue;
      const path = relative(realRoot, fileURLToPath(script.url)).split(sep).join("/");
      if (!wanted.has(path)) continue;
      const found = (script.functions ?? []).flatMap((one) => [...(one.ranges ?? [])]);
      if (found.length > 0) ranges.set(path, [...(ranges.get(path) ?? []), found]);
    }
  }
  const hits = new Map<string, LineHits>();
  for (const [path, perProcess] of ranges) {
    const source = await readFile(join(root, path), "utf8");
    const merged: Record<number, number> = {};
    for (const one of perProcess) {
      const lines = lineHitsFromRanges(source, one);
      if (lines === null) {
        return {
          hits: new Map(),
          unusable: `the V8 offsets for ${path} run past the file, so a transform ran first`,
        };
      }
      for (const [line, count] of Object.entries(lines)) {
        merged[Number(line)] = Math.max(merged[Number(line)] ?? 0, count);
      }
    }
    hits.set(path, merged);
  }
  return { hits, unusable: null };
}
