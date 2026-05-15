/**
 * Implementation of `swarm v8 doctor`.
 *
 * Probes the local environment for everything `swarm run` will touch:
 *   - ANTHROPIC_API_KEY is loadable from the env-loader's precedence chain
 *   - Falsifier adapter CLIs (codex, copilot, claude) respond to --version
 *   - At least one package manager (npm/yarn/pnpm) is on PATH
 *   - cwd is inside a writable directory (git repo when --require-git)
 *
 * Exit codes:
 *   0 — every probe passed
 *   9 — at least one probe failed (a `swarm run` will likely produce
 *       misleading output without intervention)
 *
 * The doctor never invokes the Anthropic API or any falsifier; it only
 * checks for prerequisites. Runs in well under a second on a normal
 * developer machine.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { readBoolean, readString, runParseArgs, type ParseArgsOptions } from './argv-schema';

const logger = getLogger('cli:v8:doctor');

/** A single probe's result. */
interface ProbeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** When false, a failure is recorded but does not flip the exit code. */
  readonly required: boolean;
}

/** Parsed flags for `swarm v8 doctor`. */
export interface DoctorFlags {
  /** Directory whose state is being inspected. Defaults to process.cwd(). */
  cwd: string;
  /**
   * When true, doctor fails if cwd is not inside a writable git repo.
   * Default false — many projects run swarm against subdirectories that
   * aren't standalone git repos.
   */
  requireGit: boolean;
  /** Set when `--help`/`-h` was passed; the handler short-circuits with exit 0. */
  helpRequested: boolean;
}

/** Top-level dispatcher for the `doctor` subcommand. */
export async function handleDoctor(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  if (flags.helpRequested) return 0;
  const results: ProbeResult[] = [];

  results.push(probeApiKey());
  results.push(probeCommandOnPath('codex', false, 'falsifier (optional; only required for property-must-hold adversarial search)'));
  results.push(probeCommandOnPath('copilot', false, 'falsifier (optional)'));
  results.push(probeCommandOnPath('claude', false, 'falsifier (optional)'));
  results.push(probeAtLeastOnePackageManager());
  results.push(probeCwd(flags.cwd, flags.requireGit));

  let exitCode = 0;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    const line = `${mark} ${r.name}: ${r.detail}`;
    if (r.ok) {
      logger.info(line);
    } else if (r.required) {
      logger.error(line);
      exitCode = 9;
    } else {
      logger.warn(line);
    }
  }

  if (exitCode === 0) {
    logger.info('doctor: all required probes passed.');
  } else {
    logger.error('doctor: one or more required probes failed; see ✗ entries above.');
  }
  return exitCode;
}

const DOCTOR_SCHEMA: ParseArgsOptions = {
  cwd: { type: 'string' },
  'require-git': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

function parseFlags(argv: string[]): DoctorFlags {
  const { values } = runParseArgs(argv, DOCTOR_SCHEMA);
  const helpRequested = readBoolean(values, 'help');
  if (helpRequested) {
    process.stderr.write(
      [
        'usage: swarm v8 doctor [flags]',
        '',
        'flags:',
        '  --cwd <path>      directory to inspect (default: process.cwd())',
        '  --require-git     fail if cwd is not inside a writable git repo',
        '  --help, -h        show this message',
        '',
      ].join('\n'),
    );
  }
  const cwd = readString(values, 'cwd');
  return {
    cwd: cwd !== undefined ? path.resolve(cwd) : process.cwd(),
    requireGit: readBoolean(values, 'require-git'),
    helpRequested,
  };
}

function probeApiKey(): ProbeResult {
  const v = process.env.ANTHROPIC_API_KEY;
  if (typeof v === 'string' && v.length >= 20) {
    return {
      name: 'ANTHROPIC_API_KEY',
      ok: true,
      detail: 'loaded from env (length=' + v.length + ')',
      required: true,
    };
  }
  return {
    name: 'ANTHROPIC_API_KEY',
    ok: false,
    detail:
      'not loaded; set it in your shell, in the target repo\'s .env, in the orchestrator install .env, or in ~/.env',
    required: true,
  };
}

function probeCommandOnPath(command: string, required: boolean, role: string): ProbeResult {
  const result = spawnSync(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    return {
      name: `binary "${command}"`,
      ok: false,
      detail: `not on PATH — ${role}`,
      required,
    };
  }
  if (result.status === 0) {
    const v = (result.stdout?.toString() ?? '').trim().split('\n')[0] ?? '';
    return {
      name: `binary "${command}"`,
      ok: true,
      detail: v.length > 0 ? `available (${v})` : 'available',
      required,
    };
  }
  return {
    name: `binary "${command}"`,
    ok: false,
    detail: `present but \`${command} --version\` exited ${result.status ?? 'null'}; ${role}`,
    required,
  };
}

function probeAtLeastOnePackageManager(): ProbeResult {
  const candidates = ['npm', 'yarn', 'pnpm'];
  const present: string[] = [];
  for (const c of candidates) {
    const r = spawnSync(c, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
    if (!r.error && r.status === 0) present.push(c);
  }
  if (present.length === 0) {
    return {
      name: 'package manager',
      ok: false,
      detail: 'no npm/yarn/pnpm on PATH; swarm needs at least one to run testCommand and buildCommand',
      required: true,
    };
  }
  return {
    name: 'package manager',
    ok: true,
    detail: `available on PATH: ${present.join(', ')}`,
    required: true,
  };
}

function probeCwd(cwd: string, requireGit: boolean): ProbeResult {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return {
      name: 'working directory',
      ok: false,
      detail: `${cwd} does not exist or is not a directory`,
      required: true,
    };
  }
  // Writable?
  try {
    fs.accessSync(cwd, fs.constants.W_OK);
  } catch {
    return {
      name: 'working directory',
      ok: false,
      detail: `${cwd} is not writable; swarm needs to create .swarm/{contracts,ledger,snapshots}/`,
      required: true,
    };
  }
  if (requireGit) {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });
    if (r.status !== 0) {
      return {
        name: 'working directory',
        ok: false,
        detail: `${cwd} is not inside a git repo (required by --require-git)`,
        required: true,
      };
    }
  }
  return {
    name: 'working directory',
    ok: true,
    detail: `${cwd} is writable`,
    required: true,
  };
}
