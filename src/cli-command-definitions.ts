import {
  type CommandDefinition,
  UsageError,
  usageFor as usageOf,
  commandDefinitions as verifierDefinitions,
} from "swarm-verify/cli";

/**
 * The subcommands, in the order help lists them. Help reads this, and so does the caps check
 * (scripts/check-caps.mjs), by a path it computes.
 * @public
 */
export const commandDefinitions: readonly CommandDefinition[] = [
  {
    name: "run",
    syntax:
      'run "<task>" [--model <name>|auto] [--endpoint <url>] [--context <tokens>] [--max-steps <n>] [--max-tokens <n>] [--turn-tokens <n>] [--max-minutes <n>] [--approve ask|auto] [--host [--linked-dependencies]] [--no-apply] [--authorize-behavior-change] [--review] [--profile <name>|--no-record] [--require "<words of the task>"]... [--accept [R<n>=|keep=]<path>]... [--accept-cmd [R<n>=|keep=]<command>]... [--accept-authored|--review-checks|--write-checks <dir>] [--security <obligation>]... [--no-security <obligation>]... [--security-check <file>]',
    description:
      "make the change, check each requirement, and report what is complete and what is not",
  },
  // The verifier's own commands, described where they are implemented.
  ...verifierDefinitions
    .filter((command) => ["verify", "init", "ci"].includes(command.name))
    .map((command) =>
      command.name !== "init"
        ? command
        : {
            ...command,
            syntax: `${command.syntax}\n  swarm init --learn [<file or directory>...] | --approve <proposal> [--global] | --set <rule>=<value> [--global] | --forget <rule> [--global]`,
            description: `${command.description}; or propose coding conventions from examples and approve, correct or remove them (nothing is learned without --approve or --set)`,
          },
    ),
  {
    name: "doctor",
    syntax: "doctor [--fix] [--offline] [--models [--context <tokens>]] [--conventions]",
    description:
      "report what owns the installed command, which local models can run the agent, or the approved conventions in effect here",
  },
];

// One class for both programs: the shared dispatcher reads a usage error by it.
export { UsageError };

export const usageFor = (program: string) => usageOf(program, commandDefinitions);
