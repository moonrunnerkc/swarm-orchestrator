import { posix } from "node:path";
import { digest } from "./instrument-dependencies.ts";

/**
 * Whether a changed file is its base content with its references moved along the renames the
 * same patch makes (rename-transport-v1).
 *
 * A refactor that renames files has to change every file that names them: a lint configuration's
 * ignore list, a build script's entry point, a test's `require`. The instrument rule reads each of
 * those as an edit to the instrument, and putting the base's version back measures a tree whose
 * files it names are gone, so a correct rename was refused on both October 23 refactor tasks. This
 * reading tells that change apart from an edit to what the check does, by construction rather than
 * by judgment: two texts are compared word by word, every separator must be identical, and a word
 * may differ only where the base's word names a renamed file and the current word names that
 * file's new path. Anything else that differs (a rule switched off, a test glob narrowed, a status
 * swallowed, a bundle dropped) leaves the file changed, and the rule that held before decides it.
 *
 * The renames are not taken from git's similarity score or from the task. A deleted file and an
 * added file are a pair only where the added file is the deleted one under this same comparison,
 * and every pair is checked again under the final set, so a stub left at a new path is not a
 * rename of the module it replaced.
 *
 * What this does not establish: that a renamed file still does what it did (that is the tests'
 * question, and the source is compared up to moved references only), or that a configuration's
 * patterns select the same files after the move (a rename can carry a file into or out of a glob
 * the configuration names, and that is named as a residual where it is read).
 */
export const renameTransportRule = "rename-transport-v1";

export interface RenamePair {
  readonly from: string;
  readonly to: string;
}

/** A rename as recorded: both paths and the digests of the two contents compared. */
export interface RecordedRename extends RenamePair {
  readonly reference: string;
  readonly current: string;
}

export interface RenameTrees {
  reference(path: string): Promise<string | null>;
  current(path: string): Promise<string | null>;
  /** Every path that differs between the trees: added, modified or deleted. */
  readonly changed: readonly string[];
  /** Every path either tree holds. */
  readonly listed: ReadonlySet<string>;
}

export interface RenameMap {
  readonly pairs: readonly RecordedRename[];
  /** Where pairing stopped short, by reason; a residual is not a pair and grants nothing. */
  readonly residuals: readonly string[];
  /** Renamed path to new path, for lookups. */
  readonly byFrom: ReadonlyMap<string, string>;
  /** Paths only the base holds, and paths only the current tree holds. */
  readonly deleted: ReadonlySet<string>;
  readonly added: ReadonlySet<string>;
  readonly listed: ReadonlySet<string>;
}

const resolvable = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs", ".tsx", ".jsx", ".json", ".d.ts"];
/** At most this many deleted-by-added comparisons, and files no larger than this, are paired. */
const pairingLimit = 40_000;
const contentLimit = 2_000_000;

/** A path-like word: letters, digits and the characters a module path or file name holds. */
const word = /[A-Za-z0-9_$@.\-/]+/g;

interface Words {
  readonly words: readonly string[];
  readonly separators: readonly string[];
}

function split(text: string): Words {
  const words: string[] = [];
  const separators: string[] = [];
  let last = 0;
  for (const match of text.matchAll(word)) {
    separators.push(text.slice(last, match.index));
    words.push(match[0]);
    last = (match.index ?? 0) + match[0].length;
  }
  separators.push(text.slice(last));
  return { words, separators };
}

