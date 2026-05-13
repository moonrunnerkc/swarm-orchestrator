import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../logger';
import { readContract } from '../../contract/serializer';
import {
  HashChainedLedger,
  ChainTamperedError,
  readEntries,
  verifyChainEntries,
} from '../../ledger/ledger';
import {
  MemoStore,
} from '../../ledger/memoization';
import { deriveResumeState, ResumeError } from '../../ledger/resume';
import type { RunResumedEntry } from '../../ledger/types';
import { createDefaultRegistry, PersonaRegistry } from '../../persona/persona-registry';
import { runPopulation } from '../../population/manager';
import {
  buildSession as buildSessionFromFactory,
  type SessionProvider,
  resolveSessionProvider,
} from '../../session/factory';
import { cacheHitRate, effectiveInputTokens, type Session } from '../../session/types';
import { createDefaultRuntime, WasmRuntime } from '../../wasm';
import { estimateUsageCostUsd } from './run-handler';
import {
  applyLocalProviderFlag,
  emptyLocalProviderFlagValues,
  isLocalProviderFlag,
  resolveEffectiveLocalProvider,
  type LocalProviderFlagValues,
} from './local-provider-flags';
import { loadProviderConfig } from '../../config/provider-config';
import { formatGrammarWarning, resolveGrammarForConsumer } from './grammar-resolve';

const logger = getLogger('cli:v8:resume');

/** Parsed flags for `swarm v8 resume`. */
export interface ResumeFlags {
  runId: string;
  ledgerPath: string | null;
  contractPath: string | null;
  repoRoot: string;
  sessionKind: SessionProvider;
  model: string | null;
  apiKey: string | null;
  /** Watched directory for deterministic-session patch envelopes. */
  externalPatchesDir: string | null;
  /** JSONL queue file for deterministic-session patch envelopes. */
  externalPatchesQueue: string | null;
  /** When true, the deterministic session reads patches from stdin. */
  externalPatchesStdin: boolean;
  /** Per-call timeout in ms for deterministic-session reads. */
  externalPatchesTimeoutMs: number | null;
  commandTimeoutMs: number | null;
  resultPath: string | null;
  mode: 'single' | 'tournament';
  candidates: number | null;
  /** Phase 5: enable the WASM deterministic floor on resume. Default true. */
  deterministic: boolean;
  /** Phase 6: enable streaming verification on resume. Default true. */
  streaming: boolean;
  /** Phase 6: enable post-merge integration check on resume. Default true. */
  postMerge: boolean;
  /** Phase 6: enable the pre-generation skip pass on resume. Default true. */
  preGeneration: boolean;
  /** Phase 6: comma-separated forbidden-import names. */
  forbiddenImports: string[];
  /**
   * Hard cost ceiling in USD. After the run completes, if Anthropic-priced
   * spend from `totalUsage` exceeds the cap, the CLI exits 6
   * (cost-cap-exceeded). Wired by the GitHub Action's `cost-cap` input.
   */
  costCapUsd: number | null;
  /** Local-provider flag values; consumed only when `sessionKind === 'local'`. */
  local: LocalProviderFlagValues;
  /** Tracks which provider fields were set by an explicit `--<flag>` token. */
  flagsSource: { sessionFromFlag: boolean };
}

/** Test seam: lets tests inject a custom session, registry, or WASM runtime. */
export interface ResumeHandlerInjections {
  session?: Session;
  registry?: PersonaRegistry;
  /** Phase 5: override the deterministic-floor runtime. */
  wasmRuntime?: WasmRuntime;
}

const DEFAULT_PROJECT_CONTEXT_PREAMBLE =
  'You are a persona inside the swarm-orchestrator v8 population. ' +
  'Multiple personas share this prefix; per-call instructions follow.';

