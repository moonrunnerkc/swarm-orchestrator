import { resolve } from "node:path";

/**
 * The three commands that verify without a model, parsed here so the standalone verifier and
 * the full CLI read them identically: one parser, two entry points, no drift. Everything
 * model-shaped stays in cli-options.ts, which is what keeps this module free of the provider,
 * worker and screen modules the standalone package must not carry.
 */

/** Runs the gates over a workspace and reports, with no model and no retries. */
export interface GatesCommand {
  readonly isolation?: string | null;
  readonly packages?: readonly string[];
  readonly command: "gates";
  readonly workspace: string;
  readonly baseRef: string;
  readonly bundleDirectory: string | null;
  /**
   * Files the caller authorised, or null for none. With none the file-set gate reports the
   * observed scope and abstains, because nothing authorised anything: this command has no
   * planner, and failing for a declaration nobody was there to make rejects every changed
   * repository the command exists to check.
   */
  readonly allowedFiles: readonly string[] | null;
}

/**
 * Verifies a patch somebody else produced, without trusting the tree it came from: a fresh
 * checkout of the base, the patch applied there, and the checks run in that checkout.
 */
export interface CiCommand {
  readonly isolation?: string | null;
  readonly acceptanceContract?: string;
  readonly goalContract?: string;
  /** Whether the requirement checks are challenged: off (the default), report, or required. */
  readonly challenges?: "off" | "report" | "required";
  readonly summaryFile?: string;
  readonly requireIsolation?: boolean;
  readonly bundleDirectory?: string;
  readonly packages?: readonly string[];
  readonly command: "ci";
  readonly patchFile?: string;
  readonly branch?: string;
  readonly pr?: string;
  readonly exactBase?: boolean;
  /**
   * Install the fresh checkout's dependencies from its lockfile before checking. Off by default:
   * installing runs whatever scripts the registry serves, which is a decision rather than a
   * default, and a run that cannot measure says so instead of installing on the reader's behalf.
   */
  readonly installDependencies: boolean;
  /**
   * Judge the oracle and skip the repository's own checks.
   *
   * For a second judgement of the same patch by a different oracle: the suite answers the same way
   * both times, and running it again is the same minutes spent twice. `regression` then reads
   * `unmeasured` and nothing is verified, because a run that did not measure the suite has not
   * established that the patch broke nothing.
   */
  readonly oracleOnly: boolean;
  /**
   * A trusted check that says whether the task was done, run after the repository's own suite.
   * Absent leaves the task unjudged, which is the honest answer: a suite tests the behaviour a
   * project already had, and a task adds behaviour it did not.
   */
  readonly taskOracle: string | null;
  /**
   * A stream some other agent emitted, replayed onto the chain beside the patch. Null verifies
   * the patch alone, which is the minimum an external producer has to hand over.
   */
  readonly agentStream: {
    readonly path: string;
    readonly format: "generic" | "claude-code";
  } | null;
  readonly workspace: string;
  readonly baseRef: string;
  readonly immutablePaths: readonly string[];
  readonly json: boolean;
}

/**
 * Checks a bundle, and separately checks who signed it. The two are different questions: a
 * bundle carries the public key that signed it, so its own signature check says the bundle is
 * unchanged since it was written and nothing about who wrote it. The expected signers come
 * from here, which is to say from outside the bundle, which is the only place they can come
 * from and mean anything.
 */
export interface VerifyCommand {
  readonly command: "verify";
  readonly bundleDirectory: string;
  /** Key fingerprints the reader expects. Empty means consistency only, never authenticity. */
  readonly expectedSigners: readonly string[];
}

/**
 * The first-run command: discover what the project declares, run it unattended, and report
 * what that establishes and what it leaves unmeasured. No configuration file, no model.
 */
export interface CheckCommand {
  readonly command: "check";
  readonly workspace: string;
  readonly baseRef: string;
  readonly packages?: readonly string[];
  readonly bundleDirectory: string | null;
  /** Print the plan and run nothing. */
  readonly explain: boolean;
  readonly json: boolean;
}

/** Checks a signed verdict document against the evidence beside it and an expected signer. */
export interface VerdictCommand {
  readonly command: "verdict";
  readonly verdictPath: string;
  readonly evidenceDirectory: string | null;
  readonly repository: string | null;
  readonly signerWorkflow: string | null;
}

/** The Claude Code hook: install into or remove from a settings file, or run one event. */
export interface HookCommand {
  readonly command: "hook";
  readonly step: "install" | "uninstall" | "run" | "help";
  readonly settingsPath: string | null;
  readonly scope: "project" | "user";
  readonly workspace: string;
}

/** The local MCP server over stdio, confined to a root. */
export interface McpCommand {
  readonly command: "mcp";
  readonly root: string;
  readonly describe: boolean;
}

