import * as crypto from 'crypto';
import * as path from 'path';
import { getLogger } from '../../logger';
import { readContract } from '../../contract/serializer';
import { JsonlLedger } from '../../ledger/jsonl-ledger';
import { createDefaultRegistry, PersonaRegistry } from '../../persona/persona-registry';
import { runPopulation } from '../../population/manager';
import {
  buildSession as buildSessionFromFactory,
  type SessionProvider,
  SESSION_PROVIDERS,
  resolveSessionProvider,
} from '../../session/factory';
import {
  buildLocalProviderFlagValues,
  LOCAL_PROVIDER_FLAG_SCHEMA,
  resolveEffectiveLocalProvider,
  type LocalProviderFlagValues,
} from './local-provider-flags';
import {
  readBoolean,
  readString,
  requireEnum,
  requireNonNegativeInt,
  requirePositiveInt,
  runParseArgs,
  type ParseArgsOptions,
} from './argv-schema';
import { loadProviderConfig } from '../../config/provider-config';
import { formatGrammarWarning, resolveGrammarForConsumer } from './grammar-resolve';
import {
  cacheHitRate,
  effectiveInputTokens,
  type Session,
} from '../../session/types';
import { createDefaultRuntime, WasmRuntime } from '../../wasm';
import {
  defaultAdapterRegistry,
  AdapterRegistry,
} from '../../falsification/adapters';
import { parseSnapshotPolicy } from '../../population/snapshot-cleanup';
import { LiveCostTracker } from '../../verification/live-cost-tracker';
import { FalsifierScheduler } from '../../falsification/scheduler';

const logger = getLogger('cli:v8:run');

/** Parsed flags for `swarm v8 run`. */
export interface RunFlags {
  contractPath: string;
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
  ledgerPath: string | null;
  maxObligations: number | null;
  commandTimeoutMs: number | null;
  runId: string | null;
  /** Optional path to write the structured result JSON. */
  resultPath: string | null;
  /**
   * Population mode. `single` dispatches one persona per obligation
   * (the persona registered as the canonical handler for that
   * obligation type) and verifies its candidate immediately. This is
   * the default — it minimizes cost and is sufficient for most
   * goals. `tournament` races multiple candidates per obligation via
   * the Phase 3 tournament loop (`--candidates N`); use it when you
   * want adversarial selection across personas at higher token cost.
   */
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
  /**
   * Live output-token budget. When set, the streaming verifier aborts
   * an in-flight generation as soon as the projected output crosses the
   * budget. Null disables the gate. Token-denominated so the same flag
   * works across providers (Anthropic, local, deterministic).
   */
  tokenBudget: number | null;
  /**
   * Adapter-reintegration: feature flag controlling the falsification
   * dispatcher (`src/falsification/dispatcher.ts`). Default `'on'`. When
   * on, every registered adapter that handles the obligation type is
   * dispatched after the producer's verifier marks the patch satisfied;
   * a confirmed counter-example flips the obligation status to failed
   * and appends a `falsification-call` ledger entry with cost and yield.
   * `--falsifiers off` bypasses the dispatcher entirely so runs that
   * don't want to spend on adapter calls (or whose target environment
   * lacks the underlying CLIs) can opt out.
   */
  falsifiers: 'on' | 'off';
  /**
   * Phase 7: snapshot sidecar cleanup policy spec. Parsed via
   * `parseSnapshotPolicy`. Empty string uses the default
   * (`retain-on-failure`).
   */
  snapshotCleanup: string;
  /**
   * Phase 7: adaptive falsifier scheduler. `sequential` (default)
   * preserves registration-order dispatch; `ucb1` enables the bandit.
   */
  falsifierScheduler: 'sequential' | 'ucb1';
  /**
   * Phase 7: override path for the persisted bandit stats. Empty
   * string uses `<repoRoot>/.swarm/falsifier-stats.json`.
   */
  falsifierStatsPath: string;
  /** Local-provider flag values; consumed only when `sessionKind === 'local'`. */
  local: LocalProviderFlagValues;
  /** Tracks which provider fields were set by an explicit `--<flag>` token. */
  flagsSource: { sessionFromFlag: boolean };
}

/** Test seam: lets tests inject a custom session, registry, or WASM runtime. */
export interface RunHandlerInjections {
  session?: Session;
  registry?: PersonaRegistry;
  /** Phase 5: override the deterministic-floor runtime. */
  wasmRuntime?: WasmRuntime;
  /**
   * Adapter-reintegration: override the falsifier registry. Production
   * code calls `defaultAdapterRegistry()`; tests inject a fake registry
   * (or pass `null` to disable adapters even when `--falsifiers on`).
   */
  adapterRegistry?: AdapterRegistry | null;
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

  // Precedence chain: flag > env > config > default. Fold config
  // fallback into any local-provider field still null after the flag
  // and env parsed at parseRunFlags time; do the same for the session
  // provider when neither the flag nor the env explicitly set it.
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
  const ledger = new JsonlLedger(ledgerPath, runId);

  const wasmRuntime = injections.wasmRuntime ?? (flags.deterministic ? createDefaultRuntime() : undefined);

