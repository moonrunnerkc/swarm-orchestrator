/**
 * What an npm install actually failed for, out of everything npm printed about it.
 *
 * npm puts the reason first and its usage banner last, so a record that keeps the tail keeps the
 * banner: fifteen mined candidates were dropped carrying `Run "npm help ci" for more info`, which
 * names nothing anybody can act on. The two that matter on this corpus are `EUSAGE`, a lockfile out
 * of sync with its manifest at that commit, and `ERESOLVE`, a dependency tree npm will not build.
 * Both are properties of the repository's history and neither is worth retrying, which is only
 * knowable if the record says which one it was.
 */
export function npmFailureReason(stderr: string): string {
  const spoken = stderr
    .split("\n")
    .map((line) => line.replace(/^npm (error|ERR!)\s?/, "").trim())
    .filter((line) => line.length > 0);
  if (spoken.length === 0) {
    return "npm wrote no output, so nothing here says why it failed";
  }

  // Everything from the banner on is npm explaining its own command line rather than the failure.
  const banner = spoken.findIndex((line) => line === "Usage:" || /^Run "npm help/.test(line));
  const explaining = (banner === -1 ? spoken : spoken.slice(0, banner)).filter(
    (line) => !/^A complete log of this run/.test(line),
  );
  return (explaining.length === 0 ? spoken : explaining).slice(0, 3).join(" ").slice(0, 300);
}