/** Verify the staged tree, or install or remove the git hook that does. */
export interface PreCommitCommand {
  readonly command: "pre-commit";
  readonly step: "run" | "install" | "uninstall";
  readonly workspace: string;
  readonly json: boolean;
}

/** One step of the GitHub Action, driven by the runner's environment rather than by flags. */
export interface ActionCommand {
  readonly command: "action";
  readonly step: "verify" | "comment" | "retain";
}

export type VerifyOnlyCommand =
  | VerifyCommand
  | CiCommand
  | GatesCommand
  | CheckCommand
  | VerdictCommand
  | HookCommand
  | McpCommand
  | PreCommitCommand
  | ActionCommand;

export class InvalidCommandLineError extends Error {
  constructor(problem: string, usageText: string) {
    // The usage text rather than a second copy of it. A hand-maintained list here went stale
    // twice over: it never learned about `init` or `verify`, so the one thing a reader sees
    // when they get a command wrong was the list least likely to be right.
    super(`${problem}.\n\n${usageText}`);
    this.name = "InvalidCommandLineError";
  }
}

/** The flags that are their own value. Everything else takes the word after it. */
const switchFlags = new Set([
  "help",
  "explain",
  "describe",
  "version",
  "json",
  "remove",
  "install",
  "oracle-only",
  "require-isolation",
  "list-packages",
  "fix",
  "offline",
  "no-tui",
  "details",
  "color",
  "no-color",
  "open-evidence",
  "no-open-evidence",
]);

export const defaultBaseRef = "HEAD";

export interface CommandLineContext {
  readonly currentDirectory: string;
  /** What an error shows under the problem, so the reader sees the list this build has. */
  readonly usage: string;
}

export interface CommandLineWords {
  readonly words: readonly string[];
  readonly flags: ReadonlyMap<string, string>;
}

/** Words and flags, with a switch never eating the word after it. */
export function tokenizeCommandLine(
  argv: readonly string[],
  context: CommandLineContext,
): CommandLineWords {
  const words: string[] = [];
  const flags = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) {
      words.push(argument);
      continue;
    }
    const name = argument.slice(2);
    // A switch takes no value, so it must not eat the word after it: `--no-tui "fix the bug"`
    // would otherwise consume the task and leave nothing to do.
    if (switchFlags.has(name)) {
      flags.set(name, "");
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new InvalidCommandLineError(`${argument} needs a value`, context.usage);
    }
    flags.set(name, name === "package" && flags.has(name) ? `${flags.get(name)}\0${value}` : value);
    index += 1;
  }
  return { words, flags };
}

