/**
 * The paths a Git patch touches, read the way `git apply` reads them.
 *
 * Git writes a path in C-style quotes when it holds a double quote, a backslash, a control
 * character or (under the default `core.quotePath=true`) a byte above 0x7f, and writes it bare
 * otherwise, spaces included. A bare `diff --git a/x y b/x y` line cannot be split by itself, so
 * the section's `---`/`+++`, `rename from`/`rename to` and `copy from`/`copy to` lines decide it,
 * and a header they cannot settle is refused rather than guessed. Every parser of patch paths in
 * this repository goes through here, so scope checks and measurement name the same files.
 *
 * Read from the section headers rather than only from the `+++` line because that line carries
 * `/dev/null` for a deletion, and a path check that skipped it would skip exactly the case where
 * a patch removes a file it was told not to touch.
 */

/** A patch path this module cannot read with certainty; no scope check may rely on a guess. */
export class PatchPathError extends Error {
  override readonly name = "PatchPathError";
}

export type PatchChange = "added" | "deleted" | "modified" | "renamed" | "copied";

export interface PatchFile {
  /** The path before the change, without its `a/` prefix; null when the file is created. */
  readonly oldPath: string | null;
  /** The path after the change, without its `b/` prefix; null when the file is deleted. */
  readonly newPath: string | null;
  readonly change: PatchChange;
  /** `git` for a `diff --git` section, `traditional` for a bare `---`/`+++` pair. */
  readonly header: "git" | "traditional";
}

const namedEscapes = new Map<string, number>([
  ["a", 7],
  ["b", 8],
  ["t", 9],
  ["n", 10],
  ["v", 11],
  ["f", 12],
  ["r", 13],
  ['"', 34],
  ["\\", 92],
]);

/**
 * Decode one C-quoted path starting at `start`, as git's `unquote_c_style` does: three-digit
 * octal escapes are raw bytes, so a quoted UTF-8 name arrives as its byte sequence and is decoded
 * once at the end. Bytes that are not UTF-8 have no faithful string form and are refused.
 */
export function readQuotedPath(text: string, start: number): { path: string; end: number } {
  if (text[start] !== '"') throw new PatchPathError("unreadable patch path: expected a quote");
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let at = start + 1;
  while (at < text.length) {
    const char = text[at] ?? "";
    if (char === '"') return { path: decodeBytes(bytes), end: at + 1 };
    if (char === "\\") {
      const octal = /^[0-3][0-7]{2}/.exec(text.slice(at + 1, at + 4));
      if (octal !== null) {
        bytes.push(Number.parseInt(octal[0], 8));
        at += 4;
        continue;
      }
      const next = text[at + 1] ?? "";
      const byte = namedEscapes.get(next);
      if (byte === undefined)
        throw new PatchPathError(`unreadable quoted patch path: unknown escape \\${next}`);
      bytes.push(byte);
      at += 2;
      continue;
    }
    const whole = String.fromCodePoint(text.codePointAt(at) ?? 0);
    bytes.push(...encoder.encode(whole));
    at += whole.length;
  }
  throw new PatchPathError("unreadable quoted patch path: the closing quote is missing");
}

function decodeBytes(bytes: readonly number[]): string {
  try {
    // ignoreBOM keeps a leading U+FEFF as part of the name instead of silently dropping it.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      Uint8Array.from(bytes),
    );
  } catch {
    throw new PatchPathError("unreadable quoted patch path: its bytes are not UTF-8");
  }
}

/** A path that fills the rest of a line: quoted to its exact end, or bare as written. */
export function readWholePath(text: string): string {
  if (!text.startsWith('"')) return text;
  const quoted = readQuotedPath(text, 0);
  if (quoted.end !== text.length)
    throw new PatchPathError("unreadable patch path: text follows its closing quote");
  return quoted.path;
}

/**
 * The path on a `---` or `+++` line, prefix included, or null for `/dev/null`. Git ends a bare
 * name holding a space with a tab (and a traditional diff puts its timestamp after one), and
 * never writes a tab inside a bare name, so the name stops at the first tab.
 */
export function readFileLinePath(rest: string): string | null {
  if (rest.startsWith('"')) {
    const quoted = readQuotedPath(rest, 0);
    const tail = rest.slice(quoted.end);
    if (tail !== "" && !tail.startsWith("\t"))
      throw new PatchPathError("unreadable patch path: text follows its closing quote");
    return quoted.path;
  }
  const name = rest.split("\t")[0] ?? "";
  return name === "/dev/null" ? null : name;
}

