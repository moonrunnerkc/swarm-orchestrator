/**
 * What owns the `swarm` command, and what to do when the answer is wrong.
 *
 * The failure this exists for happens twice for the same reason and neither time is the tool's
 * own error to catch. A development checkout is linked into the global prefix with `npm link`,
 * and from then on the link owns the command: a registry install either fails outright, because
 * npm renames the existing entry aside and cannot rename a symlinked directory, or succeeds and
 * is shadowed by a stale bin that still points at the checkout. Both were seen on real machines,
 * on two operating systems, months apart, and both presented as something else: an `ENOTDIR`
 * during install, and a `swarm` with no `select` command.
 *
 * Nothing in this package can intercept that at install time, because npm fails before any
 * script of ours would run. What it can do is answer the question afterwards, and offer to fix
 * it rather than describing it.
 */

export interface GlobalEntry {
  readonly path: string;
  /** True when the global package directory is a symlink, which is what `npm link` leaves. */
  readonly isLink: boolean;
  /** Where the link points, resolved. Null when it is a real directory or is missing. */
  readonly target: string | null;
  /** The version at that path, or null when nothing readable is there. */
  readonly version: string | null;
}

export interface InstallSnapshot {
  /** The version of the package this process is running from. */
  readonly runningVersion: string;
  /** Resolved directory this process is running from. */
  readonly runningFrom: string;
  /** `npm root -g`, or null when npm could not be asked. */
  readonly globalRoot: string | null;
  /** The package under the global root, or null when there is none. */
  readonly globalEntry: GlobalEntry | null;
  /** Every `swarm` executable found on PATH, in PATH order. */
  readonly binsOnPath: readonly string[];
  /** What the registry serves, or null when it was not asked or could not be reached. */
  readonly publishedVersion: string | null;
}

export type FindingSeverity = "broken" | "worth-knowing" | "healthy";

export interface Finding {
  readonly severity: FindingSeverity;
  readonly summary: string;
  readonly detail: string;
  /** Commands that resolve it, in order. Empty when there is nothing to run. */
  readonly remedy: readonly string[];
}

const reinstall = ["npm rm -g swarm-orchestrator", "npm install -g swarm-orchestrator"] as const;

/**
 * Findings worst first. A healthy install produces exactly one, saying so, because an empty
 * report reads as a check that did not run.
 */
export function diagnose(snapshot: InstallSnapshot): readonly Finding[] {
  const findings: Finding[] = [];
  const entry = snapshot.globalEntry;

  if (entry?.isLink) {
    findings.push({
      severity: "broken",
      summary: "the global swarm is a development link, not an install",
      detail:
        `${entry.path} is a symlink to ${entry.target ?? "somewhere unreadable"}` +
        `${entry.version === null ? "" : `, which is version ${entry.version}`}. ` +
        "A link owns the command until it is removed, so an install of the published package " +
        "is either refused or shadowed by it.",
      remedy: [...reinstall],
    });
  }

  if (snapshot.binsOnPath.length > 1) {
    findings.push({
      severity: "broken",
      summary: `${snapshot.binsOnPath.length} swarm executables are on PATH`,
      detail:
        `the first one wins: ${snapshot.binsOnPath.join(", ")}. ` +
        "Whichever of them is not the one you want will keep answering until it is gone.",
      remedy: [],
    });
  }

  if (entry === null && snapshot.binsOnPath.length > 0) {
    findings.push({
      severity: "broken",
      summary: "the swarm command points at a package that is not there",
      detail:
        `${snapshot.binsOnPath.join(", ")} is on PATH and nothing is installed under ` +
        `${snapshot.globalRoot ?? "the global root"}. A failed install can leave this behind: ` +
        "it removes the package and not the executable.",
      remedy: [...reinstall],
    });
  }

  if (
    snapshot.publishedVersion !== null &&
    snapshot.publishedVersion !== snapshot.runningVersion &&
    isOlder(snapshot.runningVersion, snapshot.publishedVersion)
  ) {
    findings.push({
      severity: "worth-knowing",
      summary: `running ${snapshot.runningVersion}, the registry serves ${snapshot.publishedVersion}`,
      detail: `this process is running from ${snapshot.runningFrom}.`,
      remedy: ["npm install -g swarm-orchestrator"],
    });
  }

  if (findings.length === 0) {
    findings.push({
      severity: "healthy",
      summary: `swarm ${snapshot.runningVersion} owns the command`,
      detail:
        `running from ${snapshot.runningFrom}` +
        `${snapshot.binsOnPath.length === 1 ? `, reached through ${snapshot.binsOnPath[0]}` : ""}.`,
      remedy: [],
    });
  }

  return findings;
}

/** Every remedy across the findings, deduplicated, in the order they were reported. */
export function remediesFor(findings: readonly Finding[]): readonly string[] {
  const ordered: string[] = [];
  for (const finding of findings) {
    for (const command of finding.remedy) {
      if (!ordered.includes(command)) {
        ordered.push(command);
      }
    }
  }
  return ordered;
}

/**
 * Numeric compare on the release part only. A prerelease is treated as its release, which is
 * the wrong answer for `1.0.0-rc.1` against `1.0.0` and is deliberately not worth a parser
 * here: the report says which two versions it compared, so a reader can disagree with it.
 */
function isOlder(running: string, published: string): boolean {
  const parts = (version: string) =>
    version
      .split("-")[0]
      ?.split(".")
      .map((piece) => Number.parseInt(piece, 10)) ?? [];
  const left = parts(running);
  const right = parts(published);

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return false;
    }
    if (a !== b) {
      return a < b;
    }
  }
  return false;
}
