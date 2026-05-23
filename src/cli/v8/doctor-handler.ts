/**
 * Implementation of `swarm v8 doctor`.
 *
 * Probes the local environment for everything `swarm run` will touch:
 *   - ANTHROPIC_API_KEY is loadable from the env-loader's precedence chain
 *   - Falsifier adapter CLIs (codex, copilot, claude) respond to --version
 *   - At least one package manager (npm/yarn/pnpm) is on PATH
 *   - cwd is inside a writable directory (git repo when --require-git)
 *   - Required .swarm/ directory structure exists
 *   - No stale lock files
 *   - .swarm/ has appropriate permissions
 *
 * With `--fix`, doctor will attempt to auto-resolve fixable issues:
 *   - Missing .swarm/ directory       → create it
 *   - Missing .swarm/ledger/          → create it
 *   - Missing .swarm/contracts/      → create it
 *   - Missing .swarm/snapshots/      → create it
 *   - Missing contract.yaml          → create a default one
 *   - Missing patches.jsonl          → create an empty one
 *   - Stale lock files               → remove .locks/ directory contents
 *   - Wrong file permissions on .swarm/ → fix with chmod
 *
 * Exit codes:
 *   0 — every probe passed (or all failures were auto-fixed with --fix)
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
import { DEFAULT_TOURNAMENT_CONFIG } from '../../population/tournament';
import type { ObligationV1 } from '../../contract/types';

const logger = getLogger('cli:v8:doctor');

/** A single probe's result. */
interface ProbeResult {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** When false, a failure is recorded but does not flip the exit code. */
  readonly required: boolean;
  /** When true, this issue can be auto-fixed with --fix. */
  readonly fixable: boolean;
  /** Description of the fix that would be applied (shown when --fix is not active). */
  readonly fixHint?: string;
}

/** Parsed flags for `swarm v8 doctor`. */
interface DoctorFlags {
  /** Directory whose state is being inspected. Defaults to process.cwd(). */
  cwd: string;
  /**
   * When true, doctor fails if cwd is not inside a writable git repo.
   * Default false — many projects run swarm against subdirectories that
   * aren't standalone git repos.
   */
  requireGit: boolean;
  /**
   * When true, doctor attempts to automatically fix fixable issues.
   * Default false — just report issues.
   */
  fix: boolean;
  /**
   * When true, doctor additionally probes the v10 audit connector
   * surface: GITHUB_TOKEN presence, PR-comment posting permissions,
   * AI-BOM emission readiness, and the cheat-detector module loading.
   */
  connectors: boolean;
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
  results.push(...probeSwarmDirectory(flags.cwd));

  if (flags.connectors) {
    results.push(...probeConnectorSurface(flags.cwd));
  }

  let exitCode = 0;
  let totalIssues = 0;
  let autoFixed = 0;
  let manualRequired = 0;

  for (const r of results) {
    if (r.ok) {
      const mark = '✓';
      logger.info(`${mark} ${r.name}: ${r.detail}`);
      continue;
    }

    // Issue found
    totalIssues++;
    const mark = '✗';
    const line = `${mark} ${r.name}: ${r.detail}`;

    // Attempt auto-fix if --fix is set and the issue is fixable
    let wasFixed = false;
    if (flags.fix && r.fixable) {
      wasFixed = applyFix(r, flags.cwd);
    }

    if (wasFixed) {
      autoFixed++;
      logger.info(`${line}\n  FIX: ${r.fixHint ?? 'auto-resolved'}`);
    } else {
      manualRequired++;
      if (r.required) {
        logger.error(line);
        exitCode = 9;
      } else {
        logger.warn(line);
      }
      // Hint about --fix for fixable issues when --fix is not active
      if (!flags.fix && r.fixable) {
        logger.info('  (run with --fix to auto-resolve)');
      }
    }
  }

  // Print summary
  if (flags.fix && totalIssues > 0) {
    logger.info(`doctor: ${totalIssues} issue(s) found, ${autoFixed} auto-fixed, ${manualRequired} require manual intervention.`);
  } else if (exitCode === 0) {
    logger.info('doctor: all required probes passed.');
  } else {
    logger.error('doctor: one or more required probes failed; see ✗ entries above.');
  }
  return exitCode;
}

const DOCTOR_SCHEMA: ParseArgsOptions = {
  cwd: { type: 'string' },
  'require-git': { type: 'boolean' },
  fix: { type: 'boolean' },
  connectors: { type: 'boolean' },
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
        '  --fix             attempt to auto-fix fixable issues',
        '  --connectors      additionally probe v10 audit-connector readiness',
        '                    (GITHUB_TOKEN, PR-comment permissions, AIBOM)',
        '  --help, -h        show this message',
        '',
      ].join('\n'),
    );
  }
  const cwd = readString(values, 'cwd');
  return {
    cwd: cwd !== undefined ? path.resolve(cwd) : process.cwd(),
    requireGit: readBoolean(values, 'require-git'),
    fix: readBoolean(values, 'fix') ?? false,
    connectors: readBoolean(values, 'connectors') ?? false,
    helpRequested,
  };
}