  // Adapter-reintegration: build the falsifier registry the population
  // manager dispatches against after each obligation. Phase 1's flag
  // plumbing in `RunFlags.falsifiers` finally wires through to the run
  // path. Tests can inject a fake (or null) via `injections.adapterRegistry`.
  const adapterRegistry =
    injections.adapterRegistry === null
      ? undefined
      : injections.adapterRegistry ??
        (flags.falsifiers === 'on' ? defaultAdapterRegistry() : undefined);

  const runOptions: Parameters<typeof runPopulation>[0] = {
    contract,
    repoRoot,
    registry,
    session,
    ledger,
    runId,
    mode: flags.mode,
    preGeneration: flags.preGeneration,
    postMerge: flags.postMerge,
    falsifiers: flags.falsifiers,
  };
  if (adapterRegistry) runOptions.adapterRegistry = adapterRegistry;
  if (flags.streaming) {
    runOptions.streaming = { forbiddenImports: flags.forbiddenImports };
  }
  if (wasmRuntime) runOptions.wasmRuntime = wasmRuntime;

  // Phase 7: snapshot cleanup policy. Parsed early so a malformed spec
  // surfaces before we spend tokens.
  if (flags.snapshotCleanup) {
    try {
      runOptions.snapshotCleanupPolicy = parseSnapshotPolicy(flags.snapshotCleanup);
    } catch (err) {
      logger.error((err as Error).message);
      return 1;
    }
  }

  if (flags.tokenBudget !== null) {
    runOptions.costTracker = new LiveCostTracker({ budgetTokens: flags.tokenBudget });
  }

  // Phase 7: adaptive falsifier scheduler. Default sequential preserves
  // historical behavior; ucb1 enables the bandit. Stats persist to
  // `.swarm/falsifier-stats.json` by default; override via flag.
  if (flags.falsifierScheduler === 'ucb1') {
    const statsPath = flags.falsifierStatsPath
      ? path.resolve(flags.falsifierStatsPath)
      : path.join(repoRoot, '.swarm', 'falsifier-stats.json');
    runOptions.falsifierScheduler = new FalsifierScheduler({
      kind: 'ucb1',
      statsPath,
    });
  }

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

  if (flags.tokenBudget !== null) {
    logger.info(`token budget:  ${flags.tokenBudget} output tokens (spent: ${result.totalUsage.outputTokens})`);
  }

  return result.failed === 0 ? 0 : 2;
}

