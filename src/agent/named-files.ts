import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** A source file the task names by path, as the base has it: its imports and declarations. */
export interface NamedFile {
  readonly path: string;
  readonly outline: readonly string[];
}

const pathWord = /[\w@][\w@./-]*\.(?:[cm]?[jt]sx?|py)\b/g;
const outlineLine =
  /^(?:import\b|from\s+\S+\s+import\b|export\b|(?:async\s+)?def\s|class\s|(?:async\s+)?function\b|const\s|let\s|interface\s|type\s|enum\s)/;
const outlineLines = 60;
// Declarations whose braces hold names, not a body: import lists, interfaces, types, enums.
const listing = /^(?:import\b|export\s+(?:interface|type|enum)\b|interface\b|type\b|enum\b)/;

/**
 * The source files the task names by path, matched to tracked files exactly or by their tail, each
 * with its top-level import and declaration lines and no bodies: what a check written apart from
 * the change can call and must mock. claimcheck's upgrade (2026-11-05, rc.10): the author was told
 * only that src/adapters/worktree-toolchain.ts exists, wrote three tests against a class it does
 * not have, and never learned it exports prepareToolchain and runs commands through util/exec.
 */
export async function namedFiles(
  workspace: string,
  tracked: readonly string[],
  task: string,
): Promise<NamedFile[]> {
  const words = [...new Set(task.match(pathWord) ?? [])];
  const paths = words.flatMap((word) => {
    const hits = tracked.filter((one) => one === word || one.endsWith(`/${word}`));
    return hits.length === 1 && hits[0] !== undefined ? [hits[0]] : [];
  });
  const files: NamedFile[] = [];
  for (const path of [...new Set(paths)].slice(0, 3)) {
    const text = await readFile(join(workspace, path), "utf8").catch(() => "");
    const lines = text.split("\n");
    const outline: string[] = [];
    for (const [at, line] of lines.entries()) {
      if (!outlineLine.test(line)) continue;
      outline.push(line.trimEnd().slice(0, 160));
      // A signature or import list over several lines is followed to its close.
      const open = /[(,]\s*$/.test(line) || (/\{\s*$/.test(line) && listing.test(line));
      if (!open) continue;
      for (const next of lines.slice(at + 1, at + 9)) {
        outline.push(next.trimEnd().slice(0, 160));
        if (/^[)}]/.test(next.trim())) break;
      }
    }
    outline.splice(outlineLines);
    if (outline.length > 0) files.push({ path, outline });
  }
  return files;
}