/**
 * Implementation of `swarm v8 resume <run-id> [flags]`.
 *
 * Returns an exit code:
 *   0 — every remaining obligation satisfied (or all already satisfied)
 *   1 — argv parsing or runtime error
 *   2 — at least one obligation failed verification
 *   3 — missing API key for the default session
 *   4 — ledger chain is tampered; resume aborts
 *   5 — resume preconditions not met (no matching prior run, etc.)
 */
export async function handleResume(
  argv: string[],
  injections: ResumeHandlerInjections = {},
): Promise<number> {
  let flags: ResumeFlags;
  try {
    flags = parseResumeFlags(argv);
  } catch (err) {
    logger.error((err as Error).message);
    printResumeUsage();
    return 1;
  }

  const repoRoot = path.resolve(flags.repoRoot);
  const ledgerPath = flags.ledgerPath
    ? path.resolve(flags.ledgerPath)
    : path.join(repoRoot, '.swarm', 'ledger', `${flags.runId}.jsonl`);
  if (!fs.existsSync(ledgerPath)) {
    logger.error(`ledger not found at ${ledgerPath}`);
    return 1;
  }

  // Verify the chain BEFORE reading any decisions out of it. Tampered
  // ledgers are not a valid resume source.
  let priorEntries: ReturnType<typeof readEntries>;
  try {
    priorEntries = readEntries(ledgerPath);
    verifyChainEntries(priorEntries);
  } catch (err) {
    if (err instanceof ChainTamperedError) {
      logger.error(`ledger chain integrity check failed at line ${err.lineNumber}: ${err.message}`);
      return 4;
    }
    logger.error(`failed to read ledger ${ledgerPath}: ${(err as Error).message}`);
    return 1;
  }

  // Resolve the contract directory. Default discovery: walk back the
  // ledger to find a run-started entry whose contractId we can map to
  // `<repo>/.swarm/contracts/<id>/`.
  let contractPath = flags.contractPath;
  if (contractPath === null) {
    const inferred = inferContractPath(repoRoot, priorEntries);
    if (inferred === null) {
      logger.error(
        'could not infer contract path; pass --contract <dir> pointing at the contract used for the prior run',
      );
      return 1;
    }
    contractPath = inferred;
  }

  let contract;
  try {
    contract = readContract(contractPath);
  } catch (err) {
    logger.error(`failed to read contract at ${contractPath}: ${(err as Error).message}`);
    return 1;
  }

  let resumeState;
  try {
    resumeState = deriveResumeState(priorEntries, contract);
  } catch (err) {
    if (err instanceof ResumeError) {
      logger.error(`resume precondition failed (${err.code}): ${err.message}`);
      return 5;
    }
    logger.error(`failed to derive resume state: ${(err as Error).message}`);
    return 1;
  }

  logger.info(`resume id:     ${flags.runId}`);
  logger.info(`contract:      ${contractPath}`);
  logger.info(`contract hash: ${resumeState.contractHash}`);
  logger.info(`already satisfied: ${resumeState.satisfiedIndexes.size}/${contract.obligations.length}`);
  logger.info(`pending:       ${resumeState.pendingIndexes.size}`);
  logger.info(`prior failed:  ${resumeState.failedIndexes.size} (will retry)`);

  // Open the ledger for append. The constructor verifies the chain
  // again and inherits the next seq number from the on-disk tail.
  const ledger = new HashChainedLedger(ledgerPath, flags.runId);

  ledger.append<RunResumedEntry>({
    type: 'run-resumed',
    contractId: contract.manifest.contractId,
    contractHash: contract.manifest.contractHash,
    resumeOf: resumeState.resumeOf,
    alreadySatisfied: resumeState.satisfiedIndexes.size,
    pending: resumeState.pendingIndexes.size,
  });

  const projectContext = renderProjectContext(contract.manifest.goal, repoRoot);

  // Precedence chain: flag > env > config > default. Fold config
  // fallback into any local-provider field still null after the flag
  // and env parsed at parseResumeFlags time; do the same for the
  // session provider when neither the flag nor the env explicitly set
  // it.
  try {
    const providerConfig = loadProviderConfig(repoRoot);
    flags.local = resolveEffectiveLocalProvider(flags.local, providerConfig.local);
    if (
      providerConfig.session &&
      !flags.flagsSource.sessionFromFlag &&
      process.env['SESSION_PROVIDER'] === undefined
    ) {
      flags.sessionKind = providerConfig.session;
    }
  } catch (err) {
    logger.error((err as Error).message);
    return 1;
  }

  let session: Session;
  try {
    session = injections.session ?? buildSession(flags, projectContext);
  } catch (err) {
    logger.error((err as Error).message);
    return 3;
  }

  const registry = injections.registry ?? createDefaultRegistry();
  const memoStore = new MemoStore(priorEntries);
  const wasmRuntime = injections.wasmRuntime ?? (flags.deterministic ? createDefaultRuntime() : undefined);

  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot,
    registry,
    session,
    ledger,
    mode: flags.mode,
    skipObligationIndexes: resumeState.satisfiedIndexes,
    memoStore,
    preGeneration: flags.preGeneration,
    postMerge: flags.postMerge,
  };
  if (flags.streaming) {
    runOptions.streaming = { forbiddenImports: flags.forbiddenImports };
  }
  if (wasmRuntime) runOptions.wasmRuntime = wasmRuntime;
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
  logger.info(`run id:        ${flags.runId} (resumed)`);
  logger.info(`mode:          ${result.mode}`);
  logger.info(`obligations:   ${result.satisfied}/${result.outcomes.length + result.memoizedObligations} satisfied`);
  logger.info(`memoized:      ${result.memoizedObligations} obligations skipped`);
  logger.info(`verifier saved:${result.verifierCallsSavedByMemoization} calls`);
  logger.info(`deterministic: ${result.deterministicObligations} satisfied / ${result.deterministicReroutes} rerouted`);
  logger.info(`pre-verified:  ${result.preVerifiedObligations} obligations`);
  logger.info(
    `streaming:     ${result.streamingAbortedCandidates} aborted (${result.streamingCharsBeforeAbort} chars before abort)`,
  );
  if (result.postMerge) {
    logger.info(
      `post-merge:    ${result.postMerge.passed ? 'PASS' : 'FAIL'} (${result.postMerge.failedCount}/${result.postMerge.obligationCount} regressed)`,
    );
  }
  logger.info(`tokens (in):   ${result.totalUsage.inputTokens} std + ${result.totalUsage.cacheReadTokens} cache-read + ${result.totalUsage.cacheCreationTokens} cache-write`);
  logger.info(`effective in:  ${eff.toFixed(2)} tokens`);
  logger.info(`tokens (out):  ${result.totalUsage.outputTokens}`);
  logger.info(`cache hit:     ${(rate * 100).toFixed(1)}%`);
  logger.info(`wall time:     ${result.wallTimeMs}ms`);
  logger.info(`ledger:        ${ledgerPath}`);

  if (flags.resultPath) {
    writeResultFile(flags.resultPath, {
      runId: flags.runId,
      resumeOf: resumeState.resumeOf,
      contractId: contract.manifest.contractId,
      contractHash: contract.manifest.contractHash,
      mode: result.mode,
      obligationCount: contract.obligations.length,
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

  if (flags.costCapUsd !== null) {
    const spentUsd = estimateUsageCostUsd(result.totalUsage);
    logger.info(`cost cap:      $${flags.costCapUsd.toFixed(4)} USD (spent: $${spentUsd.toFixed(4)} USD)`);
    if (spentUsd > flags.costCapUsd) {
      logger.error(
        `cost cap $${flags.costCapUsd.toFixed(4)} exceeded; estimated spend $${spentUsd.toFixed(4)}`,
      );
      return 6;
    }
  }

  return result.failed === 0 ? 0 : 2;
}

/**
 * Walk a ledger entry list backwards to find a `run-started` entry, then
 * try `<repo>/.swarm/contracts/<contractId>/`. Returns null when no
 * matching directory exists.
 */
function inferContractPath(
  repoRoot: string,
  entries: ReturnType<typeof readEntries>,
): string | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const e = entries[i];
    if (e?.type === 'run-started') {
      const candidate = path.join(repoRoot, '.swarm', 'contracts', e.contractId);
      if (fs.existsSync(path.join(candidate, 'manifest.json'))) {
        return candidate;
      }
    }
  }
  return null;
}

