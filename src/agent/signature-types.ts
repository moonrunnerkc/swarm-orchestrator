import { readFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

const importLine = /^\s*(?:import\b|from\s+\S+\s+import\b)/;
const typeLines = 24;

/** The names a file imports from another of the repository's files, with that file's path. */
function importedNames(path: string, text: string, tracked: readonly string[]) {
  const found: { name: string; from: string }[] = [];
  const add = (names: string, from: string | null) => {
    if (from === null) return;
    for (const one of names.replace(/[(){}]/g, "").split(",")) {
      const word =
        one
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+/)[0] ?? "";
      if (/^\w+$/.test(word)) found.push({ name: word, from });
    }
  };
  for (const match of text.matchAll(/^from\s+(\.*)([\w.]*)\s+import\s+([^\n#]+)/gm)) {
    const [, dots = "", module = "", names = ""] = match;
    const parts = module.split(".").filter((one) => one.length > 0);
    const stem =
      dots.length === 0
        ? parts.join("/")
        : normalize(join(dirname(path), ...Array(dots.length - 1).fill(".."), ...parts));
    const hits = tracked.filter(
      (one) =>
        one === `${stem}.py` || one.endsWith(`/${stem}.py`) || one.endsWith(`/${stem}/__init__.py`),
    );
    add(names, hits.length === 1 ? (hits[0] ?? null) : null);
  }
  for (const match of text.matchAll(
    /^import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["'](\.[^"']+)["']/gm,
  )) {
    const [, names = "", spec = ""] = match;
    const stem = normalize(join(dirname(path), spec)).replace(/\.[cm]?[jt]sx?$/, "");
    const hit = [".ts", ".tsx", ".mts", ".js", ".mjs"]
      .map((ext) => `${stem}${ext}`)
      .find((one) => tracked.includes(one));
    add(names, hit ?? null);
  }
  return found;
}

/** A type's declaration with its decorators and fields, and no method bodies. */
function declaration(lines: readonly string[], name: string): string[] {
  const at = lines.findIndex((line) =>
    new RegExp(`^(?:export\\s+)?(?:class|interface|type)\\s+${name}\\b`).test(line),
  );
  if (at < 0) return [];
  let first = at;
  while (first > 0 && /^@/.test(lines[first - 1] ?? "")) first -= 1;
  const shown = lines.slice(first, at + 1).map((line) => line.trimEnd());
  const python = /:\s*$/.test(lines[at] ?? "");
  for (const line of lines.slice(at + 1)) {
    if (shown.length >= typeLines) break;
    if (python) {
      if (line.trim() === "") continue;
      if (!/^\s/.test(line)) break;
      if (/^\s{4}(?:\w+\s*:\s*\S|(?:async\s+)?def\s|@)/.test(line)) shown.push(line.trimEnd());
      continue;
    }
    shown.push(line.trimEnd());
    if (/^[)}]/.test(line)) break;
  }
  return shown;
}

/**
 * The declarations of the repository's own types that a file's outlined signatures use, from
 * the files it imports them from. A check written apart from the change builds those values, and
 * without their fields it guesses them (fix-tracemantle-f69ad0c58, Arm C, 2026-11-07).
 */
export async function signatureTypes(
  workspace: string,
  tracked: readonly string[],
  path: string,
  text: string,
  outline: readonly string[],
): Promise<{ path: string; outline: string[] }[]> {
  const signatures = outline.filter((line) => !importLine.test(line)).join("\n");
  const used = importedNames(path, text, tracked).filter(
    (one) => one.from !== path && new RegExp(`\\b${one.name}\\b`).test(signatures),
  );
  const byFile = new Map<string, string[]>();
  for (const one of used.slice(0, 3)) {
    const source = await readFile(join(workspace, one.from), "utf8").catch(() => "");
    const shown = declaration(source.split("\n"), one.name);
    if (shown.length > 0) byFile.set(one.from, [...(byFile.get(one.from) ?? []), ...shown]);
  }
  return [...byFile].map(([from, outline]) => ({ path: from, outline }));
}
