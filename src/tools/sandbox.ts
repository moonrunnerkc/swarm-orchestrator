import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { readShellCommand } from "./shell-command.ts";

/**
 * Credential paths denied by default. A workspace .env holding live keys is the
 * ordinary case, not the exotic one, so the denial is the default rather than a setting.
 */
const credentialPatterns: readonly RegExp[] = [
  /(^|\/)\.env[^/]*$/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)\.git\/config$/,
  // The one optional config file may carry provider keys, so tools never read it.
  /(^|\/)swarm\.toml$/,
];

/**
 * Executables a run may use without asking. One definition, because a second copy is how a
 * command ends up allowed in one entry point and confirmed in another.
 */
export const defaultShellAllowlist: readonly string[] = [
  "cat",
  "git",
  "grep",
  "head",
  "ls",
  "node",
  "npm",
  "npx",
  "pwd",
  "sed",
  "tail",
  "wc",
];

export interface SandboxPolicy {
  readonly workspaceRoot: string;
  readonly homeDir: string;
  /** Executables the shell tool may run without asking. Anything else needs confirmation. */
  readonly shellAllowlist: readonly string[];
  /** Paths tools may never touch even inside the workspace, such as the session store. */
  readonly deniedRoots: readonly string[];
  /**
   * Resolves symlinks. Injected so the containment check can be exercised without a
   * real filesystem; defaults to the node implementation.
   */
  readonly realpath?: ((path: string) => string) | undefined;
}

type SandboxVerdict =
  | { readonly allowed: true; readonly absolutePath: string }
  | { readonly allowed: false; readonly reason: string };

export interface Sandbox {
  readonly workspaceRoot: string;
  /** Resolves a path against the workspace, refusing anything that escapes or is denied. */
  checkPath(candidate: string): SandboxVerdict;
  /** Whether the command's executable is on the allowlist. */
  isCommandAllowed(command: string): boolean;
}

export function createSandbox(policy: SandboxPolicy): Sandbox {
  const realpath = policy.realpath ?? defaultRealpath;
  const workspaceRoot = realpath(resolve(policy.workspaceRoot));
  const homeDirectory = resolve(policy.homeDir);
  const deniedRoots = [
    resolve(policy.homeDir, ".aws"),
    resolve(policy.homeDir, ".ssh"),
    ...policy.deniedRoots.map((path) => resolve(path)),
  ];

  return {
    workspaceRoot,

    checkPath(candidate: string): SandboxVerdict {
      if (candidate.trim().length === 0) {
        return { allowed: false, reason: "the path is empty" };
      }

      const named = expandHome(candidate.trim(), homeDirectory);
      const requested = isAbsolute(named) ? resolve(named) : resolve(workspaceRoot, named);
      // Resolve symlinks first: a link inside the workspace pointing outside it is an escape.
      const absolutePath = resolveThroughLinks(requested, realpath);

      if (!isInside(workspaceRoot, absolutePath)) {
        return {
          allowed: false,
          reason: `${absolutePath} resolves outside the workspace ${workspaceRoot}`,
        };
      }

      for (const denied of deniedRoots) {
        if (isInside(denied, absolutePath)) {
          return { allowed: false, reason: `${absolutePath} is under the denied path ${denied}` };
        }
      }

      const workspacePath = relative(workspaceRoot, absolutePath).split(sep).join("/");
      if (credentialPatterns.some((pattern) => pattern.test(`/${workspacePath}`))) {
        return {
          allowed: false,
          reason: `${workspacePath} matches the credential denylist (.env*, *.pem, *.key, .git/config, swarm.toml)`,
        };
      }

      return { allowed: true, absolutePath };
    },

    isCommandAllowed(command: string): boolean {
      // Every command in the string, not the first one: the whole string reaches `/bin/sh -c`.
      // A string this cannot read is not allowed either, which asks rather than assumes.
      const read = readShellCommand(command);
      return (
        read !== null && read.executables.every((name) => policy.shellAllowlist.includes(name))
      );
    },
  };
}

/**
 * `/bin/sh` expands a leading tilde before the command it runs ever opens anything, so a check
 * that reads `~/.ssh/id_rsa` as a relative name is ruling on a path nothing will touch. The
 * tildes this cannot expand are refused before they reach here.
 */
function expandHome(candidate: string, homeDirectory: string): string {
  if (candidate === "~") {
    return homeDirectory;
  }
  return candidate.startsWith("~/") ? join(homeDirectory, candidate.slice(2)) : candidate;
}

function defaultRealpath(path: string): string {
  return realpathSync(path);
}

/**
 * Resolves the deepest existing ancestor through symlinks and re-appends the segments
 * that do not exist yet, so a path being created is checked as strictly as one being read.
 */
function resolveThroughLinks(path: string, realpath: (path: string) => string): string {
  const missingSegments: string[] = [];
  let current = path;

  for (;;) {
    try {
      return resolve(realpath(current), ...missingSegments);
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        return path;
      }
      missingSegments.unshift(relative(parent, current));
      current = parent;
    }
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}
