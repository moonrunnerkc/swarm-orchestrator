import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * A change to one file's text, written by the model as a block rather than a shell command: the
 * whole file, or exact replacements in it. Added after BSD `sed -i` failed every in-place edit
 * two macOS runs tried (2026-11-03); a block means the same thing on every platform.
 */
export type FileEdit =
  | { readonly mode: "write"; readonly path: string; readonly content: string }
  | {
      readonly mode: "edit";
      readonly path: string;
      readonly pairs: readonly { readonly search: string; readonly replace: string }[];
    };

const searchLine = /^<{7} SEARCH[ \t]*$/;
const dividerLine = /^={7}[ \t]*$/;
const replaceLine = /^>{7} REPLACE[ \t]*$/;

/** The path as the block's info string names it, quotes taken off. */
const pathOf = (info: string) => info.trim().replace(/^(["'])(.*)\1$/, "$2");

/** An edit block's body read as its pairs, or why it cannot be. */
export function readEditBlock(
  info: string,
  body: string,
): FileEdit | { readonly malformed: string } {
  const path = pathOf(info);
  if (path === "") return { malformed: "the edit block names no file after `edit`" };
  const pairs: { search: string; replace: string }[] = [];
  let part: "outside" | "search" | "replace" = "outside";
  let search: string[] = [];
  let replace: string[] = [];
  for (const line of body.split("\n")) {
    if (part === "outside" && searchLine.test(line)) {
      part = "search";
      search = [];
      replace = [];
    } else if (part === "search" && dividerLine.test(line)) {
      part = "replace";
    } else if (part === "replace" && replaceLine.test(line)) {
      pairs.push({ search: search.join("\n"), replace: replace.join("\n") });
      part = "outside";
    } else if (part === "search") {
      search.push(line);
    } else if (part === "replace") {
      replace.push(line);
    } else if (line.trim() !== "") {
      return { malformed: "the edit block has text outside its SEARCH and REPLACE parts" };
    }
  }
  if (part !== "outside") {
    return {
      malformed: "the edit block has a SEARCH part not closed by ======= and >>>>>>> REPLACE",
    };
  }
  if (pairs.length === 0) return { malformed: "the edit block has no SEARCH and REPLACE part" };
  if (pairs.some((pair) => pair.search.trim() === "")) {
    return { malformed: "a SEARCH part is empty; use a write block to create a file" };
  }
  return { mode: "edit", path, pairs };
}

export function readWriteBlock(
  info: string,
  body: string,
): FileEdit | { readonly malformed: string } {
  const path = pathOf(info);
  if (path === "") return { malformed: "the write block names no file after `write`" };
  return {
    mode: "write",
    path,
    content: body.length === 0 || body.endsWith("\n") ? body : `${body}\n`,
  };
}

/** The block as the model would write it, for the ledger and for comparing one turn with the last. */
export function editText(edit: FileEdit): string {
  if (edit.mode === "write") return `write ${edit.path}\n${edit.content}`;
  return [
    `edit ${edit.path}`,
    ...edit.pairs.flatMap((pair) => [
      "<<<<<<< SEARCH",
      pair.search,
      "=======",
      pair.replace,
      ">>>>>>> REPLACE",
    ]),
  ].join("\n");
}

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) count += 1;
  return count;
}

/**
 * The file's new text, or why nothing changes. Pairs apply in order, each to the text the one
 * before left, and each must match exactly once: zero matches or several refuse the whole block.
 */
export function applyReplacements(
  text: string,
  pairs: readonly { readonly search: string; readonly replace: string }[],
): { readonly text: string } | { readonly refused: string } {
  let next = text;
  for (const [index, pair] of pairs.entries()) {
    const found = occurrences(next, pair.search);
    const which = pairs.length > 1 ? `SEARCH part ${index + 1}` : "the SEARCH part";
    if (found === 0) {
      return {
        refused: `${which} matches nothing in the file; copy the lines exactly as the file has them, whitespace included${closestLines(next, pair.search)}`,
      };
    }
    if (found > 1) {
      return {
        refused: `${which} matches ${found} places in the file; include more of the surrounding lines so it matches one`,
      };
    }
    const at = next.indexOf(pair.search);
    next = `${next.slice(0, at)}${pair.replace}${next.slice(at + pair.search.length)}`;
  }
  return { text: next };
}

/**
 * The file's lines nearest a SEARCH part that matched nothing: the run of as many lines, as
 * numbered in the file, that shares the most lines with it (whitespace at their ends aside).
 * pubprep (2026-11-04) sent the same unmatched SEARCH eight times to a refusal that said only to
 * copy the lines exactly; this says what the lines are.
 */
export function closestLines(text: string, search: string): string {
  const file = text.split("\n");
  const wanted = new Set(
    search
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  );
  const size = Math.min(Math.max(search.split("\n").length, 3), 30);
  let best = { at: -1, shared: 0 };
  for (let at = 0; at + 1 <= file.length; at += 1) {
    const window = file.slice(at, at + size);
    const shared = window.filter((line) => wanted.has(line.trim())).length;
    if (shared > best.shared) best = { at, shared };
  }
  if (best.at < 0) return "";
  const shown = file
    .slice(best.at, best.at + size)
    .map((line, offset) => `${String(best.at + offset + 1).padStart(5)}  ${line}`)
    .join("\n");
  return `. The file's closest lines, numbered as in the file:\n${shown}\n`;
}

export type EditResult =
  | {
      readonly applied: true;
      readonly summary: string;
      readonly before: string | null;
      readonly after: string;
    }
  | { readonly applied: false; readonly refused: string };

const lines = (text: string) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

const counted = (n: number) => (n === 1 ? "1 line" : `${n} lines`);

/** The edit applied to the file at `target`, already cleared by the path policy. */
export async function applyFileEdit(target: string, edit: FileEdit): Promise<EditResult> {
  const found = await stat(target).catch(() => null);
  if (found?.isDirectory() === true) {
    return { applied: false, refused: `${edit.path} is a directory, not a file` };
  }
  const before = found === null ? null : await readFile(target, "utf8");
  if (edit.mode === "write") {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, edit.content);
    const verb = before === null ? "created" : "rewrote";
    return {
      applied: true,
      summary: `${verb} ${edit.path}, ${counted(lines(edit.content))}`,
      before,
      after: edit.content,
    };
  }
  if (before === null) {
    return {
      applied: false,
      // Quoted as read: a fence line like ```edit path=src/a.ts names a file called "path=src/a.ts".
      refused: `no file at "${edit.path}": a fence line names the file after the block's name and nothing else, as in \`\`\`edit src/app.ts; an edit changes a file that exists, and a write block creates one`,
    };
  }
  const next = applyReplacements(before, edit.pairs);
  if ("refused" in next)
    return { applied: false, refused: `${next.refused}. ${edit.path} is unchanged` };
  await writeFile(target, next.text);
  const count = edit.pairs.length === 1 ? "1 replacement" : `${edit.pairs.length} replacements`;
  return {
    applied: true,
    summary: `edited ${edit.path}, ${count}; it now has ${counted(lines(next.text))}`,
    before,
    after: next.text,
  };
}
