import { readdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import type { ChangedFile } from "./checkout.ts";
import { type CheckContext, runCheck } from "./checks.ts";
import type { Coverage } from "./predicate.ts";

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

const nodeSource = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
const pythonSource = /\.py$/;
const pytestCommand = /^(uv run\s+)?(?:(\S*python[0-9.]*)\s+-m\s+)?pytest(\s.*)?$/;

/** How the visible test checks run so that they also record coverage. */
export interface Instrumentation {
  wrap(check: DeclaredCheck): {
    readonly check: DeclaredCheck;
    readonly env: Record<string, string>;
  };
  read(): Promise<Coverage>;
}

const unmeasured = (reason: string): Coverage => ({ status: "unmeasured", reason });

export async function instrument(
  checks: readonly DeclaredCheck[],
  source: readonly ChangedFile[],
  scratch: string,
  context: CheckContext,
): Promise<Instrumentation | Coverage> {
  const files = source.filter((file) => file.addedLines.length > 0);
  if (files.length === 0) return unmeasured("the change adds no source lines");
  if (!checks.some((check) => check.kind === "test"))
    return unmeasured("no test check is declared");
  if (files.every((file) => nodeSource.test(file.path))) {
    const directory = join(scratch, "v8");
    return {
      wrap: (check) => ({
        check,
        env: check.kind === "test" ? { NODE_V8_COVERAGE: directory } : {},
      }),
      read: async () => {
        const read = await readV8Coverage(
          directory,
          context.dir,
          files.map((file) => file.path),
        );
        return read.unusable === null
          ? summarize("v8", files, read.hits, context.dir)
          : unmeasured(read.unusable);
      },
    };
  }
  if (files.every((file) => pythonSource.test(file.path)))
    return pythonInstrumentation(checks, files, scratch, context);
  return unmeasured("the change spans languages, and coverage is measured for one at a time");
}

async function pythonInstrumentation(
  checks: readonly DeclaredCheck[],
  files: readonly ChangedFile[],
  scratch: string,
  context: CheckContext,
): Promise<Instrumentation | Coverage> {
  const tests = checks.filter((check) => check.kind === "test");
  const parsed = tests.map((check) => pytestCommand.exec(check.command.trim()));
  if (parsed.some((match) => match === null)) {
    return unmeasured("a test check is not a pytest command coverage.py can wrap");
  }
  const first = parsed[0] as RegExpExecArray;
  const python = `${first[1] ?? ""}${first[2] ?? "python3"}`;
  const probe = await runCheck(
    { name: "probe", command: `${python} -c "import coverage"`, kind: "other" },
    context,
  );
  if (probe.result.result !== "pass")
    return unmeasured("coverage.py is not installed in the test environment");
  const dataFile = join(scratch, "python.coverage");
  return {
    wrap: (check) => {
      const match = check.kind === "test" ? pytestCommand.exec(check.command.trim()) : null;
      if (match === null) return { check, env: {} };
      const command = `${match[1] ?? ""}${match[2] ?? "python3"} -m coverage run --append --data-file=${dataFile} -m pytest${match[3] ?? ""}`;
      return { check: { ...check, command }, env: {} };
    },
    read: async () => {
      const report = join(scratch, "python-coverage.json");
      const json = `${python} -m coverage json --data-file=${dataFile} -o ${report} -q`;
      const ran = await runCheck({ name: "coverage", command: json, kind: "other" }, context);
      if (ran.result.result !== "pass") return unmeasured("coverage.py wrote no report");
      const parsedReport = JSON.parse(await readFile(report, "utf8")) as {
        files?: Record<string, { executed_lines?: number[]; missing_lines?: number[] }>;
      };
      const hits = new Map<string, LineHits>();
      for (const [name, entry] of Object.entries(parsedReport.files ?? {})) {
        const path = isAbsolute(name) ? relative(context.dir, name) : name;
        const lines: Record<number, number> = {};
        for (const line of entry.missing_lines ?? []) lines[line] = 0;
        for (const line of entry.executed_lines ?? []) lines[line] = 1;
        hits.set(path, lines);
      }
      return summarize("coverage.py", files, hits, context.dir);
    },
  };
}

/**
 * Covered and uncovered changed lines. A line the tool never names is not executable, except in
 * a file no test loaded, where every non-blank added line is uncovered.
 */
async function summarize(
  tool: "v8" | "coverage.py",
  files: readonly ChangedFile[],
  hits: ReadonlyMap<string, LineHits>,
  dir: string,
): Promise<Coverage> {
  const results = [];
  for (const file of files) {
    const lines = hits.get(file.path);
    const text = (await readFile(join(dir, file.path), "utf8")).split("\n");
    const executable = file.addedLines.filter((line) =>
      lines === undefined ? (text[line - 1] ?? "").trim().length > 0 : line in lines,
    );
    const covered = executable.filter((line) => (lines?.[line] ?? 0) > 0);
    const uncovered = executable.filter((line) => (lines?.[line] ?? 0) === 0);
    results.push({ path: file.path, covered, uncovered });
  }
  const coveredLines = results.reduce((sum, file) => sum + file.covered.length, 0);
  const changedLines = coveredLines + results.reduce((sum, file) => sum + file.uncovered.length, 0);
  return { status: "measured", tool, changedLines, coveredLines, files: results };
}
