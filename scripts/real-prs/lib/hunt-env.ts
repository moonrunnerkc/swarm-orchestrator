// Execution-environment resolution for the capability-hunt recall passes.
//
// A recall batch runs detached (nohup + caffeinate) so it survives the session
// that launched it. A detached shell does not source an interactive profile, so
// nvm / asdf / brew shims present in .zshrc are simply absent from its PATH and
// every sandbox install fails on a missing `node`. This module resolves the
// toolchain to absolute directories up front, fails loudly when the pinned Node
// is unreachable, and reports the resolved environment so every record a pass
// writes carries the environment it was measured in.
//
// Environment overrides (all optional, all absolute bin directories):
//   SWARM_HUNT_NODE_BIN    node/npm/npx/corepack for the sandbox toolchain
//   SWARM_HUNT_GO_BIN      `go`
//   SWARM_HUNT_PYTHON_BIN  `python3`

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SwarmError } from '../../../src/errors';

/** The Node the execution-grounded sandbox pins when no override is given. */
const LEGACY_NVM_NODE_BIN = path.join(
  process.env.HOME ?? '',
  '.nvm',
  'versions',
  'node',
  'v22.15.0',
  'bin',
);

/** Candidate bin directories tried in order when SWARM_HUNT_NODE_BIN is unset. */
const NODE_BIN_CANDIDATES: readonly string[] = [
  LEGACY_NVM_NODE_BIN,
  '/opt/homebrew/opt/node@22/bin',
  '/usr/local/opt/node@22/bin',
];

/** Candidate bin directories for the Go and Python toolchains. */
const GO_BIN_CANDIDATES: readonly string[] = [
  path.join(process.env.HOME ?? '', 'go-toolchain', 'go', 'bin'),
  '/opt/homebrew/bin',
  '/usr/local/go/bin',
  '/usr/local/bin',
];
const PYTHON_BIN_CANDIDATES: readonly string[] = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
];

/** A resolved toolchain plus the version strings it reports. */
export interface HuntEnvironment {
  /** `darwin` / `linux`, from os.platform(). */
  readonly platform: string;
  /** `arm64` / `x64`, from os.arch(). */
  readonly arch: string;
  /** os.release(), so a macOS record names the Darwin kernel it ran on. */
  readonly release: string;
  /** Absolute bin dir handed to the sandbox as SWARM_EG_NODE_BIN. */
  readonly nodeBin: string;
  /** `node --version` from nodeBin, e.g. v22.22.3. */
  readonly nodeVersion: string;
  /** Absolute bin dir holding `go`, or null when Go is not installed. */
  readonly goBin: string | null;
  /** `go version` output, or null when Go is not installed. */
  readonly goVersion: string | null;
  /** Absolute bin dir holding `python3`, or null when Python is not installed. */
  readonly pythonBin: string | null;
  /** `python3 --version` output, or null when Python is not installed. */
  readonly pythonVersion: string | null;
  /** A short human label for report rows, e.g. `darwin/arm64 node v22.22.3`. */
  readonly label: string;
}

/** Run `<bin>/<name> <args>` and return trimmed stdout, or null when the binary
 *  is missing or exits non-zero. Used only for version probes. */
function probe(dir: string, name: string, args: readonly string[]): string | null {
  const binary = path.join(dir, name);
  if (!fs.existsSync(binary)) return null;
  const res = spawnSync(binary, [...args], { encoding: 'utf8', timeout: 30_000 });
  if (res.status !== 0 || typeof res.stdout !== 'string') return null;
  const out = res.stdout.trim();
  return out.length > 0 ? out : null;
}

/** First candidate directory that holds a runnable `name`, or null. */
function firstWorking(
  candidates: readonly string[],
  name: string,
  args: readonly string[],
): { dir: string; version: string } | null {
  for (const dir of candidates) {
    const version = probe(dir, name, args);
    if (version !== null) return { dir, version };
  }
  return null;
}

/** Candidate list for a toolchain: the explicit override first when set. */
function candidatesFor(override: string | undefined, defaults: readonly string[]): string[] {
  return override !== undefined && override.length > 0 ? [override, ...defaults] : [...defaults];
}

/**
 * Resolve the toolchain the batch will hand to its child audits.
 *
 * @returns the resolved environment, with Go and Python null when absent (the
 *   caller degrades those ecosystems with a named reason rather than guessing).
 * @throws SwarmError when no candidate directory yields a runnable `node`,
 *   because running a whole batch on an unresolvable runtime produces records
 *   that measure the harness rather than the detectors.
 */
export function resolveHuntEnvironment(): HuntEnvironment {
  const node = firstWorking(
    candidatesFor(process.env.SWARM_HUNT_NODE_BIN, NODE_BIN_CANDIDATES),
    'node',
    ['--version'],
  );
  if (node === null) {
    throw new SwarmError(
      'no runnable pinned Node found for the recall batch',
      'HUNT_NODE_UNRESOLVED',
      {
        remediation:
          'Install a Node 22 toolchain and point SWARM_HUNT_NODE_BIN at its bin directory ' +
          `(tried: ${NODE_BIN_CANDIDATES.join(', ')}). On macOS: brew install node@22, then ` +
          'export SWARM_HUNT_NODE_BIN=/opt/homebrew/opt/node@22/bin',
      },
    );
  }
  const go = firstWorking(candidatesFor(process.env.SWARM_HUNT_GO_BIN, GO_BIN_CANDIDATES), 'go', [
    'version',
  ]);
  const python = firstWorking(
    candidatesFor(process.env.SWARM_HUNT_PYTHON_BIN, PYTHON_BIN_CANDIDATES),
    'python3',
    ['--version'],
  );
  return {
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    nodeBin: node.dir,
    nodeVersion: node.version,
    goBin: go?.dir ?? null,
    goVersion: go?.version ?? null,
    pythonBin: python?.dir ?? null,
    pythonVersion: python?.version ?? null,
    label: `${os.platform()}/${os.arch()} node ${node.version}`,
  };
}

/**
 * Build the PATH a child audit runs under: the pinned Node bin first, then the
 * Go and Python bin dirs when present, then the inherited PATH as a last
 * resort. Ordering is what pins the toolchain, so the pinned dirs lead.
 *
 * @param env the resolved environment from `resolveHuntEnvironment`.
 * @returns a PATH string suitable for the child process env.
 */
export function huntChildPath(env: HuntEnvironment): string {
  const dirs = [env.nodeBin, env.goBin, env.pythonBin].filter((d): d is string => d !== null);
  const inherited = process.env.PATH ?? '';
  return inherited.length > 0
    ? [...dirs, inherited].join(path.delimiter)
    : dirs.join(path.delimiter);
}
