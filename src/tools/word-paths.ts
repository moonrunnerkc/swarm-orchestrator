/** A word whose colon is part of a scheme names a resource rather than a file after the colon. */
const namesAScheme = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Every path one word of a command could open.
 *
 * A word is not a path, and a program is free to read more than one out of it. These shapes got
 * past a check that took the word whole, each found by attacking it:
 *
 *   - `git show HEAD:.env` prints a credential file, and `HEAD:.env` resolves to a path inside
 *     the workspace that does not exist and matches no pattern. A revision and a path share one
 *     word, so what is after the colon is offered as well.
 *   - `sed -n 'w /home/dev/.ssh/authorized_keys'` writes outside the workspace, and the operand
 *     is the whole script. A program can read a path out of the middle of a quoted word, so for
 *     a program with no table in argument-grammars.ts the whitespace-separated pieces are offered.
 *   - `git --git-dir=/elsewhere/.git log` reads outside the workspace through an option's value,
 *     so what is after an equals sign is offered as well.
 *
 * Offered rather than decided: each candidate goes through the same guard the word does, so being
 * wrong costs a denial or a confirmation on a word that was not a path, which is the guard's own
 * answer to a string it cannot read. A scheme is left alone because a URL is ordinary in these
 * commands and `//host/path` would resolve to an absolute path outside any workspace.
 */
export function pathsAWordCouldOpen(word: string): readonly string[] {
  // An empty word names no file, so it is not a path candidate. `sed -i '' 's/a/b/' file` is the
  // in-place form every macOS invocation uses, and the quoted empty argument reached a check whose
  // whole subject is paths and came back "the path is empty": a real command refused for a reason
  // that was not about it.
  if (word.length === 0) {
    return [];
  }
  // A word holding a line break is a script, never one file name: `node -e "<several lines>"`
  // was refused as a path with a control character, and the probe it carried was written to
  // a file instead, at the cost of a step. Its pieces are still offered, so a path inside the
  // script is still checked.
  const candidates = new Set<string>(/[\r\n]/.test(word) ? [] : [word]);
  for (const piece of word.split(/[\s]+/)) {
    // A piece with no letter or digit (`/`, `//`, `=>`, `{`) is an operator or punctuation
    // inside a script, not a file the script opens: a bare `/` in a probe resolved to the
    // filesystem root and refused the whole command. The word itself is still offered whole.
    if (piece.length > 0 && /[\p{L}\p{N}]/u.test(piece)) {
      candidates.add(piece);
    }
  }
  for (const candidate of [...candidates]) {
    const equals = candidate.indexOf("=");
    const value = candidate.slice(equals + 1);
    if (equals > 0 && value.length > 0 && !namesAScheme.test(value)) {
      candidates.add(value);
    }
  }
  for (const candidate of [...candidates]) {
    const colon = candidate.indexOf(":");
    if (colon === -1 || namesAScheme.test(candidate)) {
      continue;
    }
    const after = candidate.slice(colon + 1);
    if (after.length > 0) {
      candidates.add(after);
    }
  }
  return [...candidates];
}