function buildSession(flags: RunFlags, projectContext: string): Session {
  const resolution = resolveGrammarForConsumer('session', flags.local.grammar);
  // Only the local session reads `localGrammar`; the deterministic and
  // anthropic branches ignore it. Emitting a coercion warning for a
  // consumer that isn't reading the value would be misleading.
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

const RUN_SCHEMA: ParseArgsOptions = {
  ...LOCAL_PROVIDER_FLAG_SCHEMA,
  'repo-root': { type: 'string' },
  session: { type: 'string' },
  'external-patches-dir': { type: 'string' },
  'external-patches-queue': { type: 'string' },
  'external-patches-stdin': { type: 'boolean' },
  'external-patches-timeout-ms': { type: 'string' },
  model: { type: 'string' },
  'api-key': { type: 'string' },
  ledger: { type: 'string' },
  'max-obligations': { type: 'string' },
  'command-timeout-ms': { type: 'string' },
  'run-id': { type: 'string' },
  result: { type: 'string' },
  mode: { type: 'string' },
  candidates: { type: 'string' },
  'no-deterministic': { type: 'boolean' },
  'no-streaming': { type: 'boolean' },
  'no-post-merge': { type: 'boolean' },
  'no-pre-generation': { type: 'boolean' },
  'forbid-import': { type: 'string', multiple: true },
  'cost-cap': { type: 'string' },
  falsifiers: { type: 'string' },
  'snapshot-cleanup': { type: 'string' },
  'falsifier-scheduler': { type: 'string' },
  'falsifier-stats-path': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
};

export function parseRunFlags(argv: string[]): RunFlags {
  const { values, positionals } = runParseArgs(argv, RUN_SCHEMA);
  if (readBoolean(values, 'help')) {
    printRunUsage();
    throw new Error('help requested');
  }

  const repoRoot = readString(values, 'repo-root') ?? process.cwd();
  const sessionRaw = readString(values, 'session');
  const modeRaw = readString(values, 'mode');
  const candidatesRaw = readString(values, 'candidates');
  const externalPatchesTimeoutRaw = readString(values, 'external-patches-timeout-ms');
  const maxObligationsRaw = readString(values, 'max-obligations');
  const commandTimeoutRaw = readString(values, 'command-timeout-ms');
  const tokenBudgetRaw = readString(values, 'cost-cap');
  const falsifiersRaw = readString(values, 'falsifiers');
  const falsifierSchedulerRaw = readString(values, 'falsifier-scheduler');
  const forbidImports = values['forbid-import'];

  const forbiddenImports: string[] = [];
  if (Array.isArray(forbidImports)) {
    for (const entry of forbidImports) {
      if (typeof entry !== 'string') continue;
      for (const part of entry.split(',')) {
        const p = part.trim();
        if (p.length > 0) forbiddenImports.push(p);
      }
    }
  }

  const flags: RunFlags = {
    contractPath: '',
    repoRoot,
    sessionKind: resolveSessionProvider(sessionRaw ?? null),
    model: readString(values, 'model') ?? null,
    apiKey: readString(values, 'api-key') ?? null,
    externalPatchesDir: readString(values, 'external-patches-dir') ?? process.env.EXTERNAL_PATCHES_DIR ?? null,
    externalPatchesQueue: readString(values, 'external-patches-queue') ?? process.env.EXTERNAL_PATCHES_QUEUE ?? null,
    externalPatchesStdin: readBoolean(values, 'external-patches-stdin'),
    externalPatchesTimeoutMs: externalPatchesTimeoutRaw !== undefined
      ? requireNonNegativeInt(externalPatchesTimeoutRaw, '--external-patches-timeout-ms')
      : null,
    ledgerPath: readString(values, 'ledger') ?? null,
    maxObligations: maxObligationsRaw !== undefined
      ? requirePositiveInt(maxObligationsRaw, '--max-obligations')
      : null,
    commandTimeoutMs: commandTimeoutRaw !== undefined
      ? requirePositiveInt(commandTimeoutRaw, '--command-timeout-ms')
      : null,
    runId: readString(values, 'run-id') ?? null,
    resultPath: readString(values, 'result') ?? null,
    mode: modeRaw !== undefined ? requireEnum(modeRaw, '--mode', ['single', 'tournament'] as const) : 'single',
    candidates: candidatesRaw !== undefined ? parseCandidates(candidatesRaw) : null,
    deterministic: !readBoolean(values, 'no-deterministic'),
    streaming: !readBoolean(values, 'no-streaming'),
    postMerge: !readBoolean(values, 'no-post-merge'),
    preGeneration: !readBoolean(values, 'no-pre-generation'),
    forbiddenImports,
    tokenBudget: tokenBudgetRaw !== undefined ? requirePositiveInt(tokenBudgetRaw, '--cost-cap') : null,
    falsifiers: falsifiersRaw !== undefined ? requireEnum(falsifiersRaw, '--falsifiers', ['on', 'off'] as const) : 'on',
    snapshotCleanup: readString(values, 'snapshot-cleanup') ?? '',
    falsifierScheduler: falsifierSchedulerRaw !== undefined
      ? requireEnum(falsifierSchedulerRaw, '--falsifier-scheduler', ['sequential', 'ucb1'] as const)
      : 'sequential',
    falsifierStatsPath: readString(values, 'falsifier-stats-path') ?? '',
    local: buildLocalProviderFlagValues(values, (raw) => path.resolve(repoRoot, raw)),
    flagsSource: { sessionFromFlag: sessionRaw !== undefined },
  };

  if (positionals.length === 0) {
    throw new Error('missing contract path: usage `swarm v8 run <contract-path> [flags]`');
  }
  if (positionals.length > 1) {
    throw new Error(`too many positionals: ${positionals.join(' ')}`);
  }
  flags.contractPath = path.resolve(positionals[0] ?? '');
  return flags;
}

function parseCandidates(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 8) {
    throw new Error(`invalid --candidates "${raw}"; must be a positive integer ≤ 8`);
  }
  return n;
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
      `  --session <name>             ${SESSION_PROVIDERS.join(' | ')} (default deterministic)`,
      '  --external-patches-dir <p>   watched dir of patch envelopes (deterministic session)',
      '  --external-patches-queue <p> JSONL queue of patch envelopes (deterministic session)',
      '  --external-patches-stdin     read patch envelopes from stdin (deterministic session)',
      '  --external-patches-timeout-ms <n>  per-call wait (default 30000 for complete)',
      '  --model <id>                 model id override (anthropic session)',
      '  --api-key <key>              API key override (anthropic session)',
      '  --local-backend <name>       openai-compatible | ollama | llama-cpp | vllm',
      '  --local-base-url <url>       local-provider base URL',
      '  --local-model-session <id>   local-provider session model id',
      '  --local-persona-model-map <p|json>  inline JSON or path to JSON/YAML persona→model map',
      '  --local-grammar <mode>       auto | gbnf | json-schema | outlines | none (default auto)',
      '  --local-request-timeout-ms <n>  per-call timeout for local backend (default 120000)',
      '  --local-max-concurrency <n>  concurrent local-backend requests (default 1)',
      '  --local-api-key <key>        local-backend API key (when required)',
      '  --local-seed <n>             sampling seed for local provider (default 0)',
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
      '  --cost-cap <n>               live output-token ceiling (positive integer); aborts streams once projected output crosses it',
      '  --snapshot-cleanup <spec>    snapshot policy (retain-on-failure|always|never|',
      '                               retain-last:<n>|max-age:<duration>|max-disk:<size>)',
      '  --falsifier-scheduler <kind> sequential (default) | ucb1 (adaptive bandit)',
      '  --falsifier-stats-path <p>   override path for persisted bandit stats',
      '  --help, -h                   show this message',
      '',
    ].join('\n'),
  );
}
