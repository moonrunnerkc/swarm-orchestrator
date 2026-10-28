export interface CommandDefinition {
  readonly name: string;
  readonly syntax: string;
  readonly description: string;
  /** What the packaged CLI must do when the command is run with these arguments. */
  readonly smoke: {
    readonly args: readonly string[];
    readonly exits: readonly number[];
    /** A pattern the combined output must match. */
    readonly output: string;
  };
  /**
   * `none` where the command runs with no provider key and no local backend, which
   * src/cli-verify-only.test.ts holds by running it that way. Absent where nothing establishes
   * that either way, which is not the same as needing one.
   */
  readonly model?: "none";
}

/** Help, typo suggestions and packaged behavioral smoke checks share these command contracts. */
export const commandDefinitions: readonly CommandDefinition[] = [
  {
    name: "init",
    syntax: "init [--workspace <dir>] [--package <dir>] [--list-packages]",
    description: "configure declared Node/Python checks without installing dependencies",
    smoke: { args: [], exits: [0], output: "swarm\\.toml|already exists" },
  },
  {
    name: "doctor",
    syntax: "doctor [--fix] [--offline]",
    description: "inspect the installed command and prerequisites",
    smoke: { args: ["--offline"], exits: [0, 1], output: "swarm|Node|node|install" },
  },
  {
    name: "verify",
    syntax: "verify <bundle directory> [--signer <fp>]",
    description: "check integrity and an independently expected signer",
    smoke: { args: ["absent-bundle"], exits: [2], output: "integrity:.*unverified" },
    model: "none",
  },
  {
    name: "ci",
    syntax: "ci --patch <file> | --branch <ref> | --pr <PR> [--base <ref>] [--json]",
    description: "verify a patch independently",
    smoke: { args: ["--patch", "absent.diff"], exits: [1], output: "absent\\.diff" },
    model: "none",
  },
];
