import { commandDefinitions as verifierDefinitions } from "swarm-verify/cli";

export interface CommandDefinition {
  readonly name: string;
  readonly syntax: string;
  readonly description: string;
}

/** The subcommands, in the order help lists them. Help and the caps check both read this. */
export const commandDefinitions: readonly CommandDefinition[] = [
  {
    name: "run",
    syntax:
      'run "<task>" [--model <name>|auto] [--endpoint <url>] [--context <tokens>] [--max-steps <n>] [--max-tokens <n>] [--turn-tokens <n>] [--max-minutes <n>] [--approve ask|auto] [--host [--linked-dependencies]] [--no-apply] [--authorize-behavior-change] [--review]',
    description:
      "make the change, check each requirement, and report what is complete and what is not",
  },
  // The verifier's own commands, described where they are implemented.
  ...verifierDefinitions.filter((command) => ["verify", "init", "ci"].includes(command.name)),
  {
    name: "doctor",
    syntax: "doctor [--fix] [--offline] [--models [--context <tokens>]]",
    description: "report what owns the installed command, or which local models can run the agent",
  },
];

/** A command line this program cannot read: exit code 2, with the usage. */
export class UsageError extends Error {
  constructor(problem: string) {
    super(problem);
    this.name = "UsageError";
  }
}

export function usageFor(program: string): string {
  return [
    `${program} <command> [options]`,
    "",
    ...commandDefinitions.flatMap((command) => [
      `  ${program} ${command.syntax}`,
      `      ${command.description}`,
    ]),
    "",
    "Every command takes --workspace <dir> where it reads a repository; the default is here.",
  ].join("\n");
}
