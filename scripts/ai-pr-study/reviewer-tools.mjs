/**
 * The adjudication reviewer's tools over the clone at the pull request's head. Every path the
 * model names goes through the checkout containment helper at the access itself; a path that
 * leaves the clone, directly or through a symlink, reads as "outside the repository".
 */
import {
  ContainmentError,
  listDirectoryInside,
  readFileInside,
  relativeSegments,
} from "./containment.mjs";

// What the reviewer may read in one call and in one row. The model's context is finite and
// the server drops a request that overflows it, which read as "fetch failed" on the rows
// whose reviewer opened several large files; the bounds keep every row inside it.
export const readLimit = 16_000;
export const readBudget = 80_000;

const hidden = new Set(["node_modules", ".git", ".venv"]);

/** The `list` tool: one directory of the clone, directories marked with a trailing slash. */
export function listDirectory(root, path) {
  try {
    return listDirectoryInside(root, path)
      .filter((entry) => !hidden.has(entry.name))
      .map((entry) => (entry.directory ? `${entry.name}/` : entry.name))
      .join("\n");
  } catch (cause) {
    if (cause instanceof ContainmentError) return "outside the repository";
    return `cannot list: ${cause.message}`;
  }
}

/**
 * The `read` tool: one file of the clone, refusing the test files the pull request changed
 * whether they are named directly, through `./` or doubled slashes, or through a symlink that
 * resolves to one, and bounded per call and per row.
 */
export function readFile(root, path, forbidden, budget) {
  let requested;
  try {
    requested = relativeSegments(path).join("/");
  } catch {
    return "outside the repository";
  }
  const refusal = "refused: this is a test file the pull request changed";
  if (forbidden.has(requested)) return refusal;
  if (budget.used >= readBudget)
    return "refused: the read budget for this review is spent; finish with what you have read";
  let read;
  try {
    read = readFileInside(root, requested);
  } catch (cause) {
    if (cause instanceof ContainmentError) return "outside the repository";
    return `cannot read: ${cause.message}`;
  }
  if (forbidden.has(read.relative)) return refusal;
  const bytes = read.contents;
  const allowed = Math.min(readLimit, readBudget - budget.used);
  budget.used += Math.min(bytes.length, allowed);
  return bytes.length > allowed
    ? `${bytes.slice(0, allowed)}\n[truncated at ${allowed} characters]`
    : bytes;
}

/**
 * Why a `finish` call's check path cannot be accepted, or null with the normalised path. The
 * path must stay inside the clone, must not be a file the pull request changed, and must be one
 * plain file path rather than a list.
 */
export function checkPathRefusal(path, forbidden, changedFiles) {
  let normalised;
  try {
    normalised = relativeSegments(path).join("/");
  } catch {
    return {
      refusal: `refused: ${JSON.stringify(path)} is not a path inside the repository; name a repository-relative file path with no leading / and no .. and call finish again`,
    };
  }
  if (forbidden.has(normalised) || changedFiles.includes(normalised))
    // The check would overwrite a file the pull request changed; that is the author's
    // file, not the reviewer's. One more chance to name a fresh path, within the step cap.
    return {
      refusal: `refused: ${normalised} is a file the pull request changed; write the check to a new path (for example a new file beside the tests) and call finish again`,
    };
  if (!/^[\w.@+-]+(?:\/[\w.@+-]+)*$/.test(normalised))
    // One file's path, not a list: thesvg#1159's reviewer named the three files its
    // check greps, space-joined, and the check was then written under that one name.
    return {
      refusal: `refused: ${JSON.stringify(path)} is not one plain repository-relative file path; name the single new file the check is written to (letters, digits, and . _ - @ + only, / between directories) and call finish again`,
    };
  return { refusal: null, path: normalised };
}