function buildSession(flags: ResumeFlags, projectContext: string): Session {
  const resolution = resolveGrammarForConsumer('session', flags.local.grammar);
  // Only the local session reads `localGrammar`; emitting a warning when
  // the deterministic or anthropic branch would ignore the value would be
  // misleading.
  if (resolution.coercion && flags.sessionKind === 'local') {
    process.stderr.write(formatGrammarWarning(resolution.coercion) + '\n');
  }
  const opts: Parameters<typeof buildSessionFromFactory>[0] = {
    provider: flags.sessionKind,
    projectContext,
    apiKey: flags.apiKey,
    model: flags.model,
    externalPatchesDir: flags.externalPatchesDir,
    externalPatchesQueue: flags.externalPatchesQueue,
    externalPatchesStdin: flags.externalPatchesStdin,
    externalPatchesTimeoutMs: flags.externalPatchesTimeoutMs,
    localBackend: flags.local.backend,
    localBaseUrl: flags.local.baseUrl,
    localModel: flags.local.modelSession,
    localGrammar: resolution.effective,
    localSeed: flags.local.seed,
    localApiKey: flags.local.apiKey,
  };
  if (flags.local.personaModelMap) opts.localPersonaModelMap = flags.local.personaModelMap;
  return buildSessionFromFactory(opts);
}

