import * as fs from 'fs';
import * as path from 'path';

/**
 * Result of discovering the target project's full test command.
 *
 * Agents MUST run `command` (the project's actual full test gate) before
 * committing, not individual test runners like `npx vitest --run`. Running
 * a subset of the gate masks lint/type failures that the real gate catches.
 */
export interface TestCommandDiscovery {
  /** The command agents should run before committing (e.g. "pnpm test"). */
  command: string;
  /** The raw script body from package.json (e.g. "pnpm lint && vitest --run && pnpm test:types"), if present. */
  rawScript: string | undefined;
  /** True when package.json had a `scripts.test` entry; false when falling back. */
  hasScript: boolean;
  /** Detected package manager based on lockfile. */
  packageManager: 'pnpm' | 'yarn' | 'npm';
  /** Warning message when falling back (no package.json, no test script, etc.). */
  warning: string | undefined;
}

/**
 * Discover the target project's full test command from its package.json.
 *
 * Reads `scripts.test` and combines it with the detected package manager
 * (from pnpm-lock.yaml, yarn.lock, or package-lock.json) to produce the
 * single command agents should run to verify their work.
 *
 * @param projectRoot absolute path to the target project
 * @returns discovery result including the command and any fallback warning
 */
export function discoverTestCommand(projectRoot: string): TestCommandDiscovery {
  const packageManager = detectPackageManager(projectRoot);
  const packageJsonPath = path.join(projectRoot, 'package.json');

  if (!fs.existsSync(packageJsonPath)) {
    return {
      command: `${packageManager} test`,
      rawScript: undefined,
      hasScript: false,
      packageManager,
      warning: `no package.json found at ${packageJsonPath}; falling back to "${packageManager} test"`,
    };
  }

  let pkg: { scripts?: Record<string, string> };
  try {
    pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (err) {
    return {
      command: `${packageManager} test`,
      rawScript: undefined,
      hasScript: false,
      packageManager,
      warning: `failed to parse ${packageJsonPath}: ${(err as Error).message}; falling back to "${packageManager} test"`,
    };
  }

  const rawScript = pkg.scripts?.test;
  if (!rawScript || rawScript.trim() === '') {
    return {
      command: `${packageManager} test`,
      rawScript: undefined,
      hasScript: false,
      packageManager,
      warning: `no "test" script in ${packageJsonPath}; falling back to "${packageManager} test" (may fail if no test setup exists)`,
    };
  }

  return {
    command: `${packageManager} test`,
    rawScript,
    hasScript: true,
    packageManager,
    warning: undefined,
  };
}

function detectPackageManager(projectRoot: string): 'pnpm' | 'yarn' | 'npm' {
  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Render the prompt section that tells an agent how to verify its work.
 *
 * Every prompt-building path in the orchestrator must include this block so
 * agents run the project's full test gate (lint + tests + types) rather
 * than a subset runner like `npx vitest --run` that would skip lint/types.
 */
export function renderVerifyCommandSection(discovery: TestCommandDiscovery): string {
  const lines: string[] = [];
  lines.push('Verify before committing (REQUIRED)');
  lines.push('-----------------------------------');
  lines.push(`Before committing, run \`${discovery.command}\` and verify it passes.`);
  lines.push('Do not run individual test tools directly. Run the project\'s full test script.');
  if (discovery.hasScript && discovery.rawScript) {
    lines.push(`This project's "${discovery.command}" runs: ${discovery.rawScript}`);
    lines.push('Running a subset (e.g. `npx vitest --run`) will miss lint and type checks and your commit may fail.');
  } else if (discovery.warning) {
    lines.push(`WARNING: ${discovery.warning}`);
    lines.push('If no real test gate exists, say so in your verification section rather than fabricating output.');
  }
  lines.push('');
  return lines.join('\n');
}