function commaList(raw: string | undefined): readonly string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** One of the three, or null where the first word is some other command. */
export function parseVerifyOnlyCommand(
  line: CommandLineWords,
  context: CommandLineContext,
): VerifyOnlyCommand | null {
  const { words, flags } = line;
  const invalid = (problem: string) => new InvalidCommandLineError(problem, context.usage);

  if (words[0] === "ci") {
    const patchFile = flags.get("patch");
    const branch = flags.get("branch");
    const pr = flags.get("pr");
    const inputs = [patchFile, branch, pr].filter((value) => value !== undefined);
    if (inputs.length !== 1 || inputs.some((value) => value.trim().length === 0)) {
      throw invalid(
        "ci needs exactly one of --patch <file>, --branch <ref>, or --pr <OWNER/REPO#NUMBER>",
      );
    }
    if (flags.has("contract") && flags.has("goal-contract"))
      throw invalid("select strict --contract or ordinary --goal-contract, not both");
    const challenges = flags.get("challenges");
    if (challenges !== undefined && !["off", "report", "required"].includes(challenges))
      throw invalid("--challenges must be off, report, or required");
    if (challenges !== undefined && !flags.has("goal-contract"))
      throw invalid("--challenges needs --goal-contract: challenges are of requirement checks");
    const streamPath = flags.get("agent-stream");
    const streamFormat = flags.get("agent-format") ?? "generic";
    if (streamFormat !== "generic" && streamFormat !== "claude-code") {
      throw invalid(
        `--agent-format "${streamFormat}" is not a format this build reads. ` +
          "Use generic or claude-code",
      );
    }
    return {
      command: "ci",
      ...(flags.has("package") ? { packages: flags.get("package")?.split("\0") ?? [] } : {}),
      ...(flags.has("isolation") ? { isolation: flags.get("isolation") ?? null } : {}),
      ...(flags.has("contract")
        ? { acceptanceContract: resolve(context.currentDirectory, flags.get("contract") as string) }
        : {}),
      ...(flags.has("bundle")
        ? { bundleDirectory: resolve(context.currentDirectory, flags.get("bundle") as string) }
        : {}),
      ...(flags.has("summary")
        ? { summaryFile: resolve(context.currentDirectory, flags.get("summary") as string) }
        : {}),
      ...(flags.has("goal-contract")
        ? { goalContract: resolve(context.currentDirectory, flags.get("goal-contract") as string) }
        : {}),
      ...(challenges === undefined
        ? {}
        : { challenges: challenges as "off" | "report" | "required" }),
      installDependencies: flags.has("install"),
      oracleOnly: flags.has("oracle-only"),
      ...(flags.has("require-isolation") ? { requireIsolation: true } : {}),
      taskOracle: flags.get("oracle") ?? null,
      agentStream:
        streamPath === undefined || streamPath.trim().length === 0
          ? null
          : { path: resolve(context.currentDirectory, streamPath.trim()), format: streamFormat },
      ...(patchFile === undefined
        ? {}
        : { patchFile: resolve(context.currentDirectory, patchFile.trim()) }),
      ...(branch === undefined ? {} : { branch }),
      ...(pr === undefined ? {} : { pr }),
      ...(flags.has("base") ? { exactBase: true } : {}),
      workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
      baseRef: flags.get("base") ?? defaultBaseRef,
      immutablePaths: commaList(flags.get("immutable")),
      json: flags.has("json"),
    };
  }

  if (words[0] === "verify") {
    const target = words.slice(1).join(" ").trim();
    if (target.length === 0) {
      throw invalid("verify needs a bundle directory");
    }
    return {
      command: "verify",
      bundleDirectory: resolve(context.currentDirectory, target),
      expectedSigners: commaList(flags.get("signer")),
    };
  }

  if (words[0] === "check") {
    const bundleFlag = flags.get("bundle");
    return {
      command: "check",
      ...(flags.has("package") ? { packages: flags.get("package")?.split("\0") ?? [] } : {}),
      workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
      baseRef: flags.get("base") ?? defaultBaseRef,
      bundleDirectory:
        bundleFlag === undefined ? null : resolve(context.currentDirectory, bundleFlag),
      explain: flags.has("explain"),
      json: flags.has("json"),
    };
  }

  if (words[0] === "verdict") {
    // The bare form reads the document the Action names, in the directory the reader is in.
    const target = words.slice(1).join(" ").trim() || "verdict.json";
    const repository = flags.get("repo") ?? null;
    if (repository !== null && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
      throw invalid("--repo must be OWNER/REPO");
    return {
      command: "verdict",
      verdictPath: resolve(context.currentDirectory, target),
      evidenceDirectory: flags.has("evidence")
        ? resolve(context.currentDirectory, flags.get("evidence") as string)
        : null,
      repository,
      signerWorkflow: flags.get("signer-workflow") ?? null,
    };
  }

  if (words[0] === "hook") {
    const step = words[1] ?? "help";
    if (step !== "install" && step !== "uninstall" && step !== "run" && step !== "help")
      throw invalid("hook needs one of install, uninstall, or run");
    const scope = flags.get("scope") ?? "project";
    if (scope !== "project" && scope !== "user") throw invalid("--scope must be project or user");
    return {
      command: "hook",
      step,
      settingsPath: flags.has("settings")
        ? resolve(context.currentDirectory, flags.get("settings") as string)
        : null,
      scope,
      workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
    };
  }

  if (words[0] === "mcp") {
    return {
      command: "mcp",
      root: resolve(context.currentDirectory, flags.get("root") ?? "."),
      describe: flags.has("describe"),
    };
  }

  if (words[0] === "pre-commit") {
    const step = words[1] ?? "run";
    if (step !== "install" && step !== "uninstall" && step !== "run")
      throw invalid("pre-commit takes install, uninstall, or nothing to verify the staged tree");
    return {
      command: "pre-commit",
      step,
      workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
      json: flags.has("json"),
    };
  }

  if (words[0] === "action") {
    // The bare form is the producer step, which is the one a person would run by hand.
    const step = words[1] ?? "verify";
    if (step !== "verify" && step !== "comment" && step !== "retain")
      throw invalid("action needs one of verify, comment, or retain");
    return { command: "action", step };
  }

  if (words[0] === "gates") {
    const bundleFlag = flags.get("bundle");
    const allowed = flags.get("allowed-files");
    return {
      command: "gates",
      ...(flags.has("package") ? { packages: flags.get("package")?.split("\0") ?? [] } : {}),
      ...(flags.has("isolation") ? { isolation: flags.get("isolation") ?? null } : {}),
      // Resolved against the injected directory, not the ambient cwd, so a relative
      // --workspace lands where the caller says it does.
      workspace: resolve(context.currentDirectory, flags.get("workspace") ?? "."),
      baseRef: flags.get("base") ?? defaultBaseRef,
      bundleDirectory:
        bundleFlag === undefined ? null : resolve(context.currentDirectory, bundleFlag),
      allowedFiles: allowed === undefined ? null : commaList(allowed),
    };
  }

  return null;
}