/** Build the static project-context prefix the session caches. */
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

export function parseResumeFlags(argv: string[]): ResumeFlags {
  const positionals: string[] = [];
  const flags: ResumeFlags = {
    runId: '',
    ledgerPath: null,
    contractPath: null,
    repoRoot: process.cwd(),
    sessionKind: resolveSessionProvider(null),
    model: null,
    apiKey: null,
    externalPatchesDir: process.env.EXTERNAL_PATCHES_DIR ?? null,
    externalPatchesQueue: process.env.EXTERNAL_PATCHES_QUEUE ?? null,
    externalPatchesStdin: false,
    externalPatchesTimeoutMs: null,
    commandTimeoutMs: null,
    resultPath: null,
    mode: 'single',
    candidates: null,
    deterministic: true,
    streaming: true,
    postMerge: true,
    preGeneration: true,
    forbiddenImports: [],
    costCapUsd: null,
    local: emptyLocalProviderFlagValues(),
    flagsSource: { sessionFromFlag: false },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (isLocalProviderFlag(arg)) {
      i = applyLocalProviderFlag(argv, i, flags.local, (raw) => path.resolve(flags.repoRoot, raw));
    } else if (arg === '--ledger') {
      flags.ledgerPath = requireValue(argv, ++i, '--ledger');
    } else if (arg === '--contract') {
      flags.contractPath = requireValue(argv, ++i, '--contract');
    } else if (arg === '--repo-root') {
      flags.repoRoot = requireValue(argv, ++i, '--repo-root');
    } else if (arg === '--session') {
      const v = requireValue(argv, ++i, '--session');
      flags.sessionKind = resolveSessionProvider(v);
      flags.flagsSource.sessionFromFlag = true;
    } else if (arg === '--external-patches-dir') {
      flags.externalPatchesDir = requireValue(argv, ++i, '--external-patches-dir');
    } else if (arg === '--external-patches-queue') {
      flags.externalPatchesQueue = requireValue(argv, ++i, '--external-patches-queue');
    } else if (arg === '--external-patches-stdin') {
      flags.externalPatchesStdin = true;
    } else if (arg === '--external-patches-timeout-ms') {
      const raw = requireValue(argv, ++i, '--external-patches-timeout-ms');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(
          `invalid --external-patches-timeout-ms "${raw}"; must be a non-negative integer`,
        );
      }
      flags.externalPatchesTimeoutMs = n;
    } else if (arg === '--model') {
      flags.model = requireValue(argv, ++i, '--model');
    } else if (arg === '--api-key') {
      flags.apiKey = requireValue(argv, ++i, '--api-key');
    } else if (arg === '--command-timeout-ms') {
      const raw = requireValue(argv, ++i, '--command-timeout-ms');
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --command-timeout-ms "${raw}"; must be a positive integer`);
      }
      flags.commandTimeoutMs = n;
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
    } else if (arg === '--cost-cap') {
      const raw = requireValue(argv, ++i, '--cost-cap');
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --cost-cap "${raw}"; must be a positive number (USD)`);
      }
      flags.costCapUsd = n;
    } else if (arg === '--help' || arg === '-h') {
      printResumeUsage();
      throw new Error('help requested');
    } else if (arg.startsWith('--')) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length === 0) {
    throw new Error('missing run id: usage `swarm v8 resume <run-id> [flags]`');
  }
  if (positionals.length > 1) {
    throw new Error(`too many positionals: ${positionals.join(' ')}`);
  }
  flags.runId = positionals[0] ?? '';
  return flags;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const v = argv[index];
  if (v === undefined || v.startsWith('--')) {
    throw new Error(`flag ${flag} requires a value`);
  }
  return v;
}

function writeResultFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function printResumeUsage(): void {
  process.stderr.write(
    [
      'usage: swarm v8 resume <run-id> [flags]',
      '',
      'flags:',
      '  --ledger <path>              ledger jsonl path (default .swarm/ledger/<run-id>.jsonl)',
      '  --contract <dir>             contract dir (default inferred from ledger)',
      '  --repo-root <path>           project root (default cwd)',
      '  --session <name>             deterministic | local | anthropic (default deterministic)',
      '  --external-patches-dir <p>   watched dir of patch envelopes (deterministic session)',
      '  --external-patches-queue <p> JSONL queue of patch envelopes (deterministic session)',
      '  --external-patches-stdin     read patch envelopes from stdin (deterministic session)',
      '  --model <id>                 model id override',
      '  --api-key <key>              Anthropic API key override',
      '  --local-backend <name>       openai-compatible | ollama | llama-cpp | vllm',
      '  --local-base-url <url>       local-provider base URL',
      '  --local-model-session <id>   local-provider session model id',
      '  --local-persona-model-map <p|json>  inline JSON or path to JSON/YAML persona→model map',
      '  --local-grammar <mode>       auto | gbnf | json-schema | outlines | none (default auto)',
      '  --local-request-timeout-ms <n>  per-call timeout (default 120000)',
      '  --local-max-concurrency <n>  concurrent local-backend requests (default 1)',
      '  --local-api-key <key>        local-backend API key (when required)',
      '  --local-seed <n>             sampling seed (default 0)',
      '  --command-timeout-ms <ms>    per-command timeout (default 300000)',
      '  --result <path>              write structured run result to this JSON file',
      '  --mode single|tournament     execution mode (default single)',
      '  --candidates <n>             tournament candidates per round (1-8)',
      '  --no-deterministic           disable the WASM deterministic floor (default: enabled)',
      '  --no-streaming               disable Phase 6 streaming verification (default: enabled)',
      '  --no-pre-generation          disable Phase 6 pre-generation skip pass (default: enabled)',
      '  --no-post-merge              disable Phase 6 post-merge integration check (default: enabled)',
      '  --forbid-import <names>      comma-separated module names the streaming verifier rejects',
      '  --cost-cap <usd>             hard cost ceiling in USD; exit 6 if exceeded',
      '  --help, -h                   show this message',
      '',
    ].join('\n'),
  );
}
