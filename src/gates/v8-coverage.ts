import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvedPath } from "./resolved-path.ts";

/**
 * Line hits from the coverage V8 writes itself, for the runners whose invocation the harness
 * cannot rebuild as an argv it controls.
 *
 * Reach was built on invariant 7's evidence rule, which only node's own test runner satisfies:
 * an argument vector the harness assembled, spawned with no shell in between, under an
 * environment it built. That rule exists for the ratchet, where a number the workspace can
 * author is a number a retry is judged against, and the workspace has both motive and
 * opportunity to inflate it. Reach is the other direction. It can only turn a green into a
 * refusal, so a workspace that forged its coverage would get `reached`, which is exactly where
 * every unrecognized runner already sits, since `unmeasured` blocks nothing. Applying the
 * ratchet's bar here cost thirteen of seventeen corpus repositories and closed no hole.
 *
 * What that leaves open, named rather than implied away: these hits come from a report a
 * workspace's own processes wrote, so a workspace that wanted `reached` could write one. Nothing
 * here detects that, and nothing needs to while the only thing reach does with `reached` is
 * decline to refuse. It must not be reused for anything a number can buy.
 */
export interface CoverageRange {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

/**
 * Executions per line, or null where the offsets do not address this file.
 *
 * Offsets are positions in the source V8 compiled. Where a runner transforms the file first they
 * address the transformed text: dayjs's `src/index.js` is 11,794 characters and jest's coverage
 * of it names offsets past 218,000. Read raw, those name lines nobody wrote. An offset past the
 * end of the file is the whole of the detection, and it is cheap and exact.
 */
export function lineHitsFromRanges(
  source: string,
  ranges: readonly CoverageRange[],
): Readonly<Record<number, number>> | null {
  if (ranges.some((range) => range.endOffset > source.length)) {
    return null;
  }

  // Outer ranges first, so an inner one overwrites: V8 reports an uncovered block as a range
  // inside the covering function's, and the inner count is the one that describes the block.
  const nested = [...ranges].sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset,
  );
  const notCovered = -1;
  const perOffset = new Int32Array(source.length).fill(notCovered);
  for (const range of nested) {
    perOffset.fill(range.count, range.startOffset, range.endOffset);
  }

  const hits: Record<number, number> = {};
  let line = 1;
  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset] as string;
    if (character === "\n") {
      line += 1;
      continue;
    }
    // Whitespace carries no count. The newline ending a line sits outside the function whose
    // closing brace opens it, so counting it gave the line the enclosing script's count and
    // reported `}` as run on a function nobody called. A blank line then names nothing at all,
    // which is what every lcov producer does with one.
    if (/\s/.test(character)) {
      continue;
    }
    const covering = perOffset[offset] ?? notCovered;
    if (covering !== notCovered) {
      // The highest count anything on the line reached. A line holding both a covered call and
      // an uncovered branch ran, which is what every lcov producer reports for it.
      hits[line] = Math.max(hits[line] ?? 0, covering);
    }
  }
  return hits;
}

export interface V8CoverageReading {
  /** Executions per line, per workspace-relative path, for the files that were asked about. */
  readonly hits: Readonly<Record<string, Readonly<Record<number, number>>>>;
  /**
   * Why nothing here is worth reading, or null where it is. Separate from an empty reading: a
   * file the run never loaded is absent from a usable report and reads as a file the oracle
   * skipped, which is a verdict; a report that cannot be read at all is no verdict.
   */
  readonly unusable: string | null;
}

interface CoverageScript {
  readonly url?: unknown;
  readonly functions?: readonly { readonly ranges?: readonly CoverageRange[] }[];
}

/**
 * Everything `NODE_V8_COVERAGE` left in a directory, read for the named files only.
 *
 * One file per process, and a run is several: the test runner, the child each test file gets,
 * and whatever those started. A script appears in as many of them as loaded it, so the readings
 * are merged by taking the highest count each line reached. A line one process ran is a line
 * that ran.
 */
export function readV8Coverage(input: {
  directory: string;
  workspaceRoot: string;
  files: readonly string[];
}): V8CoverageReading {
  let written: readonly string[] = [];
  try {
    written = readdirSync(input.directory).filter((name) => name.endsWith(".json"));
  } catch {
    return { hits: {}, unusable: `nothing was written to ${input.directory}` };
  }
  if (written.length === 0) {
    return { hits: {}, unusable: `nothing was written to ${input.directory}` };
  }

  const wanted = new Set(input.files);
  const root = resolvedPath(input.workspaceRoot);
  const rangesByPath = new Map<string, CoverageRange[][]>();

  for (const name of written) {
    let scripts: readonly CoverageScript[] = [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(input.directory, name), "utf8"));
      scripts = (parsed as { result?: readonly CoverageScript[] }).result ?? [];
    } catch {
      // A coverage file still being written is not a reason to refuse the ones that are whole.
      continue;
    }
    for (const script of scripts) {
      const path = workspacePathOf(script.url, root);
      if (path === null || !wanted.has(path)) {
        continue;
      }
      const ranges = (script.functions ?? []).flatMap((one) => [...(one.ranges ?? [])]);
      if (ranges.length === 0) {
        continue;
      }
      const perProcess = rangesByPath.get(path) ?? [];
      perProcess.push(ranges);
      rangesByPath.set(path, perProcess);
    }
  }

  const hits: Record<string, Record<number, number>> = {};
  for (const [path, perProcess] of rangesByPath) {
    let source = "";
    try {
      source = readFileSync(join(input.workspaceRoot, path), "utf8");
    } catch {
      continue;
    }
    const merged: Record<number, number> = {};
    for (const ranges of perProcess) {
      const perLine = lineHitsFromRanges(source, ranges);
      if (perLine === null) {
        // The reading abstains whole. Dropping the file instead would report it as a file the
        // oracle never ran, which refuses the patch rather than declining to judge it.
        return {
          hits: {},
          unusable:
            `the coverage report names offsets past the end of ${path}, so it describes a ` +
            "transformed source rather than the file, and no line number in it is this file's",
        };
      }
      for (const [line, count] of Object.entries(perLine)) {
        merged[Number(line)] = Math.max(merged[Number(line)] ?? 0, count);
      }
    }
    hits[path] = merged;
  }

  return { hits, unusable: null };
}

/** The path a coverage entry names, workspace-relative, or null where it is not in the tree. */
function workspacePathOf(url: unknown, root: string): string | null {
  if (typeof url !== "string" || !url.startsWith("file://")) {
    return null;
  }
  let path = "";
  try {
    path = resolvedPath(fileURLToPath(url));
  } catch {
    return null;
  }
  const within = relative(root, path);
  if (within.length === 0 || within.startsWith("..") || within.startsWith(`${sep}`)) {
    return null;
  }
  return within.split(sep).join("/");
}
