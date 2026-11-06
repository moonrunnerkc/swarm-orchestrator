import { access, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { gitText } from "./git.ts";
import { type NamedFile, namedFiles } from "./named-files.ts";

export type Runner = "vitest" | "jest" | "mocha" | "node" | "pytest";

/** How the repository's tests are written and run, as the harness read it from the base. */
export interface TestConventions {
  readonly runner: Runner;
  /** Every tracked test file, the roots the runner collects from. */
  readonly roots: readonly string[];
  /** The tracked test file whose path and imports best match the task's words. */
  readonly example: { readonly path: string; readonly content: string };
  /** Where the code names the task uses are defined at the base: a path and the defining line. */
  readonly definitions: readonly Definition[];
  /** The source files the task names by path, with their imports and declarations. */
  readonly named: readonly NamedFile[];
  /** Where an authored check for a requirement is laid while it runs, beside the example. */
  pathFor(requirement: string): string;
  /** The command that runs one test file from the repository root. */
  commandFor(path: string): string;
}

const nodeTest = /\.(test|spec)\.[cm]?[jt]sx?$/;
const pythonTest = /(^|\/)(test_[^/]*|[^/]*_test)\.py$/;
const exampleBytes = 12_000;

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/** The runner a command names: `npx vitest run`, `node --test`, `python -m pytest`. */
export function runnerOf(command: string): Runner | null {
  for (const runner of ["vitest", "jest", "mocha", "pytest"] as const) {
    if (new RegExp(`\\b${runner}\\b`).test(command)) return runner;
  }
  return /\bnode\b[^\n]*--test\b/.test(command) ? "node" : null;
}

/** The runner the base's swarm.toml declares its test check with, where it declares one. */
async function declaredRunner(workspace: string): Promise<Runner | null> {
  const text = await readFile(join(workspace, "swarm.toml"), "utf8").catch(() => "");
  const checks = text.split(/^\[/m).find((section) => section.startsWith("checks]")) ?? "";
  for (const line of checks.split("\n")) {
    const runner = runnerOf(line);
    if (runner !== null) return runner;
  }
  return null;
}

async function nodeRunner(workspace: string): Promise<Runner | null> {
  const text = await readFile(join(workspace, "package.json"), "utf8").catch(() => null);
  if (text === null) return null;
  const manifest = JSON.parse(text) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const test = manifest.scripts?.test ?? "";
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const runner of ["vitest", "jest", "mocha"] as const) {
    if (test.includes(runner) || declared[runner] !== undefined) return runner;
  }
  return /\bnode\b.*--test\b/.test(test) ? "node" : null;
}

/** A name the task uses, where the base defines it. */
export interface Definition {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/**
 * The code identifiers a task names: camelCase, snake_case and PascalCase words and the names in
 * code spans. Hyphenated words are values and flags (`tech-debt`, `--help`), not code.
 */
export function taskIdentifiers(task: string): string[] {
  const spans = [...task.matchAll(/`([^`]+)`/g)].flatMap(
    (match) => (match[1] ?? "").match(/[A-Za-z_]\w*/g) ?? [],
  );
  const words = task.match(/[A-Za-z_]\w*/g) ?? [];
  const code = (word: string) =>
    word.includes("_") || /[a-z][A-Z]/.test(word) || /^[A-Z][a-z]+[A-Z]/.test(word);
  return [...new Set([...spans.filter((word) => word.length > 2), ...words.filter(code)])];
}

const sourceFile = /\.(?:[cm]?[jt]sx?|py)$/;

/** A line declaring one of `names` in TypeScript, JavaScript or Python; the name is group 1. */
function declaring(names: readonly string[]): RegExp {
  const any = names.map((name) => name.replace(/[$]/g, "\\$")).join("|");
  return new RegExp(
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?(?:function\\*?|class|const|let|var|interface|type|enum|def)\\s+(${any})\\b|^(${any})\\s*(?::[^=]*)?=`,
  );
}

/**
 * Where the task's words are declared in the base's tracked source, tests left out. A code-shaped
 * identifier is listed first; a plain word (`orchestrate`, `main`) counts only where the base
 * declares it, which is what makes it a name and not prose.
 */
async function definitionsOf(
  workspace: string,
  sources: readonly string[],
  task: string,
): Promise<Definition[]> {
  const named = taskIdentifiers(task);
  const plain = [...new Set(task.match(/\b[a-z][a-zA-Z]{3,}\b/g) ?? [])].filter(
    (word) => !named.includes(word),
  );
  const pattern = declaring([...named, ...plain]);
  const found = new Map<string, Definition>();
  for (const path of sources) {
    const text = await readFile(join(workspace, path), "utf8").catch(() => "");
    if (text.length > 400_000) continue;
    for (const [at, line] of text.split("\n").entries()) {
      const match = pattern.exec(line);
      const name = match?.[1] ?? match?.[2];
      if (name === undefined || found.has(name)) continue;
      // A plain word is a name only where it is declared at the top of a module.
      if (!named.includes(name) && /^\s/.test(line)) continue;
      found.set(name, { name, path, line: at + 1, text: line.trim().slice(0, 160) });
    }
  }
  const rank = (one: Definition) => (named.includes(one.name) ? 0 : 1);
  return [...found.values()].sort((a, b) => rank(a) - rank(b)).slice(0, 16);
}

/** How strongly a test file matches the task: the names it uses, and the modules it imports. */
function score(
  path: string,
  content: string,
  names: readonly string[],
  modules: readonly string[],
): number {
  const words = new Set(content.match(/[A-Za-z_]\w*/g) ?? []);
  const imports = content
    .split("\n")
    .filter((line) => /^\s*(?:import|from)\b|require\(/.test(line))
    .join("\n");
  const named = names.filter((name) => words.has(name)).length * 5;
  const imported = modules.filter((module) => imports.includes(module)).length * 10;
  const pathed = names.filter((name) => path.toLowerCase().includes(name.toLowerCase())).length * 3;
  return named + imported + pathed;
}

/** A sibling name the same include pattern collects: `a.test.ts` gives `a.swarm-r1.test.ts`. */
function sibling(example: string, requirement: string, runner: Runner): string {
  const dir = dirname(example);
  const name = basename(example);
  const tag = `swarm_${requirement.toLowerCase()}`;
  if (runner === "pytest") {
    const placed = name.startsWith("test_")
      ? `test_${tag}_${name.slice(5)}`
      : name.replace(/_test\.py$/, `_${tag}_test.py`);
    return dir === "." ? placed : join(dir, placed);
  }
  const marker = name.match(nodeTest)?.[0] ?? extname(name);
  const placed = `${name.slice(0, name.length - marker.length)}.${tag.replace("_", "-")}${marker}`;
  return dir === "." ? placed : join(dir, placed);
}

function commandOf(runner: Runner, python: string, coverage: boolean): (path: string) => string {
  switch (runner) {
    case "vitest":
      return (path) => `npx vitest run ${path}`;
    case "jest":
      return (path) => `npx jest ${path}`;
    case "mocha":
      return (path) => `npx mocha ${path}`;
    case "node":
      return (path) => `node --test ${path}`;
    case "pytest":
      // A single file under a coverage threshold fails whatever it asserts.
      return (path) =>
        `PYTHONDONTWRITEBYTECODE=1 ${python} -m pytest -q -p no:cacheprovider${coverage ? " --no-cov" : ""} ${path}`;
  }
}

/**
 * The runner, the test files and the one test file the authored checks are modeled on, read from
 * the base before any edit. Null where the repository has no test runner this recognizes.
 */
export async function testConventions(
  workspace: string,
  task: string,
): Promise<TestConventions | null> {
  const tracked = (await gitText(workspace, ["ls-files"])).split("\n").filter(Boolean);
  const node = (await declaredRunner(workspace)) ?? (await nodeRunner(workspace));
  const pyproject = await readFile(join(workspace, "pyproject.toml"), "utf8").catch(() => "");
  const runner: Runner | null =
    node ??
    (pyproject.length > 0 || tracked.some((path) => pythonTest.test(path)) ? "pytest" : null);
  if (runner === null) return null;
  const pattern = runner === "pytest" ? pythonTest : nodeTest;
  const tests = tracked.filter((path) => pattern.test(path) && !path.includes("node_modules/"));
  if (tests.length === 0) return null;
  const names = taskIdentifiers(task);
  const sources = tracked.filter(
    (path) => sourceFile.test(path) && !pattern.test(path) && !path.includes("node_modules/"),
  );
  const definitions = await definitionsOf(workspace, sources, task);
  // A test imports a module by its stem: `../src/cli.js` and `ironroot.verification.falsification`.
  const modules = [
    ...new Set(definitions.map((one) => basename(one.path).replace(sourceFile, ""))),
  ];
  let best: { path: string; content: string; score: number } | null = null;
  for (const path of tests) {
    const content = await readFile(join(workspace, path), "utf8").catch(() => "");
    const value = score(path, content, [...names, ...definitions.map((one) => one.name)], modules);
    if (
      best === null ||
      value > best.score ||
      (value === best.score && path.length < best.path.length)
    )
      best = { path, content, score: value };
  }
  if (best === null) return null;
  const venv = join(workspace, ".venv", "bin", "python");
  const python = (await exists(venv)) ? ".venv/bin/python" : "python3";
  const coverage = /addopts[^\n]*--cov/.test(pyproject);
  const example = { path: best.path, content: best.content.slice(0, exampleBytes) };
  const roots = [...new Set(tests.map((path) => path.split("/")[0] ?? path))].sort();
  return {
    runner,
    roots,
    example,
    definitions,
    named: await namedFiles(workspace, sources, task),
    pathFor: (requirement) => sibling(example.path, requirement, runner),
    commandFor: commandOf(runner, python, coverage),
  };
}
