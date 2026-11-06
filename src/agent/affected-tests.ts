import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { gitText } from "./git.ts";
import type { TestConventions } from "./test-conventions.ts";

const scriptFile = /\.(?:[cm]?[jt]sx?)$/;
const pythonFile = /\.py$/;
const scriptExtensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const largest = 400_000;

const jsImport = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"'\n]+)["']/g;

/** Where a relative script import lands among the files: as named, with an extension, or an index. */
function resolveScript(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const joined = normalize(join(dirname(from), spec));
  const stem = joined.replace(scriptFile, "");
  const candidates = [
    joined,
    ...scriptExtensions.map((ext) => `${stem}${ext}`),
    ...scriptExtensions.map((ext) => `${joined}/index${ext}`),
  ];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/** Each Python file's dotted module names: from the root, and from under a top `src/` layout. */
function moduleIndex(files: Iterable<string>): Map<string, string> {
  const index = new Map<string, string>();
  for (const path of files) {
    if (!pythonFile.test(path)) continue;
    const dotted = path.replace(/(?:\/__init__)?\.py$/, "").replaceAll("/", ".");
    index.set(dotted, path);
    if (dotted.startsWith("src.")) index.set(dotted.slice(4), path);
  }
  return index;
}

/** The modules a Python file imports, each with the packages above it, which Python runs first. */
function pythonModules(path: string, text: string): string[] {
  const here = path.replace(/\.py$/, "").split("/").slice(0, -1);
  const found: string[] = [];
  for (const match of text.matchAll(/^\s*from\s+(\.*)([\w.]*)\s+import\s+([^\n#]+)/gm)) {
    const [, dots = "", name = "", names = ""] = match;
    const root =
      dots.length === 0
        ? name
        : [...here.slice(0, here.length - (dots.length - 1)), ...(name ? [name] : [])].join(".");
    found.push(root);
    // `from pkg import mod` may name a submodule.
    for (const one of names.replace(/[()]/g, "").split(",")) {
      const word = one.trim().split(/\s+/)[0] ?? "";
      if (/^\w+$/.test(word)) found.push(root.length === 0 ? word : `${root}.${word}`);
    }
  }
  for (const match of text.matchAll(/^\s*import\s+([\w., ]+)/gm)) {
    for (const one of (match[1] ?? "").split(",")) found.push(one.trim().split(/\s+/)[0] ?? "");
  }
  const withParents = found.flatMap((name) =>
    name.split(".").map((_, at, parts) => parts.slice(0, at + 1).join(".")),
  );
  return [...new Set(withParents.filter((name) => name.length > 0))];
}

/** Every conftest.py above a Python test file, which pytest loads before it. */
function conftests(path: string, files: ReadonlySet<string>): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts
    .map((_, at) => [...parts.slice(0, at + 1), "conftest.py"].join("/"))
    .concat("conftest.py")
    .filter((candidate) => candidate !== path && files.has(candidate));
}

/**
 * The repository's code files as they stand now, tracked and new, with what each imports. Imports
 * also resolve to `gone`, files the change deleted, so a test still importing one is reached.
 */
export async function importGraph(
  workspace: string,
  gone: readonly string[] = [],
): Promise<Map<string, string[]>> {
  const listed = await gitText(workspace, [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
    "--",
    ".",
    ":(exclude).swarm",
  ]);
  const files = new Set(
    listed
      .split("\n")
      .filter(
        (path) => (scriptFile.test(path) || pythonFile.test(path)) && !/node_modules\//.test(path),
      ),
  );
  const present = [...files];
  for (const path of gone) files.add(path);
  const modules = moduleIndex(files);
  const graph = new Map<string, string[]>();
  for (const path of present) {
    const text = await readFile(join(workspace, path), "utf8").catch(() => null);
    if (text === null || text.length > largest) {
      if (text !== null) graph.set(path, []);
      continue;
    }
    const imported = pythonFile.test(path)
      ? [
          ...pythonModules(path, text).flatMap((name) => modules.get(name) ?? []),
          ...conftests(path, files),
        ]
      : [...text.matchAll(jsImport)].flatMap(
          (match) => resolveScript(path, match[1] ?? "", files) ?? [],
        );
    graph.set(
      path,
      [...new Set(imported)].filter((one) => one !== path),
    );
  }
  return graph;
}

/**
 * The test files that reach a changed file through their imports, the changed test files among
 * them. Over-selection costs a little time; a test missed here still runs in the whole suite at
 * the first completion and in every verification.
 */
export function affectedTests(
  graph: ReadonlyMap<string, readonly string[]>,
  changed: readonly string[],
  isTest: (path: string) => boolean,
): string[] {
  const dependents = new Map<string, string[]>();
  for (const [path, imports] of graph) {
    for (const one of imports) dependents.set(one, [...(dependents.get(one) ?? []), path]);
  }
  const reached = new Set<string>();
  const queue = [...changed];
  while (queue.length > 0) {
    const path = queue.pop() as string;
    if (reached.has(path)) continue;
    reached.add(path);
    queue.push(...(dependents.get(path) ?? []));
  }
  return [...reached].filter((path) => graph.has(path) && isTest(path)).sort();
}

const nodeTestFile = /\.(test|spec)\.[cm]?[jt]sx?$/;
const pythonTestFile = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
export const testPattern = (conventions: TestConventions) =>
  conventions.runner === "pytest" ? pythonTestFile : nodeTestFile;

/** A report's file as a path to run: pytest's dotted module, turned to slashes, gets its suffix. */
export const testPathOf = (file: string) => (/\.[\w]+$/.test(file) ? file : `${file}.py`);

/** Whether a test reported with `file` lives in `path`, as the verifier reads it. */
export function livesIn(file: string | null, path: string): boolean {
  if (file === null) return false;
  const stem = path.replace(/\.[^./]+$/, "");
  return file === path || file === stem || file.startsWith(`${stem}/`);
}

export const shellWord = (path: string) =>
  /^[\w./@+-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

// Runners colour their output; the escape is built, since a literal one in a pattern hides.
const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
/** A runner's own lines naming what failed: pytest's and vitest's summaries, an assertion. */
const summaryLine = /^(?:FAILED|ERROR) |^\s*FAIL |^E\s+\S|AssertionError|^\s*[×✗] /;

/**
 * The end of a check's output, bounded, with the runner's failure summary kept ahead of it where
 * the end alone would cut it: a warning printed after pytest's summary (ironroot, 2026-11-06)
 * otherwise pushed out the one line that said what failed.
 */
export const excerpt = (text: string, bytes = 1800) => {
  const plain = text.replace(ansi, "");
  if (plain.length <= bytes) return plain;
  const tail = plain.slice(-bytes);
  const lines = plain.split("\n").filter((line) => summaryLine.test(line) && !tail.includes(line));
  // The runner's one-line summaries first: each names a case and why it failed.
  const first = (line: string) => (/^(?:FAILED|ERROR) |^\s*FAIL |^\s*[×✗] /.test(line) ? 0 : 1);
  const missing = [...lines]
    .sort((a, b) => first(a) - first(b))
    .map((line) => (line.length > 300 ? `${line.slice(0, 300)}...` : line));
  let kept = "";
  for (const line of missing) {
    if (kept.length + line.length > bytes / 3) break;
    kept += `${line}\n`;
  }
  return kept.length === 0 ? `...${tail}` : `${kept}...${plain.slice(-(bytes - kept.length))}`;
};

export function failuresDetail(
  newFailures: readonly string[],
  output: string,
  none: string,
): string {
  if (newFailures.length === 0) return none;
  const more = newFailures.length > 12 ? ` and ${newFailures.length - 12} more` : "";
  return `newly failing: ${newFailures.slice(0, 12).join(", ")}${more}\n${output}`;
}
