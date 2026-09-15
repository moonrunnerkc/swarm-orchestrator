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
  readonly bundleDirectory?: string;
  readonly command: "ci";
  readonly patchFile: string;
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

export type VerifyOnlyCommand = VerifyCommand | CiCommand | GatesCommand;

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
  "version",
  "json",
  "remove",
  "install",
  "oracle-only",
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
    flags.set(name, value);
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
    if (patchFile === undefined || patchFile.trim().length === 0) {
      throw invalid(
        "ci needs --patch <file>: the change to verify against a fresh checkout of the base",
      );
    }
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
      ...(flags.has("isolation") ? { isolation: flags.get("isolation") ?? null } : {}),
      ...(flags.has("contract")
        ? { acceptanceContract: resolve(context.currentDirectory, flags.get("contract") as string) }
        : {}),
      ...(flags.has("bundle")
        ? { bundleDirectory: resolve(context.currentDirectory, flags.get("bundle") as string) }
        : {}),
      installDependencies: flags.has("install"),
      oracleOnly: flags.has("oracle-only"),
      taskOracle: flags.get("oracle") ?? null,
      agentStream:
        streamPath === undefined || streamPath.trim().length === 0
          ? null
          : { path: resolve(context.currentDirectory, streamPath.trim()), format: streamFormat },
      patchFile: resolve(context.currentDirectory, patchFile.trim()),
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

  if (words[0] === "gates") {
    const bundleFlag = flags.get("bundle");
    const allowed = flags.get("allowed-files");
    return {
      command: "gates",
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
