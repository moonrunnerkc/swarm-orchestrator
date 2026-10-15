import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";

/**
 * The HOME a run's child processes get: one private directory per independent run.
 *
 * Every run on a machine used to share one directory under the system scratch, so what one
 * run's children installed there (a browser a test suite downloads, a cache a tool warms) was
 * there for the next run without that run having established it. Two launches of a comparison
 * measured one gate under different environments for exactly that reason. A run now gets a
 * directory of its own, named after its run id, created once at the run's lifecycle boundary
 * and handed to every child it spawns: tool shells, gate commands, internal repair attempts
 * and the final independent verification all read the same one. Two runs never share it;
 * `SWARM_CHILD_HOME` is the one way to share, and it is the caller's choice, recorded as such.
 *
 * This is state separation, not containment: a child process can still reach any path the
 * host lets it. What it cannot do is find, in its HOME, what another run left there.
 */

/**
 * The name a supervisor sets to give a run a child HOME it chose. Explicit by construction:
 * the directory may already hold state, and it may be shared between runs. The value must be
 * an absolute path.
 */
export const childHomeEnvironmentName = "SWARM_CHILD_HOME";

/** Thrown where the named child HOME is not a usable absolute path. Fail closed, not silently default. */
export class UnusableChildHome extends Error {
  constructor(named: string) {
    super(
      `${childHomeEnvironmentName}=${JSON.stringify(named)} is not an absolute path; name an absolute directory or unset it`,
    );
    this.name = "UnusableChildHome";
  }
}

/** Thrown where a private home exists but is not this run's to take. */
export class ChildHomeNotOwned extends Error {
  constructor(path: string, reason: string) {
    super(
      `${path} is not a child HOME this run owns: ${reason}. Remove it, or resume the run it belongs to.`,
    );
    this.name = "ChildHomeNotOwned";
  }
}

/** Thrown where another live process holds the run's private home. */
export class ChildHomeInUse extends Error {
  constructor(path: string, pid: number) {
    super(
      `${path} is held by process ${pid}, which is still running; one process at a time may continue a run`,
    );
    this.name = "ChildHomeInUse";
  }
}

const markerName = ".swarm-child-home.json";

const markerSchema = z.object({
  schema: z.literal("swarm-child-home.v1"),
  runId: z.string().min(1),
  pid: z.number().int().positive(),
  createdAt: z.number().int(),
  heldSince: z.number().int(),
});

type ChildHomeMarker = z.infer<typeof markerSchema>;

export interface RunChildHome {
  readonly path: string;
  /**
   * `private`: allocated for this run alone, owned by a marker naming the run, removed by the
   * run unless it is kept for resumption. `explicit`: the directory `SWARM_CHILD_HOME` named,
   * which the caller may be sharing between runs and which the run never removes.
   */
  readonly mode: "private" | "explicit";
  /**
   * `created`: a fresh private home. `resumed`: the run's earlier private home, validated and
   * taken over. `recreated`: a resumed run whose earlier home was gone, so a fresh one was made
   * and the earlier state is absent. `named`: the explicit directory.
   */
  readonly origin: "created" | "resumed" | "recreated" | "named";
  /** The run the home belongs to: the original run id where this is a resumption. */
  readonly runId: string;
  /**
   * npm's content-addressed store, linked under the home, or null where none was linked. The
   * store holds package bytes keyed by their integrity hash, so sharing it shares no mutable
   * prerequisite state; everything else a tool writes under HOME stays with the run.
   */
  readonly npmCache: string | null;
}

export interface EstablishChildHomeOptions {
  /** The run that will own the home, or the session continuing an earlier run. */
  readonly runId: string;
  /** The earlier run whose private home this session continues, where it is a resumption. */
  readonly resumeOf?: string | undefined;
  /** Where private homes live. Defaults under the system scratch directory. */
  readonly root?: string | undefined;
  readonly inherited?: Readonly<Record<string, string | undefined>> | undefined;
  readonly pid?: number | undefined;
  readonly now?: number | undefined;
  /** Whether a process is still alive, for the in-use check. Defaults to signal zero. */
  readonly isAlive?: ((pid: number) => boolean) | undefined;
}

