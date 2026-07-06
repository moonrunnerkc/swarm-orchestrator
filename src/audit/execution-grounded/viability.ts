// Directory-based execution-groundability check. Given a provisioned (or
// local fixture) workspace, decide whether the merge-safety gate can actually
// build and run the project's suite: a Node project, a lockfile, a
// recognizable test runner, and a node engine that admits the pinned runtime.
//
// This is the src-side analog of the network-only corpus screen in
// scripts/real-prs/eg-viability-screen.ts (screenPr): same four criteria, same
// EG_NODE_MAJOR, but evaluated against a checked-out directory rather than a
// GitHub contents listing, so the merge gate can call it on the tree it just
// provisioned. Phase 2 extends the runner set (pytest, Go) by extending the
// detectTestRunner seam this reuses.

import * as fs from 'fs';
import * as path from 'path';
import {
  detectNonNodeRunner,
  detectPackageManager,
  detectTestRunner,
  type PackageManager,
  type TestRunner,
} from './sandbox';

/** Lockfiles that mark an installable Node tree. Mirrors the corpus screen. */
const LOCKFILES: readonly string[] = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'bun.lockb',
];

/** The runtime major the execution-grounded evidence run pins (SWARM_EG_NODE_BIN=node@22). */
export const EG_NODE_MAJOR = 22;

/** The project ecosystem the gate can provision and run. */
export type Ecosystem = 'node' | 'python' | 'go';

/** Outcome of the viability assessment. `reason` is '' when viable, else why not. */
export interface ViabilityAssessment {
  readonly viable: boolean;
  readonly reason: string;
  /** The recognized ecosystem, or null when none is. */
  readonly ecosystem: Ecosystem | null;
  readonly hasPackageJson: boolean;
  readonly lockfile: string | null;
  /** The Node package manager; null for non-Node ecosystems. */
  readonly packageManager: PackageManager | null;
  readonly testRunner: TestRunner | null;
  /** The Node engine range; null for non-Node ecosystems. */
  readonly nodeEngine: string | null;
}

/**
 * Whether a package.json `engines.node` range admits the pinned EG runtime.
 * Conservative and ported verbatim from the corpus screen: an absent engine is
 * fine, a bare pin (e.g. "18", "18.x") is fine only if it is the pinned major,
 * and an upper bound at or below the pinned major (e.g. "<16") excludes it.
 *
 * @param engine the raw engines.node string, or null when unspecified.
 * @returns true when node EG_NODE_MAJOR satisfies the range.
 */
export function nodeEngineSatisfiable(engine: string | null): boolean {
  if (engine === null || engine.trim().length === 0) return true;
  const majors = [...engine.matchAll(/(\d+)/g)].map((m) => Number(m[1]));
  if (majors.length === 0) return true;
  if (/<\s*\d+/.test(engine)) {
    const upper = Number((engine.match(/<\s*(\d+)/) ?? [])[1]);
    if (Number.isFinite(upper) && upper <= EG_NODE_MAJOR) return false;
  }
  if (/^\s*\d+(\.\d+|\.x)?\s*$/.test(engine)) {
    return Number(majors[0]) === EG_NODE_MAJOR;
  }
  return true;
}

function readNodeEngine(pkgPath: string): string | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { engines?: { node?: string } };
    return pkg.engines?.node ?? null;
  } catch {
    // A package.json that will not parse is handled by the caller as
    // "no recognizable test runner"; the engine is simply unknown here.
    return null;
  }
}

/**
 * Assess whether a workspace directory is execution-groundable by the
 * merge-safety gate.
 *
 * @param workspaceDir a checked-out (or fixture) project root.
 * @returns the assessment; `viable` gates whether the positive gate runs its controls.
 */
export function assessViability(workspaceDir: string): ViabilityAssessment {
  const pkgPath = path.join(workspaceDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    return assessNode(workspaceDir, pkgPath);
  }

  // Non-Node ecosystems. Go (go.mod) runs under `go test`; a Python project
  // with a pytest signal runs under pytest. Both are viable: no lockfile or
  // node-engine gate applies. detectNonNodeRunner encodes the Go-before-Python
  // precedence.
  const runner = detectNonNodeRunner(workspaceDir);
  if (runner === 'go-test') {
    return {
      viable: true,
      reason: '',
      ecosystem: 'go',
      hasPackageJson: false,
      lockfile: null,
      packageManager: null,
      testRunner: 'go-test',
      nodeEngine: null,
    };
  }
  if (runner === 'pytest') {
    return {
      viable: true,
      reason: '',
      ecosystem: 'python',
      hasPackageJson: false,
      lockfile: null,
      packageManager: null,
      testRunner: 'pytest',
      nodeEngine: null,
    };
  }
  return {
    viable: false,
    reason:
      'not execution-groundable: no package.json, go.mod, or Python project with a pytest signal',
    ecosystem: null,
    hasPackageJson: false,
    lockfile: null,
    packageManager: null,
    testRunner: null,
    nodeEngine: null,
  };
}

function assessNode(workspaceDir: string, pkgPath: string): ViabilityAssessment {
  const lockfile = LOCKFILES.find((f) => fs.existsSync(path.join(workspaceDir, f))) ?? null;
  const testRunner = detectTestRunner(workspaceDir);
  const packageManager = detectPackageManager(workspaceDir);
  const nodeEngine = readNodeEngine(pkgPath);
  const nodeOk = nodeEngineSatisfiable(nodeEngine);

  const reasons: string[] = [];
  if (lockfile === null) reasons.push('no lockfile');
  if (testRunner === null) reasons.push('no recognizable test runner');
  if (!nodeOk) reasons.push(`node engine "${nodeEngine}" excludes node ${EG_NODE_MAJOR}`);

  const viable = lockfile !== null && testRunner !== null && nodeOk;
  return {
    viable,
    reason: viable ? '' : `not execution-groundable: ${reasons.join('; ')}`,
    ecosystem: 'node',
    hasPackageJson: true,
    lockfile,
    packageManager,
    testRunner,
    nodeEngine,
  };
}