// Probes the v10 audit-connector surface. Each probe is non-required
// (does not flip the exit code on its own) unless the user explicitly
// configured something that depends on it — checking the surface lets
// platform engineers verify CI before a PR opens.
function probeConnectorSurface(cwd: string): ProbeResult[] {
  const out: ProbeResult[] = [];

  // GITHUB_TOKEN: required for posting PR audit comments and for
  // authenticated PR fetches (60/hr unauthenticated otherwise).
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  out.push({
    name: 'GITHUB_TOKEN',
    ok: token.length > 0,
    detail:
      token.length > 0
        ? 'loaded from env (length=' + token.length + ')'
        : 'not set; PR-comment posting and authenticated PR fetches will not work',
    required: false,
    fixable: false,
  });

  // pull-requests: write permission inference. We can't probe the
  // permission directly here, but we can flag when running under
  // GITHUB_ACTIONS and pull-requests isn't in GITHUB_TOKEN_PERMISSIONS.
  if (process.env.GITHUB_ACTIONS === 'true') {
    const tokenPerms = process.env.GITHUB_TOKEN_PERMISSIONS ?? '';
    const hasPrWrite = tokenPerms.includes('pull-requests:write');
    out.push({
      name: 'workflow pull-requests permission',
      ok: hasPrWrite || tokenPerms.length === 0,
      detail: hasPrWrite
        ? 'pull-requests:write declared'
        : tokenPerms.length === 0
          ? 'GITHUB_TOKEN_PERMISSIONS not set; assuming default permissions'
          : 'pull-requests:write missing — PR comments cannot be posted',
      required: false,
      fixable: false,
    });
  }

  // cheat-detector engine: dynamic require to confirm the module is
  // available in the consumer's install. The audit-handler imports the
  // engine at top-level, so this also detects a broken dist build.
  try {
    const det = require('../../audit/cheat-detector') as { DETECTORS?: readonly { name: string }[] };
    const count = det.DETECTORS?.length ?? 0;
    out.push({
      name: 'cheat-detector engine',
      ok: count > 0,
      detail: count > 0 ? `${count} detector(s) registered` : 'no detectors registered',
      required: true,
      fixable: false,
    });
  } catch (err) {
    out.push({
      name: 'cheat-detector engine',
      ok: false,
      detail: `failed to load: ${(err as Error).message}`,
      required: true,
      fixable: false,
    });
  }

  // AI-BOM directory writability: the consumer might be in a
  // read-only mount; .swarm/aibom needs to be writable for emission.
  const aibomDir = path.join(cwd, '.swarm', 'aibom');
  let aibomOk = true;
  let aibomDetail = `${aibomDir} is writable`;
  try {
    fs.mkdirSync(aibomDir, { recursive: true });
    const probe = path.join(aibomDir, `.doctor-probe-${Date.now()}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
  } catch (err) {
    aibomOk = false;
    aibomDetail = `cannot write AI-BOM artifacts to ${aibomDir}: ${(err as Error).message}`;
  }
  out.push({
    name: 'AI-BOM output directory',
    ok: aibomOk,
    detail: aibomDetail,
    required: false,
    fixable: true,
    fixHint: 'create .swarm/aibom/ and ensure it is writable',
  });

  return out;
}

function probeApiKey(): ProbeResult {
  const v = process.env.ANTHROPIC_API_KEY;
  if (typeof v === 'string' && v.length >= 20) {
    return {
      name: 'ANTHROPIC_API_KEY',
      ok: true,
      detail: 'loaded from env (length=' + v.length + ')',
      required: true,
      fixable: false,
    };
  }
  return {
    name: 'ANTHROPIC_API_KEY',
    ok: false,
    detail:
      'not loaded; set it in your shell, in the target repo\'s .env, in the orchestrator install .env, or in ~/.env',
    required: true,
    fixable: false,
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
      fixable: false,
    };
  }
  if (result.status === 0) {
    const v = (result.stdout?.toString() ?? '').trim().split('\n')[0] ?? '';
    return {
      name: `binary "${command}"`,
      ok: true,
      detail: v.length > 0 ? `available (${v})` : 'available',
      required,
      fixable: false,
    };
  }
  return {
    name: `binary "${command}"`,
    ok: false,
    detail: `present but \`${command} --version\` exited ${result.status ?? 'null'}; ${role}`,
    required,
    fixable: false,
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
      fixable: false,
    };
  }
  return {
    name: 'package manager',
    ok: true,
    detail: `available on PATH: ${present.join(', ')}`,
    required: true,
    fixable: false,
  };
}