/** Where private homes are allocated: one directory per run under the system scratch. */
export function childHomesRoot(scratch: string = tmpdir()): string {
  return join(scratch, "swarm-child-homes");
}

/** The content-addressed npm store every private home links in. */
function sharedNpmStore(root: string): string {
  return join(root, "npm-cache", "_cacache");
}

let current: RunChildHome | null = null;

/** The home the current process established for its run, or null where none was. */
export function currentChildHome(): RunChildHome | null {
  return current;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // No permission to signal it is still an answer: the process exists.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * A directory this user owns, not a symlink, readable by nobody else. Where a scratch root is
 * shared between users, a pre-planted path under it would otherwise be taken as the run's own.
 */
function assertPrivateDirectory(path: string): void {
  const status = lstatSync(path);
  if (status.isSymbolicLink() || !status.isDirectory())
    throw new ChildHomeNotOwned(path, "it is not a plain directory");
  if (typeof process.getuid === "function" && status.uid !== process.getuid())
    throw new ChildHomeNotOwned(path, "another user owns it");
  if ((status.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

function createPrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(path);
}

function readMarker(path: string): ChildHomeMarker | null {
  let text: string;
  try {
    text = readFileSync(join(path, markerName), "utf8");
  } catch {
    return null;
  }
  const parsed = markerSchema.safeParse(JSON.parse(text));
  return parsed.success ? parsed.data : null;
}

function writeMarker(path: string, marker: ChildHomeMarker): void {
  writeFileSync(join(path, markerName), `${JSON.stringify(marker)}\n`, { mode: 0o600 });
}

function linkNpmStore(home: string, root: string): string {
  const store = sharedNpmStore(root);
  mkdirSync(store, { recursive: true, mode: 0o700 });
  mkdirSync(join(home, ".npm"), { recursive: true, mode: 0o700 });
  const link = join(home, ".npm", "_cacache");
  if (!existsSync(link)) symlinkSync(store, link);
  return store;
}

/**
 * Establishes the child HOME for one run and makes it the process's current one, so every
 * child environment built from here on carries it. Called once at a run's lifecycle boundary.
 */
export function establishRunChildHome(options: EstablishChildHomeOptions): RunChildHome {
  const inherited = options.inherited ?? process.env;
  const named = inherited[childHomeEnvironmentName];
  if (named !== undefined && named.trim() !== "") {
    if (!isAbsolute(named)) throw new UnusableChildHome(named);
    mkdirSync(named, { recursive: true, mode: 0o700 });
    current = {
      path: named,
      mode: "explicit",
      origin: "named",
      runId: options.runId,
      npmCache: null,
    };
    return current;
  }

  const root = options.root ?? childHomesRoot();
  createPrivateDirectory(root);
  const owner = options.resumeOf ?? options.runId;
  const path = join(root, owner);
  const pid = options.pid ?? process.pid;
  const now = options.now ?? Date.now();
  const isAlive = options.isAlive ?? processIsAlive;

  if (existsSync(path)) {
    assertPrivateDirectory(path);
    const marker = readMarker(path);
    if (marker === null) throw new ChildHomeNotOwned(path, "it carries no ownership marker");
    if (marker.runId !== owner)
      throw new ChildHomeNotOwned(path, `its marker names run ${marker.runId}`);
    if (marker.pid !== pid && isAlive(marker.pid)) throw new ChildHomeInUse(path, marker.pid);
    writeMarker(path, { ...marker, pid, heldSince: now });
    current = {
      path,
      mode: "private",
      origin: "resumed",
      runId: owner,
      npmCache: linkNpmStore(path, root),
    };
    return current;
  }

  createPrivateDirectory(path);
  writeMarker(path, {
    schema: "swarm-child-home.v1",
    runId: owner,
    pid,
    createdAt: now,
    heldSince: now,
  });
  current = {
    path,
    mode: "private",
    origin: options.resumeOf === undefined ? "created" : "recreated",
    runId: owner,
    npmCache: linkNpmStore(path, root),
  };
  return current;
}

/**
 * Releases the run's home. A private home is removed unless `keep` asks for it to stay for a
 * resumption; removal re-reads the marker first, so a directory that is no longer the run's is
 * left alone. An explicit home is never removed: the run did not make it.
 */
export function releaseRunChildHome(home: RunChildHome, options: { readonly keep: boolean }): void {
  if (current !== null && current.path === home.path) current = null;
  if (home.mode === "explicit" || options.keep) return;
  const marker = readMarker(home.path);
  if (marker === null || marker.runId !== home.runId) return;
  rmSync(home.path, { recursive: true, force: true });
}

/**
 * A command's whole lifetime under one child home: established before, released after. The
 * home stays where the command threw, since a failed run may be resumed or inspected; a
 * command that returned decides with `keep`.
 */
export async function withRunChildHome<T>(
  options: EstablishChildHomeOptions,
  run: (home: RunChildHome) => Promise<T>,
  keep: (result: T) => boolean = () => false,
): Promise<T> {
  const home = establishRunChildHome(options);
  let result: T;
  try {
    result = await run(home);
  } catch (cause) {
    releaseRunChildHome(home, { keep: true });
    throw cause;
  }
  releaseRunChildHome(home, { keep: keep(result) });
  return result;
}

let processHome: RunChildHome | null = null;

/**
 * The home for a process that established none: private to this process, made once, removed
 * when it exits. It keeps two processes apart even where neither named a run, which is what a
 * shared default could not do; what it lacks is a run's identity, which only the lifecycle
 * boundary can give.
 */
export function processChildHome(root: string = childHomesRoot()): RunChildHome {
  if (processHome !== null && existsSync(processHome.path)) return processHome;
  const runId = `process-${process.pid}-${randomBytes(3).toString("hex")}`;
  const path = join(root, runId);
  createPrivateDirectory(root);
  createPrivateDirectory(path);
  writeMarker(path, {
    schema: "swarm-child-home.v1",
    runId,
    pid: process.pid,
    createdAt: Date.now(),
    heldSince: Date.now(),
  });
  const home: RunChildHome = {
    path,
    mode: "private",
    origin: "created",
    runId,
    npmCache: linkNpmStore(path, root),
  };
  processHome = home;
  process.once("exit", () => {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // The process is ending; a directory it could not remove is one gc sweeps later.
    }
  });
  return home;
}

export interface CollectedChildHome {
  readonly runId: string;
  readonly directory: string;
  readonly modifiedAt: number;
}

/**
 * Private homes nobody holds any more, older than the window: a run that was killed before it
 * could release its home, or one kept for a resumption that never came. A home whose marker
 * names a live process is skipped. Removes only when asked, as the session sweep does.
 */
export function collectChildHomes(options: {
  readonly root?: string | undefined;
  readonly olderThan: number;
  readonly now: number;
  readonly remove?: boolean | undefined;
  readonly isAlive?: ((pid: number) => boolean) | undefined;
}): readonly CollectedChildHome[] {
  const root = options.root ?? childHomesRoot();
  const isAlive = options.isAlive ?? processIsAlive;
  if (!existsSync(root)) return [];
  const matched: CollectedChildHome[] = [];
  for (const marker of markersUnder(root)) {
    if (marker.heldSince > options.now - options.olderThan) continue;
    if (isAlive(marker.pid)) continue;
    const directory = join(root, marker.runId);
    matched.push({ runId: marker.runId, directory, modifiedAt: marker.heldSince });
    if (options.remove === true) rmSync(directory, { recursive: true, force: true });
  }
  return matched;
}

function markersUnder(root: string): readonly ChildHomeMarker[] {
  const markers: ChildHomeMarker[] = [];
  for (const entry of readdirSafe(root)) {
    const directory = join(root, entry);
    let status: ReturnType<typeof lstatSync>;
    try {
      status = lstatSync(directory);
    } catch {
      continue;
    }
    if (!status.isDirectory() || status.isSymbolicLink()) continue;
    const marker = readMarker(directory);
    // Only a directory whose marker names itself is a home this sweep made.
    if (marker !== null && resolve(root, marker.runId) === resolve(directory)) markers.push(marker);
  }
  return markers;
}

function readdirSafe(root: string): readonly string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}
