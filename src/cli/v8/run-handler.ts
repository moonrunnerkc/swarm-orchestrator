import * as crypto from 'crypto';
import * as path from 'path';
import { getLogger } from '../../logger';
import { readContract } from '../../contract/serializer';
import { JsonlLedger } from '../../ledger/jsonl-ledger';
import { createDefaultRegistry, PersonaRegistry } from '../../persona/persona-registry';
import { runPopulation } from '../../population/manager';
import { AnthropicSession } from '../../session/anthropic-session';
import { StubSession } from '../../session/stub-session';
import { cacheHitRate, effectiveInputTokens, type Session } from '../../session/types';
import { createDefaultRuntime, WasmRuntime } from '../../wasm';

const logger = getLogger('cli:v8:run');

/** Parsed flags for `swarm v8 run`. */
export interface RunFlags {
  contractPath: string;
  repoRoot: string;
  sessionKind: 'anthropic' | 'stub';
  model: string | null;
  apiKey: string | null;
  ledgerPath: string | null;
  maxObligations: number | null;
  commandTimeoutMs: number | null;
  runId: string | null;
  /** Optional path to write the structured result JSON. */
  resultPath: string | null;
  /** Population mode: 'single' (Phase 2) or 'tournament' (Phase 3 default). */
  mode: 'single' | 'tournament';
  /** Optional override for tournament candidates per round. */
  candidates: number | null;
  /**
   * Phase 5: when false, the WASM deterministic runtime is not
   * supplied to the population manager. Default true — the §8 floor
   * is enabled by default. Useful for benchmarks that compare
   * tournament-only vs. deterministic-floor cost.
   */
  deterministic: boolean;
  /**
   * Phase 6: when false, the streaming-verifier path is disabled and
   * single-mode generation falls back to non-streaming
   * `session.complete()`. Default true.
   */
  streaming: boolean;
  /**
   * Phase 6: when false, the post-merge integration check is skipped.
   * Default true.
   */
  postMerge: boolean;
  /**
   * Phase 6: when false, the pre-generation verification pass is
   * skipped. Default true.
   */
  preGeneration: boolean;
  /**
   * Phase 6: comma-separated forbidden-import names. The streaming
   * verifier aborts mid-generation when any is observed in the partial
   * output. Empty list disables the assertion.
   */
  forbiddenImports: string[];
}

/** Test seam: lets tests inject a custom session, registry, or WASM runtime. */
export interface RunHandlerInjections {
  session?: Session;
  registry?: PersonaRegistry;
  /** Phase 5: override the deterministic-floor runtime. */
  wasmRuntime?: WasmRuntime;
}

const DEFAULT_PROJECT_CONTEXT_PREAMBLE =
  'You are a persona inside the swarm-orchestrator v8 population. ' +
  'Multiple personas share this prefix; per-call instructions follow.';

/**
 * Implementation of `swarm v8 run <contract-path> [flags]`. Returns an
 * exit code:
 *   0 — every obligation satisfied
 *   1 — argv parsing or runtime error
 *   2 — at least one obligation failed verification
 *   3 — missing API key for the default session
 */
