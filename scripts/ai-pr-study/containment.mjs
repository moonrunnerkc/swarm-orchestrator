/**
 * Checkout containment for the study scripts. Every path a reviewer model, a repository, a pull
 * request or a row names is resolved here, at the access itself, against the real location of
 * the root it must stay inside.
 *
 * What holds:
 * - A requested path is relative: absolute paths (POSIX or Windows form), NUL bytes, empty
 *   paths and any `..` segment are refused before the filesystem is touched, so `../x` and
 *   `a/../../x` never resolve anywhere.
 * - Containment is decided on real paths: the root and the target (or, for a write, the nearest
 *   existing ancestor of the target) are resolved with the native realpath, so a symlink inside
 *   the checkout that leads out of it, whether it is the final component or a directory on the
 *   way, is refused. The comparison is `path.relative`, never a string prefix, so a sibling such
 *   as `/tmp/checkout-evil` is not inside `/tmp/checkout`.
 * - The access is made through a descriptor opened with O_NOFOLLOW (and O_NONBLOCK, so a FIFO
 *   cannot stall the caller), and before any byte is read or written the descriptor's device and
 *   inode are compared with what the contained real path names at that moment, after resolving
 *   it again. A directory swapped for a symlink between the check and the open therefore either
 *   still resolves outside (refused) or names a different inode than the one opened (refused).
 *   Reads and writes then go through the verified descriptor, never the path.
 * - Writes create missing directories one level at a time under a contained real ancestor,
 *   refuse a final symlink, a non-regular file and a file with more than one hard link, and
 *   truncate only after the descriptor is verified.
 *
 * Residuals, stated because Node offers no openat, unlinkat or descriptor-to-path query on every
 * platform:
 * - Hard links: an inode reachable both inside and outside the checkout is indistinguishable by
 *   path. Reads through such a file are allowed (pnpm installs hard-link its store into
 *   node_modules); writes and removals refuse a file with more than one link.
 * - Listing reads the directory's entry names by path after verifying the opened directory, and
 *   verifies it again afterwards. A directory replaced by a symlink and restored entirely inside
 *   that window could expose the names (not contents) of an outside directory.
 * - Removal unlinks by path after verifying the parent and the file. A parent replaced by a
 *   symlink between that verification and the unlink could remove a same-named entry elsewhere.
 * Each of the last two requires a process concurrently rewriting the checkout during the call;
 * the study scripts run no container or other writer against the checkout while they access it.
 */
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep, win32 } from "node:path";

/** A requested path that is not, or would not stay, inside its root. */
export class ContainmentError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContainmentError";
  }
}

const realpath = (path) => realpathSync.native(path);

/**
 * The segments of a relative request, with `.` and empty segments dropped. The empty list is
 * the root itself. Anything absolute or containing `..` is refused outright rather than
 * normalised, so a request never depends on what its parent segments are on disk.
 */
export function relativeSegments(requested) {
  if (typeof requested !== "string" || requested.length === 0)
    throw new ContainmentError("the path is empty");
  if (requested.includes("\0")) throw new ContainmentError("the path contains a NUL byte");
  if (isAbsolute(requested) || win32.isAbsolute(requested))
    throw new ContainmentError(`${JSON.stringify(requested)} is absolute`);
  const segments = requested.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.includes(".."))
    throw new ContainmentError(`${JSON.stringify(requested)} leaves its root`);
  return segments;
}

/** One plain name under a root: no separator, no `.` or `..`, nothing absolute. */
export function childPath(root, segment) {
  if (
    typeof segment !== "string" ||
    segment === "" ||
    segment === "." ||
    segment === ".." ||
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes("\0")
  )
    throw new ContainmentError(`${JSON.stringify(segment)} is not one plain name`);
  return join(root, segment);
}

/** Whether a real path is the real root or below it; decided by path.relative, not a prefix. */
export function isInside(realRoot, candidate) {
  const between = relative(realRoot, candidate);
  return (
    between === "" || (between !== ".." && !between.startsWith(`..${sep}`) && !isAbsolute(between))
  );
}

function containedReal(realRoot, path, requested) {
  const real = realpath(path);
  if (!isInside(realRoot, real))
    throw new ContainmentError(`${JSON.stringify(requested)} resolves outside its root`);
  return real;
}

/** The real, contained location of an existing path, and its root-relative form. */
export function resolveExistingInside(root, requested) {
  const segments = relativeSegments(requested);
  const realRoot = realpath(root);
  const real = containedReal(realRoot, join(realRoot, ...segments), requested);
  return { realRoot, real, relative: relative(realRoot, real).split(sep).join("/") };
}

/**
 * The descriptor must name the inode the contained real path names now, resolved afresh; a
 * swap between resolution and open shows up as a path that no longer resolves to itself, one
 * that leaves the root, or a different inode.
 */
function confirmDescriptor(fd, realRoot, real, requested) {
  const again = realpath(real);
  if (again !== real || !isInside(realRoot, again))
    throw new ContainmentError(`${JSON.stringify(requested)} changed while it was opened`);
  const opened = fstatSync(fd);
  const named = lstatSync(real);
  if (opened.dev !== named.dev || opened.ino !== named.ino)
    throw new ContainmentError(`${JSON.stringify(requested)} changed while it was opened`);
  return opened;
}