function probeCwd(cwd: string, requireGit: boolean): ProbeResult {
  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    return {
      name: 'working directory',
      ok: false,
      detail: `${cwd} does not exist or is not a directory`,
      required: true,
      fixable: false,
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
      fixable: false,
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
        fixable: false,
      };
    }
  }
  return {
    name: 'working directory',
    ok: true,
    detail: `${cwd} is writable`,
    required: true,
    fixable: false,
  };
}

/**
 * Probes the .swarm/ directory structure under cwd.
 * Returns an array of ProbeResults for each sub-check.
 */
function probeSwarmDirectory(cwd: string): ProbeResult[] {
  const results: ProbeResult[] = [];
  const swarmDir = path.join(cwd, '.swarm');

  // Check .swarm/ directory exists
  if (!fs.existsSync(swarmDir)) {
    results.push({
      name: '.swarm/ directory',
      ok: false,
      detail: 'missing; swarm requires .swarm/ for contracts, ledger, snapshots',
      required: true,
      fixable: true,
      fixHint: 'created .swarm/ directory',
    });
    // If .swarm/ doesn't exist, all sub-checks will fail too; report them
    results.push({
      name: '.swarm/ledger/',
      ok: false,
      detail: 'missing; run ledger files are stored here',
      required: true,
      fixable: true,
      fixHint: 'created .swarm/ledger/ directory',
    });
    results.push({
      name: '.swarm/contracts/',
      ok: false,
      detail: 'missing; compiled contracts are stored here',
      required: true,
      fixable: true,
      fixHint: 'created .swarm/contracts/ directory',
    });
    results.push({
      name: '.swarm/snapshots/',
      ok: false,
      detail: 'missing; obligation snapshots are stored here',
      required: false,
      fixable: true,
      fixHint: 'created .swarm/snapshots/ directory',
    });
    // Also check contract.yaml and patches.jsonl even though .swarm/ is missing
    // (they could exist at project root)
    const contractPathsEarly = [
      path.join(cwd, 'contract.yaml'),
      path.join(swarmDir, 'contract.yaml'),
    ];
    if (!contractPathsEarly.some((p) => fs.existsSync(p))) {
      results.push({
        name: 'contract.yaml',
        ok: false,
        detail: 'missing; swarm needs a contract file to define obligations',
        required: true,
        fixable: true,
        fixHint: 'created default contract.yaml in .swarm/',
      });
    }
    const patchesPathsEarly = [
      path.join(cwd, 'patches.jsonl'),
      path.join(swarmDir, 'patches.jsonl'),
    ];
    if (!patchesPathsEarly.some((p) => fs.existsSync(p))) {
      results.push({
        name: 'patches.jsonl',
        ok: false,
        detail: 'missing; swarm uses patches.jsonl for patch tracking',
        required: false,
        fixable: true,
        fixHint: 'created patches.jsonl with one no-op envelope per default obligation',
      });
    }
    return results;
  }

  // .swarm/ exists — check permissions
  try {
    fs.accessSync(swarmDir, fs.constants.W_OK | fs.constants.R_OK);
  } catch {
    results.push({
      name: '.swarm/ permissions',
      ok: false,
      detail: '.swarm/ is not readable+writable; swarm needs full access',
      required: true,
      fixable: true,
      fixHint: 'fixed .swarm/ permissions to 0755',
    });
  }

  // Check subdirectories
  const subdirs: Array<{ dir: string; label: string; required: boolean }> = [
    { dir: path.join(swarmDir, 'ledger'), label: '.swarm/ledger/', required: true },
    { dir: path.join(swarmDir, 'contracts'), label: '.swarm/contracts/', required: true },
    { dir: path.join(swarmDir, 'snapshots'), label: '.swarm/snapshots/', required: false },
  ];

  for (const { dir, label, required } of subdirs) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      results.push({
        name: label,
        ok: false,
        detail: `missing; swarm stores data here`,
        required,
        fixable: true,
        fixHint: `created ${label} directory`,
      });
    }
  }

  // Check for stale lock files
  const locksDir = path.join(swarmDir, 'locks');
  if (fs.existsSync(locksDir) && fs.statSync(locksDir).isDirectory()) {
    const lockFiles = fs.readdirSync(locksDir);
    if (lockFiles.length > 0) {
      results.push({
        name: 'stale lock files',
        ok: false,
        detail: `${lockFiles.length} lock file(s) found in .swarm/locks/; may indicate interrupted runs`,
        required: false,
        fixable: true,
        fixHint: `removed ${lockFiles.length} stale lock file(s) from .swarm/locks/`,
      });
    }
  }

  // Check contract.yaml exists (at project root or .swarm/)
  const contractPaths = [
    path.join(cwd, 'contract.yaml'),
    path.join(swarmDir, 'contract.yaml'),
  ];
  const hasContract = contractPaths.some((p) => fs.existsSync(p));
  if (!hasContract) {
    results.push({
      name: 'contract.yaml',
      ok: false,
      detail: 'missing; swarm needs a contract file to define obligations',
      required: true,
      fixable: true,
      fixHint: 'created default contract.yaml in .swarm/',
    });
  }

  // Check patches.jsonl exists (at project root or .swarm/)
  const patchesPaths = [
    path.join(cwd, 'patches.jsonl'),
    path.join(swarmDir, 'patches.jsonl'),
  ];
  const hasPatches = patchesPaths.some((p) => fs.existsSync(p));
  if (!hasPatches) {
    results.push({
      name: 'patches.jsonl',
      ok: false,
      detail: 'missing; swarm uses patches.jsonl for patch tracking',
      required: false,
      fixable: true,
      fixHint: 'created patches.jsonl with one no-op envelope per default obligation',
    });
  }

  return results;
}

