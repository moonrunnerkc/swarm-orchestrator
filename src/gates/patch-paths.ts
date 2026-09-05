/**
 * The paths a unified diff touches, read from its `diff --git` headers.
 *
 * Read from the header rather than from the `---`/`+++` lines because those carry `/dev/null`
 * for a creation or a deletion, and a path check that skipped those would skip exactly the
 * cases where a patch adds a file somewhere it was told not to.
 */
export function pathsInPatch(patch: string): readonly string[] {
  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header !== null) {
      paths.add(header[1] ?? "");
      paths.add(header[2] ?? "");
      continue;
    }
    const target = /^\+\+\+ b\/(.+)$/.exec(line);
    if (target !== null && target[1] !== "/dev/null") {
      paths.add(target[1] ?? "");
    }
  }
  paths.delete("");
  return [...paths].sort();
}
