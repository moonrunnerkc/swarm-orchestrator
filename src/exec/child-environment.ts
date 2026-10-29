import { tmpdir } from "node:os";
import { isCredentialName } from "../evidence/credential-names.ts";

/**
 * The environment a child process gets, built rather than inherited.
 *
 * The floor is an allowlist and not a denylist, because a denylist answers "is this name one
 * of the ones we thought of" and the question that matters is "does this process need this
 * name to run". A run started from a shell holding the operator's own provider keys used to
 * hand every one of them to a command the model wrote and to a gate command the repository
 * declared, and no path check saw it: `node -e "process.env.ANTHROPIC_API_KEY"` names no file.
 */
const alwaysCarried: ReadonlySet<string> = new Set([
  "PATH",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
]);

/**
 * Names that decide what node loads, refused even where a run authorized them by name. This is
 * invariant 7's property: an artifact is only worth reading while the harness controls the run
 * that wrote it, and a preload the workspace named is that control handed back.
 */
const nodeLoaderNames: ReadonlySet<string> = new Set([
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_EXTERNAL_MODULE",
  "NODE_EXTRA_CA_CERTS",
]);

/**
 * Names whose values decide what a process loads before it reaches its own entry point. Node's
 * own family is taken whole rather than listed member by member, since listing is the shape
 * that keeps losing to the next spelling, and the dynamic-linker names are here because they
 * put native code in any process at all. Refused even where a run authorized them: the
 * allowlist already drops them, and an explicit refusal says why rather than going quiet.
 */
const preloadNames: ReadonlySet<string> = new Set([
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FRAMEWORK_PATH",
]);

export interface ChildEnvironmentOptions {
  /** The home directory the child gets. Worker-local, never the operator's own. */
  readonly homeDir: string;
  /** Scratch directory for the child. Defaults to a directory under its home. */
  readonly tmpDir?: string;
  /** Task variables this run authorized by name. */
  readonly passThrough?: readonly string[];
}

export interface ChildEnvironment {
  readonly variables: Record<string, string>;
  /** Names the parent held that did not travel, so the withholding is recordable as evidence. */
  readonly withheld: readonly string[];
}

/** Thrown where a run authorizes a name that may never travel. Fail closed, not filtered down. */
export class UnauthorizableEnvironmentName extends Error {
  /** The environment name the run tried to authorize. */
  readonly variableName: string;

  constructor(variableName: string, reason: string) {
    super(
      `${variableName} cannot be passed to a child process: ${reason}. ` +
        "Remove it from the run's authorized environment names.",
    );
    this.name = "UnauthorizableEnvironmentName";
    this.variableName = variableName;
  }
}

export function childEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  options: ChildEnvironmentOptions,
): ChildEnvironment {
  const authorized = new Set(options.passThrough ?? []);
  for (const name of authorized) {
    const folded = name.toUpperCase();
    if (nodeLoaderNames.has(folded) || folded.startsWith("NODE_")) {
      throw new UnauthorizableEnvironmentName(name, "it decides what node loads");
    }
    if (preloadNames.has(folded)) {
      throw new UnauthorizableEnvironmentName(name, "it decides what any process loads");
    }
    if (isCredentialName(name)) {
      throw new UnauthorizableEnvironmentName(name, "it is a credential name");
    }
  }

  const variables: Record<string, string> = {
    // Every runner this harness spawns is run the way a CI job runs it: Vitest, Jest, Mocha and
    // Create React App's test script read this name as "run once and exit", and a child with
    // no terminal on stdin has nobody to wait for anyway. Set here rather than per gate so a
    // command a model runs through the shell tool reads the same way as the gate that measures
    // it. The inherited value, whatever it was, is replaced rather than carried.
    CI: "true",
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    UV_PYTHON_DOWNLOADS: "never",
    HOME: options.homeDir,
    // The system scratch directory, which exists and holds no credential. A TMPDIR naming a
    // directory that is not there does not fail loudly: node's test runner writes a zero-byte
    // lcov report, and invariant 7 reads an incomplete report as not measured, so the coverage
    // arm goes quiet instead.
    TMPDIR: options.tmpDir ?? tmpdir(),
  };
  const withheld: string[] = [];

  for (const [name, value] of Object.entries(inherited)) {
    if (value === undefined) {
      continue;
    }
    if (name === "HOME" || name === "TMPDIR") {
      // Replaced above rather than withheld: the child gets one, just not this one.
      continue;
    }
    if (alwaysCarried.has(name.toUpperCase()) || authorized.has(name)) {
      variables[name] = value;
      continue;
    }
    withheld.push(name);
  }

  return { variables, withheld };
}