/** Default contract obligations for auto-fix. patches.jsonl is scaffolded
 *  with enough no-op envelopes per obligation to cover the worst-case
 *  tournament dispatch (candidatesPerRound * roundCap), so the
 *  deterministic session never trips queue-exhaustion immediately after
 *  `doctor --fix`. */
const DEFAULT_OBLIGATIONS: ReadonlyArray<{ type: string; command: string }> = [
  { type: 'build-must-pass', command: 'npm run build' },
  { type: 'test-must-pass', command: 'npm test' },
];
const DEFAULT_PATCH_LINE = '{"patch":"no-op","source":"swarm-doctor"}';
const DEFAULT_CONTRACT =
  ['obligations:', ...DEFAULT_OBLIGATIONS.flatMap((o) => [`  - type: ${o.type}`, `    command: ${o.command}`])].join('\n') +
  '\n';
function defaultPatchEnvelopeCount(obligationType: string): number {
  const cfg = DEFAULT_TOURNAMENT_CONFIG[obligationType as ObligationV1['type']];
  if (!cfg) return 1;
  return Math.max(1, cfg.candidatesPerRound * Math.min(cfg.roundCap, 3));
}
const DEFAULT_PATCHES =
  DEFAULT_OBLIGATIONS.flatMap((o) =>
    Array.from({ length: defaultPatchEnvelopeCount(o.type) }, () => DEFAULT_PATCH_LINE),
  ).join('\n') + '\n';

/**
 * Attempt to auto-fix a probe result. Returns true if the fix was applied.
 */
function applyFix(r: ProbeResult, cwd: string): boolean {
  const swarmDir = path.join(cwd, '.swarm');

  try {
    if (r.name === '.swarm/ directory') {
      fs.mkdirSync(swarmDir, { recursive: true });
      return true;
    }

    if (r.name === '.swarm/ permissions') {
      fs.chmodSync(swarmDir, 0o755);
      return true;
    }

    if (r.name === '.swarm/ledger/') {
      fs.mkdirSync(path.join(swarmDir, 'ledger'), { recursive: true });
      return true;
    }

    if (r.name === '.swarm/contracts/') {
      fs.mkdirSync(path.join(swarmDir, 'contracts'), { recursive: true });
      return true;
    }

    if (r.name === '.swarm/snapshots/') {
      fs.mkdirSync(path.join(swarmDir, 'snapshots'), { recursive: true });
      return true;
    }

    if (r.name === 'stale lock files') {
      const locksDir = path.join(swarmDir, 'locks');
      if (fs.existsSync(locksDir)) {
        const lockFiles = fs.readdirSync(locksDir);
        for (const f of lockFiles) {
          fs.rmSync(path.join(locksDir, f), { force: true });
        }
      }
      return true;
    }

    if (r.name === 'contract.yaml') {
      // Create in .swarm/contract.yaml by default
      const contractPath = path.join(swarmDir, 'contract.yaml');
      if (!fs.existsSync(swarmDir)) {
        fs.mkdirSync(swarmDir, { recursive: true });
      }
      fs.writeFileSync(contractPath, DEFAULT_CONTRACT, 'utf8');
      return true;
    }

    if (r.name === 'patches.jsonl') {
      // Scaffold one envelope per default obligation so `swarm run` does
      // not hit queue-exhaustion immediately after `doctor --fix`.
      const patchesPath = path.join(swarmDir, 'patches.jsonl');
      if (!fs.existsSync(swarmDir)) {
        fs.mkdirSync(swarmDir, { recursive: true });
      }
      fs.writeFileSync(patchesPath, DEFAULT_PATCHES, 'utf8');
      return true;
    }
  } catch (err) {
    logger.warn(`  FIX FAILED: could not auto-fix "${r.name}": ${(err as Error).message}`);
    return false;
  }

  // Not fixable by us
  return false;
}