/**
 * Every way the text after `diff --git ` splits into an `a/` side and a `b/` side, prefixes
 * removed. A quoted side has exactly one reading; two bare sides have one per ` b/` in the line.
 */
export function diffGitHeaderPaths(rest: string): ReadonlyArray<{ old: string; new: string }> {
  const splits: Array<[string, string]> = [];
  if (rest.startsWith('"')) {
    const first = readQuotedPath(rest, 0);
    if (rest[first.end] !== " ")
      throw new PatchPathError("unreadable diff --git header: no space after the first path");
    splits.push([first.path, readWholePath(rest.slice(first.end + 1))]);
  } else if (rest.includes('"')) {
    // Git quotes a bare-looking name that holds a quote, so the first quote opens the second path.
    const quote = rest.indexOf('"');
    if (rest[quote - 1] !== " ")
      throw new PatchPathError("unreadable diff --git header: a quote inside a bare path");
    splits.push([rest.slice(0, quote - 1), readWholePath(rest.slice(quote))]);
  } else {
    for (let at = rest.indexOf(" b/"); at !== -1; at = rest.indexOf(" b/", at + 1))
      splits.push([rest.slice(0, at), rest.slice(at + 1)]);
  }
  return splits
    .filter(([old, next]) => old.startsWith("a/") && next.startsWith("b/"))
    .map(([old, next]) => ({ old: old.slice(2), new: next.slice(2) }))
    .filter((pair) => pair.old !== "" && pair.new !== "");
}

interface GitSection {
  readonly candidates: ReadonlyArray<{ old: string; new: string }>;
  minus?: string | null;
  plus?: string | null;
  renameFrom?: string | undefined;
  renameTo?: string | undefined;
  copyFrom?: string | undefined;
  copyTo?: string | undefined;
  created: boolean;
  deleted: boolean;
}

function disagree(): PatchPathError {
  return new PatchPathError("patch path headers disagree; refusing ambiguous scope");
}

/** The one value every naming line agrees on, or undefined where none names this side. */
function agreed(...names: ReadonlyArray<string | null | undefined>): string | undefined {
  const named = new Set(names.filter((name): name is string => typeof name === "string"));
  if (named.size > 1) throw disagree();
  return [...named][0];
}

/** A `---` or `+++` line repeated in one header must repeat the same name, `/dev/null` included. */
function once(previous: string | null | undefined, value: string | null): string | null {
  if (previous !== undefined && previous !== value) throw disagree();
  return value;
}

function stripSide(name: string | null, prefix: "a/" | "b/"): string | null {
  if (name === null) return null;
  if (!name.startsWith(prefix) || name.length === prefix.length) throw disagree();
  return name.slice(prefix.length);
}

function resolveGitSection(section: GitSection): PatchFile {
  const renamed = section.renameFrom !== undefined || section.renameTo !== undefined;
  const copied = section.copyFrom !== undefined || section.copyTo !== undefined;
  const created = section.created || section.minus === null;
  const deleted = section.deleted || section.plus === null;
  if (
    (renamed && (section.renameFrom === undefined || section.renameTo === undefined)) ||
    (copied && (section.copyFrom === undefined || section.copyTo === undefined)) ||
    [renamed, copied, created, deleted].filter(Boolean).length > 1
  )
    throw disagree();
  const old = agreed(section.minus, section.renameFrom, section.copyFrom);
  const next = agreed(section.plus, section.renameTo, section.copyTo);
  let matches = section.candidates.filter(
    (pair) =>
      (old === undefined || pair.old === old) &&
      (next === undefined || pair.new === next) &&
      // Git names a created or deleted file identically on both sides of its header.
      (!(created || deleted) || pair.old === pair.new),
  );
  // Git's own rule for a bare header nothing else names: accept it only where both sides agree.
  if (matches.length > 1) matches = matches.filter((pair) => pair.old === pair.new);
  if (section.candidates.length === 0)
    throw new PatchPathError(
      "unreadable diff --git header: expected a/ and b/ prefixed paths; regenerate the patch with git diff's default prefixes",
    );
  if (matches.length === 0) throw disagree();
  const [match, ...others] = matches;
  if (match === undefined || others.length > 0)
    throw new PatchPathError(
      "ambiguous diff --git header: its paths cannot be split with certainty and no ---/+++ or rename lines settle them",
    );
  return {
    oldPath: created ? null : match.old,
    newPath: deleted ? null : match.new,
    change: created
      ? "added"
      : deleted
        ? "deleted"
        : renamed
          ? "renamed"
          : copied
            ? "copied"
            : "modified",
    header: "git",
  };
}

