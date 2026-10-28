import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { DeclaredCheck } from "../config/swarm-toml.ts";
import type { ChangedFile } from "./checkout.ts";
import { type CheckContext, runCheck } from "./checks.ts";
import type { Coverage } from "./predicate.ts";
import { type LineHits, readV8Coverage } from "./v8-lines.ts";

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