/** The paths a word could name from the file holding it, in the order a resolver tries them. */
function candidates(specifier: string, from: string): readonly string[] {
  const cleaned = specifier.replace(/^<rootDir>\//, "/").replace(/[?#].*$/, "");
  if (cleaned.length === 0 || cleaned.length > 300 || !/[/.]/.test(cleaned)) return [];
  const relative = cleaned.startsWith(".");
  const roots = relative
    ? [posix.normalize(posix.join(posix.dirname(from), cleaned))]
    : cleaned.startsWith("/")
      ? [posix.normalize(cleaned.replace(/^\/+/, ""))]
      : // A root-relative name (an ignore entry, a build entry) and one relative to the file.
        [posix.normalize(cleaned), posix.normalize(posix.join(posix.dirname(from), cleaned))];
  const paths: string[] = [];
  for (const root of roots) {
    if (root.startsWith("..") || root === ".") continue;
    paths.push(root);
    for (const extension of resolvable) paths.push(`${root}${extension}`);
    for (const extension of resolvable) paths.push(`${root}/index${extension}`);
  }
  return paths;
}

type Side = "reference" | "current";

function exists(map: Pick<RenameMap, "listed" | "added" | "deleted">, path: string, side: Side) {
  if (!map.listed.has(path)) return false;
  return side === "reference" ? !map.added.has(path) : !map.deleted.has(path);
}

/** The file a word names from `from` on one side, or null where it names none there. */
function resolve(
  map: Pick<RenameMap, "listed" | "added" | "deleted">,
  specifier: string,
  from: string,
  side: Side,
): string | null {
  for (const path of candidates(specifier, from)) if (exists(map, path, side)) return path;
  return null;
}

/**
 * Whether a differing pair of words is one reference moved along a rename. The base's word must
 * name a renamed file on the base, and the current word that file's new path on the current tree.
 * A word that names nothing from its own file is also read from the renamed file's directory, the
 * way a stub key in a test names a module relative to the module under test
 * (`proxyquire('../lib/a', { './b': ... })`).
 */
function movedReference(
  map: Pick<RenameMap, "listed" | "added" | "deleted">,
  renames: ReadonlyMap<string, string>,
  before: string,
  beforeFile: string,
  after: string,
  afterFile: string,
): boolean {
  const named = resolve(map, before, beforeFile, "reference");
  if (named !== null) {
    const moved = renames.get(named);
    return moved !== undefined && resolve(map, after, afterFile, "current") === moved;
  }
  if (
    trailingPath(before, after, (was, now) =>
      was.some((from) => {
        const to = renames.get(from);
        return to !== undefined && now.includes(to);
      }),
    )
  )
    return true;
  let found: string | null = null;
  for (const [from, to] of renames) {
    if (!candidates(before, posix.join(posix.dirname(from), "x")).includes(from)) continue;
    if (!candidates(after, posix.join(posix.dirname(to), "x")).includes(to)) continue;
    if (found !== null) return false;
    found = from;
  }
  return found !== null;
}

/**
 * Whether two words share a prefix and end in a path that, read from the repository root, names a
 * renamed file before and its new path after: a comment's link to the file in the project's
 * repository (`https://github.com/o/r/blob/master/src/renderer.mjs`), which the markdown-it task
 * says may follow the rename. `accepts` is given the paths each trailing part could name.
 */
function trailingPath(
  before: string,
  after: string,
  accepts: (was: readonly string[], now: readonly string[]) => boolean,
): boolean {
  for (let index = before.indexOf("/"); index !== -1; index = before.indexOf("/", index + 1)) {
    const prefix = before.slice(0, index + 1);
    if (!after.startsWith(prefix)) return false;
    const was = before.slice(index + 1);
    const now = after.slice(index + 1);
    if (was.length === 0 || now.length === 0) continue;
    if (accepts(candidates(was, "x"), candidates(now, "x"))) return true;
  }
  return false;
}

/**
 * The words at which two texts differ, or null where they differ in anything but words. Each
 * returned index is a word the caller must accept as a moved reference.
 */
function differingWords(before: string, after: string): readonly number[] | null {
  const a = split(before);
  const b = split(after);
  if (a.words.length !== b.words.length) return null;
  for (let index = 0; index < a.separators.length; index++)
    if (a.separators[index] !== b.separators[index]) return null;
  const differing: number[] = [];
  for (let index = 0; index < a.words.length; index++)
    if (a.words[index] !== b.words[index]) differing.push(index);
  return differing;
}

/**
 * Whether `after`, at `afterFile` in the current tree, is `before`, at `beforeFile` in the base,
 * with only references to renamed files moved to their new paths. Identical texts are equal.
 */
export function transportedEqual(
  map: RenameMap,
  before: string,
  beforeFile: string,
  after: string,
  afterFile: string,
): boolean {
  return equalUnder(map, map.byFrom, before, beforeFile, after, afterFile);
}

function equalUnder(
  map: Pick<RenameMap, "listed" | "added" | "deleted">,
  renames: ReadonlyMap<string, string>,
  before: string,
  beforeFile: string,
  after: string,
  afterFile: string,
): boolean {
  if (before === after) return true;
  if (renames.size === 0) return false;
  const differing = differingWords(before, after);
  if (differing === null || differing.length === 0) return false;
  const a = split(before).words;
  const b = split(after).words;
  return differing.every((index) =>
    movedReference(map, renames, a[index] as string, beforeFile, b[index] as string, afterFile),
  );
}

const stem = (path: string) => posix.basename(path).replace(/(\.d)?\.[^.]+$/, "");

/** How closely an added path matches a deleted one, to break a tie: same directory, then same stem. */
function closeness(from: string, to: string): number {
  const fold = (text: string) => text.replace(/[-_]/g, "").toLowerCase();
  return (
    (posix.dirname(from) === posix.dirname(to) ? 2 : 0) +
    (fold(stem(from)) === fold(stem(to)) ? 1 : 0)
  );
}

/**
 * The renames a patch makes: each deleted file paired with the one added file that is it under
 * moved references, verified again under the whole set until nothing more falls out. Bounded: a
 * patch with too many deletions and additions to compare, or a file too large to read, is paired
 * as far as it can be and the rest is named.
 */
export async function pairRenames(trees: RenameTrees): Promise<RenameMap> {
  const residuals: string[] = [];
  const deleted = new Map<string, string>();
  const added = new Map<string, string>();
  for (const path of trees.changed) {
    const [before, after] = await Promise.all([trees.reference(path), trees.current(path)]);
    if (before !== null && after === null) deleted.set(path, before);
    else if (before === null && after !== null) added.set(path, after);
  }
  const shape = {
    listed: trees.listed,
    deleted: new Set(deleted.keys()),
    added: new Set(added.keys()),
  };
  const empty: RenameMap = { pairs: [], residuals, byFrom: new Map(), ...shape };
  if (deleted.size === 0 || added.size === 0) return empty;
  if (deleted.size * added.size > pairingLimit) {
    residuals.push(
      `${deleted.size} deleted and ${added.size} added files are more than ${pairingLimit} comparisons; no rename was paired`,
    );
    return empty;
  }
  for (const [path, text] of [...deleted, ...added])
    if (text.length > contentLimit) {
      residuals.push(`${path} is larger than ${contentLimit} characters and was not paired`);
      deleted.delete(path);
      added.delete(path);
    }

  // First, every deleted-added pair that could be one: each differing word names some deleted
  // file before and some added file after, from its own file or from that file's directory. The
  // reading below that fixes the pairs is the strict one.
  const fromOwnDirectory = new Map<string, boolean>();
  const nameable = (specifier: string, paths: Iterable<string>, key: string) => {
    const cached = fromOwnDirectory.get(`${key}\0${specifier}`);
    if (cached !== undefined) return cached;
    let found = false;
    for (const path of paths)
      if (candidates(specifier, posix.join(posix.dirname(path), "x")).includes(path)) {
        found = true;
        break;
      }
    fromOwnDirectory.set(`${key}\0${specifier}`, found);
    return found;
  };
  const plausible = new Map<string, string[]>();
  for (const [from, before] of deleted)
    for (const [to, after] of added) {
      if (Math.abs(before.length - after.length) > Math.max(400, before.length * 0.25)) continue;
      const differing = differingWords(before, after);
      if (differing === null) continue;
      const a = split(before).words;
      const b = split(after).words;
      const ok = differing.every((index) => {
        const was = a[index] as string;
        const now = b[index] as string;
        const named = resolve(shape, was, from, "reference");
        if (named !== null) {
          const moved = resolve(shape, now, to, "current");
          return shape.deleted.has(named) && moved !== null && shape.added.has(moved);
        }
        if (
          trailingPath(
            was,
            now,
            (before, after) =>
              before.some((one) => shape.deleted.has(one)) &&
              after.some((one) => shape.added.has(one)),
          )
        )
          return true;
        return nameable(was, deleted.keys(), "deleted") && nameable(now, added.keys(), "added");
      });
      if (ok) plausible.set(from, [...(plausible.get(from) ?? []), to]);
    }

  // One added file per deleted file and one deleted file per added file; a tie is broken by
  // directory and name, and one that stays tied is not paired.
  const claimed = new Map<string, string[]>();
  for (const [from, options] of plausible) {
    const best = Math.max(...options.map((to) => closeness(from, to)));
    const chosen = options.filter((to) => closeness(from, to) === best);
    if (chosen.length !== 1) {
      residuals.push(`${from} matches ${chosen.length} added files equally; not paired`);
      continue;
    }
    const to = chosen[0] as string;
    claimed.set(to, [...(claimed.get(to) ?? []), from]);
  }
  let renames = new Map<string, string>();
  for (const [to, froms] of claimed) {
    if (froms.length === 1) renames.set(froms[0] as string, to);
    else residuals.push(`${to} matches ${froms.length} deleted files; not paired`);
  }

  // Verified under the set itself, until it is stable: a pair that only held because of another
  // pair that fell out falls out too.
  for (;;) {
    const kept = new Map<string, string>();
    for (const [from, to] of renames)
      if (
        equalUnder(shape, renames, deleted.get(from) as string, from, added.get(to) as string, to)
      )
        kept.set(from, to);
    if (kept.size === renames.size) break;
    renames = kept;
  }
  const pairs = [...renames]
    .map(([from, to]) => ({
      from,
      to,
      reference: digest(deleted.get(from) as string) as string,
      current: digest(added.get(to) as string) as string,
    }))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  return { pairs, residuals, byFrom: renames, ...shape };
}