export async function handleRun(
  argv: string[],
  injections: RunHandlerInjections = {},
): Promise<number> {
  let flags: RunFlags;
  try {
    flags = parseRunFlags(argv);
  } catch (err) {
    logger.error((err as Error).message);
    printRunUsage();
    return 1;
  }

  let contract;
  try {
    contract = readContract(flags.contractPath);
  } catch (err) {
    logger.error(
      `failed to read contract at ${flags.contractPath}: ${(err as Error).message}`,
    );
    return 1;
  }

  const repoRoot = path.resolve(flags.repoRoot);
  const runId = flags.runId ?? `run-${Date.now().toString(36)}-${randomToken(6)}`;
  const ledgerPath = flags.ledgerPath ?? path.join(repoRoot, '.swarm', 'ledger', `${runId}.jsonl`);

  const projectContext = renderProjectContext(contract.manifest.goal, repoRoot);

  let session: Session;
  try {
    session = injections.session ?? buildSession(flags, projectContext);
  } catch (err) {
    logger.error((err as Error).message);
    return 3;
  }

  const registry = injections.registry ?? createDefaultRegistry();
  const ledger = new JsonlLedger(ledgerPath, runId);

  const wasmRuntime = injections.wasmRuntime ?? (flags.deterministic ? createDefaultRuntime() : undefined);

  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot,
    registry,
    session,
    ledger,
    mode: flags.mode,
    preGeneration: flags.preGeneration,
    postMerge: flags.postMerge,
  };
  if (flags.streaming) {
    runOptions.streaming = { forbiddenImports: flags.forbiddenImports };
  }
  if (wasmRuntime) runOptions.wasmRuntime = wasmRuntime;
  if (flags.maxObligations !== null) runOptions.maxObligations = flags.maxObligations;
  if (flags.commandTimeoutMs !== null) runOptions.commandTimeoutMs = flags.commandTimeoutMs;
  if (flags.candidates !== null && flags.mode === 'tournament') {
    runOptions.tournamentConfig = {
      'file-must-exist': {
        candidatesPerRound: flags.candidates,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.2, 0.5, 0.8],
      },
      'build-must-pass': {
        candidatesPerRound: flags.candidates,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.1, 0.4, 0.7],
      },
      'test-must-pass': {
        candidatesPerRound: flags.candidates,
        roundCap: 3,
        scoreThreshold: 0.5,
        temperatureSchedule: [0.1, 0.4, 0.7],
      },
    };
  }

  const result = await runPopulation(runOptions);

  const eff = effectiveInputTokens(result.totalUsage);
  const rate = cacheHitRate(result.totalUsage);
  logger.info(`run id:        ${runId}`);
  logger.info(`contract id:   ${contract.manifest.contractId}`);
  logger.info(`mode:          ${result.mode}`);
  logger.info(`obligations:   ${result.satisfied}/${result.outcomes.length} satisfied`);
  logger.info(
    `deterministic: ${result.deterministicObligations} satisfied / ${result.deterministicReroutes} rerouted`,
  );
  logger.info(`pre-verified:  ${result.preVerifiedObligations} obligations`);
  logger.info(
    `streaming:     ${result.streamingAbortedCandidates} aborted (${result.streamingCharsBeforeAbort} chars before abort)`,
  );
  if (result.postMerge) {
    logger.info(
      `post-merge:    ${result.postMerge.passed ? 'PASS' : 'FAIL'} (${result.postMerge.failedCount}/${result.postMerge.obligationCount} regressed)`,
    );
  }
  logger.info(
    `tokens (in):   ${result.totalUsage.inputTokens} std + ${result.totalUsage.cacheReadTokens} cache-read + ${result.totalUsage.cacheCreationTokens} cache-write`,
  );
  logger.info(`effective in:  ${eff.toFixed(2)} tokens`);
  logger.info(`tokens (out):  ${result.totalUsage.outputTokens}`);
  logger.info(`cache hit:     ${(rate * 100).toFixed(1)}%`);
  logger.info(`wall time:     ${result.wallTimeMs}ms`);
  logger.info(`ledger:        ${ledgerPath}`);

  if (flags.resultPath) {
    writeResultFile(flags.resultPath, {
      runId,
      contractId: contract.manifest.contractId,
      contractHash: contract.manifest.contractHash,
      mode: result.mode,
      obligationCount: result.outcomes.length,
      satisfied: result.satisfied,
      failed: result.failed,
      memoizedObligations: result.memoizedObligations,
      verifierCallsSavedByMemoization: result.verifierCallsSavedByMemoization,
      deterministicObligations: result.deterministicObligations,
      deterministicReroutes: result.deterministicReroutes,
      preVerifiedObligations: result.preVerifiedObligations,
      streamingAbortedCandidates: result.streamingAbortedCandidates,
      streamingCharsBeforeAbort: result.streamingCharsBeforeAbort,
      postMerge: result.postMerge,
      totalUsage: result.totalUsage,
      effectiveInputTokens: eff,
      cacheHitRate: rate,
      wallTimeMs: result.wallTimeMs,
      ledgerPath,
      outcomes: result.outcomes.map((o) => ({
        obligationIndex: o.obligationIndex,
        type: o.obligation.type,
        personaId: o.personaId,
        satisfied: o.satisfied,
        detail: o.detail,
        tournament: o.tournament
          ? {
              rounds: o.tournament.rounds.length,
              escalated: o.tournament.escalated,
              bestScore: o.tournament.bestScore,
              winner: o.tournament.winner,
              verifierCallsSavedByMemoization: o.tournament.verifierCallsSavedByMemoization,
            }
          : null,
      })),
    });
  }

  return result.failed === 0 ? 0 : 2;
}

function buildSession(flags: RunFlags, projectContext: string): Session {
  if (flags.sessionKind === 'stub') {
    const opts: ConstructorParameters<typeof StubSession>[0] = { projectContext };
    if (flags.model !== null) opts.model = flags.model;
    return new StubSession(opts);
  }
  const apiKey = flags.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Pass --api-key, set the env var, or use --session stub.',
    );
  }
  const opts: ConstructorParameters<typeof AnthropicSession>[0] = {
    apiKey,
    projectContext,
  };
  if (flags.model !== null) opts.model = flags.model;
  return new AnthropicSession(opts);
}

/**
 * Build the static project-context prefix the session caches. Phase 2's
 * version is intentionally minimal: contract goal + repo root. Phase 3+
 * will fold in per-language toolchain summaries and ledger highlights.
 */
export function renderProjectContext(goal: string, repoRoot: string): string {
  return [
    DEFAULT_PROJECT_CONTEXT_PREAMBLE,
    '',
    `Repository root: ${repoRoot}`,
    `User goal: ${goal}`,
    '',
    'Persona-specific instructions follow this block.',
  ].join('\n');
}

