export interface CommandDefinition {
  readonly name: string;
  readonly syntax: string;
  readonly description: string;
  /** Whether the standalone swarm-verify binary carries it: true for everything but the agent. */
  readonly verifier: boolean;
}

/** The subcommands, in the order help lists them. Help and the caps check both read this. */
export const commandDefinitions: readonly CommandDefinition[] = [
  {
    name: "run",
    syntax:
      'run "<task>" [--endpoint <url>] [--model <name>] [--max-steps <n>] [--max-tokens <n>] [--approve ask|auto]',
    description: "work on the task with one bash tool until the verifier passes the working tree",
    verifier: false,
  },
  {
    name: "verify",
    syntax: "verify [--base <ref>] [--patch <file> | --range <a..b>] [--out <dir>] [--sigstore]",
    description: "rerun the declared checks on a change in a clean checkout and sign the verdict",
    verifier: true,
  },
  {
    name: "init",
    syntax: "init [--seal <glob>]",
    description: "write swarm.toml from the project's manifests, or seal held-out checks",
    verifier: true,
  },
  {
    name: "ci",
    syntax: "ci [--base <ref>] [--out <dir>] [--sigstore]",
    description: "verify HEAD's change against the pull request's base branch",
    verifier: true,
  },
  {
    name: "doctor",
    syntax: "doctor [--fix] [--offline]",
    description: "report what owns the installed command",
    verifier: false,
  },
];

/** A command line this program cannot read: exit code 2, with the usage. */
export class UsageError extends Error {
  constructor(problem: string) {
    super(problem);
    this.name = "UsageError";
  }
}

export function usageFor(program: string, verifierOnly: boolean): string {
  const shown = commandDefinitions.filter((command) => command.verifier || !verifierOnly);
  return [
    `${program} <command> [options]`,
    "",
    ...shown.flatMap((command) => [
      `  ${program} ${command.syntax}`,
      `      ${command.description}`,
    ]),
    "",
    "Every command takes --workspace <dir> where it reads a repository; the default is here.",
  ].join("\n");
}
