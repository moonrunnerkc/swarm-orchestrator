/** Help, typo suggestions and packaged behavioral smoke checks share these command contracts. */
export const commandDefinitions = [
  {
    name: "init",
    syntax: "init [--workspace <dir>]",
    description: "write swarm.toml from the project's scripts",
    smoke: { args: [], exits: [0], output: "swarm\\.toml|already exists" },
  },
  {
    name: "gates",
    syntax: "gates [--workspace <dir>] [--base <ref>]",
    description: "run the gates without a model",
    smoke: { args: [], exits: [0, 1], output: "bundle|gates|ratchet" },
  },
  {
    name: "select",
    syntax: "select [--shortlist <file|url|bundled>]",
    description: "probe this machine and recommend a model",
    smoke: { args: ["--shortlist", "bundled"], exits: [0, 1], output: "memory|RAM|model|hardware" },
  },
  {
    name: "calibrate",
    syntax: "calibrate [--models <a,b>] [--repeats <n>]",
    description: "measure models on the golden set",
    smoke: {
      args: ["--repeats", "0"],
      exits: [1],
      output: "--repeats.*(?:positive|at least|integer|1)|repeats",
    },
  },
  {
    name: "doctor",
    syntax: "doctor [--fix] [--offline]",
    description: "inspect the installed command and prerequisites",
    smoke: { args: ["--offline"], exits: [0, 1], output: "swarm|Node|node|install" },
  },
  {
    name: "routing",
    syntax: "routing",
    description: "inspect the measured routing history",
    smoke: { args: [], exits: [0], output: "reward|routing|record|calibrat" },
  },
  {
    name: "parallel",
    syntax: "parallel --tasks <file> | --goal <text>",
    description: "run optional workers and merge their work",
    smoke: {
      args: ["--tasks", "absent-tasks.txt"],
      exits: [1],
      output: "absent-tasks|no model|model.*(?:required|configured)|policy",
    },
  },
  {
    name: "review",
    syntax: "review <bundle directory>",
    description: "review a run's evidence",
    smoke: { args: ["absent-bundle"], exits: [1], output: "absent-bundle|manifest" },
  },
  {
    name: "verify",
    syntax: "verify <bundle directory> [--signer <fp>]",
    description: "check integrity and an independently expected signer",
    smoke: { args: ["absent-bundle"], exits: [2], output: "integrity:.*unverified" },
  },
  {
    name: "gc",
    syntax: "gc [--older-than 30d] [--remove]",
    description: "inspect retained evidence, remove only when requested",
    smoke: { args: [], exits: [0], output: "session|remove|retai|eligible" },
  },
  {
    name: "ci",
    syntax: "ci --patch <file> [--base <ref>] [--json]",
    description: "verify a patch independently",
    smoke: { args: ["--patch", "absent.diff"], exits: [1], output: "absent\\.diff" },
  },
  {
    name: "list-runs",
    syntax: "list-runs",
    description: "list this machine's recorded runs",
    smoke: { args: [], exits: [0], output: "no runs|running|finished|aborted|interrupted" },
  },
  {
    name: "inspect",
    syntax: "inspect <run-id> [--json]",
    description: "inspect recorded work and unfinished steps",
    smoke: { args: ["no-such-run"], exits: [2], output: "no run named no-such-run" },
  },
  {
    name: "resume",
    syntax: "resume <run-id>",
    description: "continue verified history within the remaining budget",
    smoke: { args: ["no-such-run"], exits: [1], output: "no-such-run" },
  },
  {
    name: "retry-step",
    syntax: "retry-step <run-id> <step-id>",
    description: "continue a safe unfinished step",
    smoke: {
      args: ["no-such-run", "no-such-step"],
      exits: [2],
      output: "no step named no-such-step",
    },
  },
  {
    name: "abort",
    syntax: "abort <run-id>",
    description: "request cancellation of a running task",
    smoke: { args: ["no-such-run"], exits: [2], output: "no run named no-such-run" },
  },
  {
    name: "repair",
    syntax: "repair <run-id>",
    description: "reconcile abandoned runtime resources and leases",
    smoke: { args: ["no-such-run"], exits: [1], output: "no-such-run" },
  },
  {
    name: "replay",
    syntax: "replay <bundle directory>",
    description: "read recorded evidence without running it",
    smoke: { args: ["absent-bundle"], exits: [1], output: "absent-bundle|manifest" },
  },
  {
    name: "help",
    syntax: "help",
    description: "show commands and options",
    smoke: { args: [], exits: [0], output: "swarm ci" },
  },
] as const;
export const commandHelpLines = commandDefinitions.map(
  (command) => `  swarm ${command.syntax.padEnd(49)} ${command.description}`,
);
