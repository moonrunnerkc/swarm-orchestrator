import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * Evidence accumulates. A session holds every prompt, every tool argument and the content of
 * every file the run read, and nothing was ever removing any of it, so a machine that ran the
 * tool for a month held a month of prompts under a directory nobody looks in.
 *
 * Deleting evidence is not a default and never happens as a side effect of anything else. This
 * names what it would remove and how much that frees, and removes only when asked.
 */
export interface CollectedSession {
  readonly sessionId: string;
  readonly directory: string;
  readonly modifiedAt: number;
  readonly bytes: number;
}

export interface Collection {
  readonly sessions: readonly CollectedSession[];
  readonly bytes: number;
  readonly removed: boolean;
  /** Sessions the sweep looked at, so "nothing matched" is told from "nothing was there". */
  readonly considered: number;
}

const windowUnits: Readonly<Record<string, number>> = {
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

/** A window a person would type: `30d`, `12h`, `90m`. Refused rather than guessed at. */
export function olderThanMs(window: string): number {
  const read = /^(\d+)([mhd])$/.exec(window.trim());
  const unit = read === null ? undefined : windowUnits[read[2] ?? ""];
  if (read === null || unit === undefined) {
    throw new Error(
      `"${window}" is not a retention window this build reads. Use a whole number of ` +
        "minutes, hours or days: 90m, 12h, 30d.",
    );
  }
  return Number(read[1]) * unit;
}

export async function collectSessions(options: {
  readonly root: string;
  readonly olderThan: number;
  readonly now: number;
  readonly remove?: boolean;
}): Promise<Collection> {
  let entries: string[];
  try {
    entries = await readdir(options.root);
  } catch {
    return { sessions: [], bytes: 0, removed: options.remove === true, considered: 0 };
  }

  const cutoff = options.now - options.olderThan;
  const matched: CollectedSession[] = [];
  let considered = 0;

  for (const entry of entries.sort()) {
    const directory = join(options.root, entry);
    // A session is a directory holding a ledger. Anything else under the root belongs to
    // somebody else, and a sweep that removed it would be deleting what it did not write.
    if (!(await isSessionDirectory(directory))) {
      continue;
    }
    considered += 1;
    const modifiedAt = (await stat(directory)).mtimeMs;
    if (modifiedAt > cutoff) {
      continue;
    }
    matched.push({
      sessionId: entry,
      directory,
      modifiedAt,
      bytes: await directorySize(directory),
    });
  }

  if (options.remove === true) {
    for (const session of matched) {
      await rm(session.directory, { recursive: true, force: true });
    }
  }

  return {
    sessions: matched,
    bytes: matched.reduce((total, session) => total + session.bytes, 0),
    removed: options.remove === true,
    considered,
  };
}

/** Enough to recognise what is going, short enough to read. A real store holds hundreds. */
const namesShown = 8;

export function describeCollection(collection: Collection, removed: boolean): string {
  if (collection.sessions.length === 0) {
    return collection.considered === 0
      ? "no sessions are stored here yet."
      : `${collection.considered} session(s) stored, none older than the window.`;
  }
  const size = `${(collection.bytes / 1_000_000).toFixed(1)} MB`;
  const shown = collection.sessions.slice(0, namesShown).map((session) => session.sessionId);
  const rest = collection.sessions.length - shown.length;
  const names = rest === 0 ? shown.join(", ") : `${shown.join(", ")}, and ${rest} more`;
  return removed
    ? `removed ${collection.sessions.length} session(s), freeing ${size}: ${names}`
    : `would remove ${collection.sessions.length} session(s), freeing ${size}: ${names}. ` +
        "Pass --remove to do it.";
}

async function isSessionDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(join(directory, "ledger.jsonl"))).isFile();
  } catch {
    return false;
  }
}

async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
  }
  return total;
}
