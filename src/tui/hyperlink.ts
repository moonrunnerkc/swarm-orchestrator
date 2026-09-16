/**
 * OSC 8 hyperlinks: a path a person clicks rather than copies. The sequence is printed only
 * where the terminal is known to understand it, read off the variables terminals set, because
 * a terminal that does not understand it shows the bytes, which is worse than a plain path.
 */
const escapeCharacter = String.fromCharCode(27);
const bell = String.fromCharCode(7);

/** TERM_PROGRAM values of terminals that document OSC 8 support. */
const linkingPrograms: ReadonlySet<string> = new Set([
  "iTerm.app",
  "vscode",
  "WezTerm",
  "ghostty",
  "Hyper",
]);

/** VTE-based terminals gained OSC 8 in 0.50, which VTE_VERSION reports as 5000. */
const firstLinkingVte = 5000;

export function terminalSupportsHyperlinks(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (env.TERM === "dumb") {
    return false;
  }
  if (env.TERM_PROGRAM !== undefined && linkingPrograms.has(env.TERM_PROGRAM)) {
    return true;
  }
  if (env.KITTY_WINDOW_ID !== undefined || env.WT_SESSION !== undefined) {
    return true;
  }
  const vte = Number(env.VTE_VERSION);
  return Number.isFinite(vte) && vte >= firstLinkingVte;
}

/** An absolute path as a file URL, each segment percent-encoded. */
export function fileUrl(path: string): string {
  return `file://${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function hyperlink(text: string, url: string): string {
  return `${escapeCharacter}]8;;${url}${bell}${text}${escapeCharacter}]8;;${bell}`;
}