function withDescriptor(path, flags, mode, use) {
  const fd = openSync(path, flags, mode);
  try {
    return use(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read an existing regular file inside the root, through a verified descriptor. Returns the
 * contents and the root-relative form of the real path read, so a caller can apply its own
 * refusals to what was actually opened rather than to how it was named.
 */
export function readFileInside(root, requested, encoding = "utf8") {
  const { realRoot, real, relative: realRelative } = resolveExistingInside(root, requested);
  return withDescriptor(
    real,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    undefined,
    (fd) => {
      const opened = confirmDescriptor(fd, realRoot, real, requested);
      if (!opened.isFile())
        throw new ContainmentError(`${JSON.stringify(requested)} is not a regular file`);
      return { contents: readFileSync(fd, encoding), relative: realRelative };
    },
  );
}

/**
 * The entries of a directory inside the root. An entry is marked a directory only when it is
 * one, or is a symlink whose real target is a directory inside the root; a symlink leading out
 * is listed by name and never followed.
 */
export function listDirectoryInside(root, requested) {
  const segments = relativeSegments(requested === "" ? "." : requested);
  const realRoot = realpath(root);
  const real = containedReal(realRoot, join(realRoot, ...segments), requested);
  return withDescriptor(
    real,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    undefined,
    (fd) => {
      const opened = confirmDescriptor(fd, realRoot, real, requested);
      if (!opened.isDirectory())
        throw new ContainmentError(`${JSON.stringify(requested)} is not a directory`);
      const names = readdirSync(real);
      confirmDescriptor(fd, realRoot, real, requested);
      return names.map((name) => {
        const entry = join(real, name);
        let directory = false;
        try {
          const status = lstatSync(entry);
          if (status.isDirectory()) directory = true;
          else if (status.isSymbolicLink()) {
            const target = realpath(entry);
            directory = isInside(realRoot, target) && statSync(target).isDirectory();
          }
        } catch {
          directory = false;
        }
        return { name, directory };
      });
    },
  );
}

/**
 * Where a write to `requested` would land, without creating anything: the real, contained
 * nearest existing ancestor and the segments still to create beneath it. An existing final
 * component must be a regular file, never a symlink or directory.
 */
export function resolveWriteTargetInside(root, requested) {
  const segments = relativeSegments(requested);
  if (segments.length === 0) throw new ContainmentError("the root itself is not a file");
  const realRoot = realpath(root);
  let existing = segments.length;
  for (; existing > 0; existing -= 1) {
    try {
      lstatSync(join(realRoot, ...segments.slice(0, existing)));
      break;
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
    }
  }
  if (existing === segments.length) {
    const final = lstatSync(join(realRoot, ...segments));
    if (!final.isFile())
      throw new ContainmentError(`${JSON.stringify(requested)} exists and is not a regular file`);
    const parent = containedReal(realRoot, join(realRoot, ...segments.slice(0, -1)), requested);
    return { realRoot, ancestor: parent, missing: [], name: segments.at(-1) };
  }
  const ancestor = containedReal(
    realRoot,
    join(realRoot, ...segments.slice(0, existing)),
    requested,
  );
  if (!statSync(ancestor).isDirectory())
    throw new ContainmentError(`${JSON.stringify(requested)} passes through a file`);
  return {
    realRoot,
    ancestor,
    missing: segments.slice(existing, -1),
    name: segments.at(-1),
  };
}

/** Create the missing directories one level at a time, each confirmed a real directory. */
function makeParent(realRoot, ancestor, missing, requested) {
  let parent = ancestor;
  for (const segment of missing) {
    const next = join(parent, segment);
    try {
      mkdirSync(next);
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
    }
    if (!lstatSync(next).isDirectory())
      throw new ContainmentError(`${JSON.stringify(requested)} passes through a non-directory`);
    parent = containedReal(realRoot, next, requested);
  }
  return parent;
}

/**
 * Write a file inside the root. With `exclusive`, an existing file is left untouched and the
 * result says so. Returns the real path written and whether it was written.
 */
export function writeFileInside(root, requested, data, { exclusive = false } = {}) {
  const { realRoot, ancestor, missing, name } = resolveWriteTargetInside(root, requested);
  const parent = makeParent(realRoot, ancestor, missing, requested);
  const target = join(parent, name);
  let fd;
  try {
    fd = openSync(
      target,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_NOFOLLOW |
        constants.O_NONBLOCK |
        (exclusive ? constants.O_EXCL : 0),
      0o644,
    );
  } catch (cause) {
    if (exclusive && cause?.code === "EEXIST") return { path: target, written: false };
    if (cause?.code === "ELOOP")
      throw new ContainmentError(`${JSON.stringify(requested)} is a symlink`);
    throw cause;
  }
  try {
    const opened = confirmDescriptor(fd, realRoot, target, requested);
    if (!opened.isFile())
      throw new ContainmentError(`${JSON.stringify(requested)} is not a regular file`);
    if (opened.nlink > 1)
      throw new ContainmentError(`${JSON.stringify(requested)} has another hard link`);
    ftruncateSync(fd, 0);
    writeFileSync(fd, data);
  } finally {
    closeSync(fd);
  }
  return { path: target, written: true };
}

/** Remove a regular file inside the root; absent is not an error. See the residual above. */
export function removeFileInside(root, requested) {
  const segments = relativeSegments(requested);
  if (segments.length === 0) throw new ContainmentError("the root itself is not a file");
  const realRoot = realpath(root);
  let parent;
  try {
    parent = containedReal(realRoot, join(realRoot, ...segments.slice(0, -1)), requested);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  const target = join(parent, segments.at(-1));
  let status;
  try {
    status = lstatSync(target);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  if (!status.isFile() || status.nlink > 1)
    throw new ContainmentError(`${JSON.stringify(requested)} is not a singly linked regular file`);
  if (realpath(parent) !== parent)
    throw new ContainmentError(`${JSON.stringify(requested)} changed while it was removed`);
  unlinkSync(target);
  return true;
}
