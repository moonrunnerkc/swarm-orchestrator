/**
 * The command an installed hook calls to reach this verifier later.
 *
 * An installer writes a command that outlives the process that wrote it. Run as `npx
 * swarm-verify ...`, this process's own entry sits in npm's npx cache, which npm may clear or
 * replace at any time; a hook pointing there breaks silently when it does. From that cache the
 * installer writes the pinned npx invocation instead, which resolves the same version again. An
 * entry anywhere else (a project or global install, a checkout) is stable, and is called
 * directly with this Node.
 */
export function installedLauncher(input: {
  readonly execPath: string;
  readonly entry: string;
  readonly version: string;
}): string {
  if (input.entry.split(/[\\/]/).includes("_npx")) return `npx --yes swarm-verify@${input.version}`;
  const quote = (value: string) =>
    /^[A-Za-z0-9_./-]+$/.test(value) ? value : JSON.stringify(value);
  return `${quote(input.execPath)} ${quote(input.entry)}`;
}