/** Everything up to and including the first slash, as `git apply`'s default `-p1` removes. */
function stripComponent(name: string | null): string | null {
  if (name === null) return null;
  const slash = name.indexOf("/");
  return slash === -1 ? name : name.slice(slash + 1);
}

const hunkHeader = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/;
// `git apply` still reads the older `rename old`/`rename new` spelling, so it counts here too.
const renameSource = /^rename (?:from|old) /;
const renameTarget = /^rename (?:to|new) /;

/**
 * Every file section in a patch. Hunks are consumed by their declared line counts, as
 * `git apply` consumes them, so a removed line that reads `--- a/x` stays content while a
 * `---`/`+++` pair after the last hunk is read as the further file it is to `git apply`.
 */
export function readPatchFiles(patch: string): readonly PatchFile[] {
  const files: PatchFile[] = [];
  const lines = patch.split("\n");
  let section: GitSection | null = null;
  let inHeader = false;
  let oldLeft = 0;
  let newLeft = 0;
  const finish = (): void => {
    if (section !== null) files.push(resolveGitSection(section));
    section = null;
    inHeader = false;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (oldLeft > 0 || newLeft > 0) {
      const mark = line[0];
      if (mark === " " || line === "") {
        oldLeft -= 1;
        newLeft -= 1;
        continue;
      }
      if (mark === "-") {
        oldLeft -= 1;
        continue;
      }
      if (mark === "+") {
        newLeft -= 1;
        continue;
      }
      if (mark === "\\") continue;
      // A hunk shorter than its header claims: `git apply` refuses it as corrupt, and reading on
      // from here keeps any header it hid inside the path set.
      oldLeft = 0;
      newLeft = 0;
    }
    if (line.startsWith("diff --git ")) {
      finish();
      section = {
        candidates: diffGitHeaderPaths(line.slice("diff --git ".length)),
        created: false,
        deleted: false,
      };
      inHeader = true;
      continue;
    }
    if (line.startsWith("@@")) {
      const counts = hunkHeader.exec(line);
      if (counts === null) throw new PatchPathError(`malformed hunk header: ${line.slice(0, 80)}`);
      oldLeft = Number(counts[1] ?? "1");
      newLeft = Number(counts[2] ?? "1");
      inHeader = false;
      continue;
    }
    if (inHeader && section !== null) {
      const current: GitSection = section;
      if (line.startsWith("--- "))
        current.minus = once(current.minus, stripSide(readFileLinePath(line.slice(4)), "a/"));
      else if (line.startsWith("+++ "))
        current.plus = once(current.plus, stripSide(readFileLinePath(line.slice(4)), "b/"));
      else if (renameSource.test(line))
        current.renameFrom = agreed(
          current.renameFrom,
          readWholePath(line.replace(renameSource, "")),
        );
      else if (renameTarget.test(line))
        current.renameTo = agreed(current.renameTo, readWholePath(line.replace(renameTarget, "")));
      else if (line.startsWith("copy from "))
        current.copyFrom = agreed(current.copyFrom, readWholePath(line.slice(10)));
      else if (line.startsWith("copy to "))
        current.copyTo = agreed(current.copyTo, readWholePath(line.slice(8)));
      else if (line.startsWith("new file mode ")) current.created = true;
      else if (line.startsWith("deleted file mode ")) current.deleted = true;
      else if (!/^(?:old mode|new mode|similarity index|dissimilarity index|index) /.test(line))
        // `Binary files`, `GIT binary patch` or anything else ends the extended header.
        inHeader = false;
      continue;
    }
    const following = lines[index + 1] ?? "";
    if (line.startsWith("--- ") && following.startsWith("+++ ")) {
      finish();
      const old = stripComponent(readFileLinePath(line.slice(4)));
      const next = stripComponent(readFileLinePath(following.slice(4)));
      files.push({
        oldPath: old,
        newPath: next,
        change: old === null ? "added" : next === null ? "deleted" : "modified",
        header: "traditional",
      });
      index += 1;
    }
  }
  finish();
  return files;
}

/** Every path a patch names on either side, sorted and unique. Throws `PatchPathError`. */
export function pathsInPatch(patch: string): readonly string[] {
  const paths = new Set<string>();
  for (const file of readPatchFiles(patch)) {
    if (file.oldPath !== null) paths.add(file.oldPath);
    if (file.newPath !== null) paths.add(file.newPath);
  }
  paths.delete("");
  return [...paths].sort();
}