export function parseRunFlags(argv: string[]): RunFlags {
  const positionals: string[] = [];
  const flags: RunFlags = {
    contractPath: '',
    repoRoot: process.cwd(),
    sessionKind: 'anthropic',
    model: null,
    apiKey: null,
    ledgerPath: null,
    maxObligations: null,
    commandTimeoutMs: null,
    runId: null,
    resultPath: null,
    mode: 'single',
    candidates: null,
    deterministic: true,
    streaming: true,
    postMerge: true,
    preGeneration: true,
    forbiddenImports: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--repo-root') {
      flags.repoRoot = requireValue(argv, ++i, '--repo-root');
    } else if (arg === '--session') {
      const v = requireValue(argv, ++i, '--session');
      if (v !== 'anthropic' && v !== 'stub') {
        throw new Error(`invalid --session value "${v}"; expected anthropic | stub`);
      }
      flags.sessionKind = v;
    } else if (arg === '--model') {
      flags.model = requireValue(argv, ++i, '--model');
    } else if (arg === '--api-key') {
      flags.apiKey = requireValue(argv, ++i, '--api-key');
    } else if (arg === '--ledger') {
      flags.ledgerPath = requireValue(argv, ++i, '--ledger');
    } else if (arg === '--max-obligations') {
      const raw = requireValue(argv, ++i, '--max-obligations');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --max-obligations "${raw}"; must be a positive integer`);
      }
      flags.maxObligations = n;
    } else if (arg === '--command-timeout-ms') {
      const raw = requireValue(argv, ++i, '--command-timeout-ms');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --command-timeout-ms "${raw}"; must be a positive integer`);
      }
      flags.commandTimeoutMs = n;
    } else if (arg === '--run-id') {
      flags.runId = requireValue(argv, ++i, '--run-id');
    } else if (arg === '--result') {
      flags.resultPath = requireValue(argv, ++i, '--result');
    } else if (arg === '--mode') {
      const v = requireValue(argv, ++i, '--mode');
      if (v !== 'single' && v !== 'tournament') {
        throw new Error(`invalid --mode value "${v}"; expected single | tournament`);
      }
      flags.mode = v;
    } else if (arg === '--candidates') {
      const raw = requireValue(argv, ++i, '--candidates');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0 || n > 8) {
        throw new Error(`invalid --candidates "${raw}"; must be a positive integer ≤ 8`);
      }
      flags.candidates = n;
    } else if (arg === '--no-deterministic') {
      flags.deterministic = false;
    } else if (arg === '--no-streaming') {
      flags.streaming = false;
    } else if (arg === '--no-post-merge') {
      flags.postMerge = false;
    } else if (arg === '--no-pre-generation') {
      flags.preGeneration = false;
    } else if (arg === '--forbid-import') {
      const v = requireValue(argv, ++i, '--forbid-import');
      for (const part of v.split(',')) {
        const p = part.trim();
        if (p.length > 0) flags.forbiddenImports.push(p);
      }
    } else if (arg === '--help' || arg === '-h') {
      printRunUsage();
      throw new Error('help requested');
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    throw new Error('missing contract path: usage `swarm v8 run <contract-path> [flags]`');
  }
  if (positionals.length > 1) {
    throw new Error(`too many positionals: ${positionals.join(' ')}`);
  }
  flags.contractPath = path.resolve(positionals[0] ?? '');
  return flags;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return v;
}

function randomToken(n: number): string {
  return crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
}

function writeResultFile(filePath: string, payload: unknown): void {
  const fs = require('fs') as typeof import('fs');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function printRunUsage(): void {
  process.stderr.write(
    [
      'usage: swarm v8 run <contract-path> [flags]',
      '',
      'flags:',
      '  --repo-root <path>           project root (default cwd)',
      '  --session anthropic|stub     session kind (default anthropic)',
      '  --model <id>                 model id override',
      '  --api-key <key>              Anthropic API key override',
      '  --ledger <path>              ledger jsonl path (default .swarm/ledger/<run-id>.jsonl)',
      '  --max-obligations <n>        cap on obligations attempted',
      '  --command-timeout-ms <ms>    per-command timeout (default 300000)',
      '  --run-id <id>                run id override (default time-based)',
      '  --result <path>              write structured run result to this JSON file',
      '  --mode single|tournament     execution mode (default single)',
      '  --candidates <n>             tournament candidates per round (1-8, type-default otherwise)',
      '  --no-deterministic           disable the WASM deterministic floor (default: enabled)',
      '  --no-streaming               disable Phase 6 streaming verification (default: enabled)',
      '  --no-pre-generation          disable Phase 6 pre-generation skip pass (default: enabled)',
      '  --no-post-merge              disable Phase 6 post-merge integration check (default: enabled)',
      '  --forbid-import <names>      comma-separated module names the streaming verifier rejects',
      '  --help, -h                   show this message',
      '',
    ].join('\n'),
  );
}
