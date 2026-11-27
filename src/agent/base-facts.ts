import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/** A source file of the base as a check's author is shown it: whole where small, else outlined. */
export interface ShownFile {
  readonly path: string;
  readonly whole: boolean;
  readonly lines: readonly string[];
}

const pathWord = /[\w@][\w@./-]*\.(?:[cm]?[jt]sx?|py)\b/g;
const wholeBytes = 3000;
const budgetBytes = 16_000;
const maxFiles = 10;
const maxDepth = 3;
const extensions = [".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs", "/index.ts", "/index.js"];

/** The tracked files a task names by path, matched exactly or by a tail only one file has. */
export function namedPaths(tracked: readonly string[], task: string): string[] {
  const words = [...new Set(task.match(pathWord) ?? [])];
  return words.flatMap((word) => {
    const hits = tracked.filter((one) => one === word || one.endsWith(`/${word}`));
    return hits.length === 1 && hits[0] !== undefined ? [hits[0]] : [];
  });
}

/**
 * The repository's own files a source file imports: relative JavaScript and TypeScript
 * specifiers, with the `.js` a TypeScript file is imported by, and Python modules by their dots.
 */
export function importsOf(path: string, text: string, tracked: readonly string[]): string[] {
  const found: string[] = [];
  const script = /(?:\bfrom\s+|\bimport\s*\(?\s*|\brequire\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
  for (const match of text.matchAll(script)) {
    const named = normalize(join(dirname(path), match[1] ?? ""));
    const stem = named.replace(/\.[cm]?[jt]sx?$/, "");
    const hit = [named, ...extensions.map((one) => `${stem}${one}`)].find((one) =>
      tracked.includes(one),
    );
    if (hit !== undefined) found.push(hit);
  }
  if (!path.endsWith(".py")) return [...new Set(found)];
  for (const match of text.matchAll(
    /^\s*(?:from\s+(\.*)([\w.]*)\s+import\b|import\s+([\w.]+))/gm,
  )) {
    const [, dots = "", module = "", plain = ""] = match;
    const parts = (module || plain).split(".").filter((one) => one.length > 0);
    const stem =
      dots.length === 0
        ? parts.join("/")
        : normalize(join(dirname(path), ...Array(dots.length - 1).fill(".."), ...parts));
    const hits = tracked.filter(
      (one) =>
        one === `${stem}.py` || one.endsWith(`/${stem}.py`) || one.endsWith(`/${stem}/__init__.py`),
    );
    if (hits.length === 1 && hits[0] !== undefined) found.push(hits[0]);
  }
  return [...new Set(found)];
}

const declared =
  /^(?:import\b|from\s+\S+\s+import\b|export\b|@\w|(?:async\s+)?def\s|class\s|(?:async\s+)?function\b|const\s|let\s|interface\s|type\s|enum\s)/;
// Declarations whose braces hold names or data, not a body: shapes a check must match exactly.
const shape =
  /^(?:import\b|(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\b|(?:export\s+)?const\s[^=]*=\s*[[{]\s*$)/;
const pythonMember = /^\s{4}(?:\w+\s*:\s*\S|(?:async\s+)?def\s|@)/;

/**
 * A file's top-level imports and declarations with no function bodies: signatures to their
 * close, and interfaces, types, data literals and Python classes with their fields.
 */
export function outlineOf(text: string): string[] {
  const lines = text.split("\n");
  const outline: string[] = [];
  for (const [at, line] of lines.entries()) {
    if (!declared.test(line)) continue;
    outline.push(line.trimEnd().slice(0, 160));
    const rest = lines.slice(at + 1);
    if (/^class\s.*:\s*$/.test(line)) {
      for (const next of rest.slice(0, 60)) {
        if (next.trim() !== "" && !/^\s/.test(next)) break;
        if (pythonMember.test(next)) outline.push(next.trimEnd().slice(0, 160));
      }
      continue;
    }
    const listed = /[{[]\s*$/.test(line) && shape.test(line);
    if (!listed && !/[(,]\s*$/.test(line)) continue;
    for (const next of rest.slice(0, listed ? 24 : 8)) {
      outline.push(next.trimEnd().slice(0, 160));
      if (/^[)}\]]/.test(next.trim())) break;
    }
  }
  return outline.slice(0, 90);
}

/**
 * The base's source a check written apart from the change needs, within a budget: the seed files,
 * then what they import, three steps out; a small file whole, a larger one outlined. An author
 * shown only a test wrote `userId` where the data has `ownerId`, and tested a function it
 * defined itself where the real entry was one import away (invoice example, 2026-11-26).
 */
export async function baseFacts(
  workspace: string,
  tracked: readonly string[],
  seeds: readonly string[],
): Promise<ShownFile[]> {
  const shown: ShownFile[] = [];
  const seen = new Set<string>();
  let used = 0;
  let level = [...new Set(seeds)];
  for (let depth = 0; depth <= maxDepth && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const path of level) {
      if (seen.has(path) || shown.length >= maxFiles) continue;
      seen.add(path);
      const text = await readFile(join(workspace, path), "utf8").catch(() => "");
      if (text.length === 0 || text.length > 400_000) continue;
      next.push(...importsOf(path, text, tracked));
      const whole = text.length <= wholeBytes;
      const lines = whole ? text.trimEnd().split("\n") : outlineOf(text);
      const size = lines.join("\n").length;
      if (lines.length === 0 || used + size > budgetBytes) continue;
      used += size;
      shown.push({ path, whole, lines });
    }
    level = next;
  }
  return shown;
}

/**
 * How the base's code is loaded and started: the module system, whether Node runs the TypeScript
 * itself, the Node it needs and the start command, whose tracked files are the `entries`.
 */
export async function runtimeFacts(
  workspace: string,
  tracked: readonly string[],
  example: { readonly path: string; readonly content: string },
): Promise<{ readonly notes: readonly string[]; readonly entries: readonly string[] }> {
  const text = await readFile(join(workspace, "package.json"), "utf8").catch(() => null);
  if (text === null) return { notes: [], entries: [] };
  let manifest: {
    type?: unknown;
    main?: unknown;
    scripts?: Record<string, unknown>;
    engines?: Record<string, unknown>;
  };
  try {
    manifest = JSON.parse(text) as typeof manifest;
  } catch {
    return { notes: [], entries: [] };
  }
  const notes: string[] = [];
  const esm = manifest.type === "module" || /\.m[jt]s$/.test(example.path);
  notes.push(
    esm
      ? 'Modules: ES modules ("type": "module"). Use import; require, module.exports and __dirname do not exist here.'
      : /\brequire\(/.test(example.content)
        ? "Modules: CommonJS. Load code with require, as the example test does."
        : "Modules: load code the way the example test does.",
  );
  if (/\.[cm]?ts$/.test(example.path) && !/vitest|jest|mocha/.test(String(manifest.scripts?.test)))
    notes.push(
      "TypeScript: Node runs the .ts files itself by removing the types. Nothing compiles or type-checks them, so import each file by its real name and extension, and use only the fields the declarations below have: a field they lack is undefined when the test runs, not an error.",
    );
  const node = manifest.engines?.node;
  if (typeof node === "string") notes.push(`Node: ${node}.`);
  const start = typeof manifest.scripts?.start === "string" ? manifest.scripts.start : null;
  const words = [start ?? "", typeof manifest.main === "string" ? manifest.main : ""]
    .join(" ")
    .split(/\s+/)
    .map((word) => normalize(word));
  const entries = [...new Set(words.filter((word) => tracked.includes(word)))];
  if (start !== null)
    notes.push(
      `The application starts with \`${start}\` (the start script)${entries.length === 0 ? "" : `; its entry is shown below`}.`,
    );
  return { notes, entries };
}
