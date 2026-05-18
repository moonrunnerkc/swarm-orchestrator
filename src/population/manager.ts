import * as crypto from 'crypto';
import type { FinalContract, ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import { MemoStore, obligationKey } from '../ledger/memoization';
import type {
  ObligationAttemptedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationPreVerifiedEntry,
  ObligationRolledBackEntry,
  ObligationSatisfiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
} from '../ledger/types';
import type { AdapterRegistry } from '../falsification/adapters/registry';
import { type FalsifiersFlag } from '../falsification/dispatcher';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import { selectPersonaForState } from '../persona/predicates';
import type { Session, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import { preVerifyObligations } from '../verification/pre-generation';
import { verifyObligation } from '../verification/run-verifier';
import {
  buildAssertions,
  type StreamingAssertion,
  type StreamingVerifierConfig,
} from '../verification/streaming-verifier';
import type { WasmRuntime } from '../wasm/wasm-runtime';
import {
  cleanupSnapshots,
  DEFAULT_SNAPSHOT_POLICY,
  type SnapshotCleanupPolicy,
} from './snapshot-cleanup';
import type { LiveCostTracker } from '../verification/live-cost-tracker';
import type { FalsifierScheduler } from '../falsification/scheduler';
import { getLogger } from '../logger';
import type { TournamentConfig, TournamentResult } from './tournament';
import { dispatchFalsifiersForObligation } from './falsifier-dispatch';
import { dispatchDeterministicFloor } from './deterministic-dispatch';
import { handlePostMerge } from './post-merge-handler';
import { executeSingleMode, type SingleModeOptions } from './single-mode-executor';
import { rollbackObligation } from './rollback';
import { PopulationStateBuilder } from './state';
import { executeTournament } from './tournament-driver';
import { buildRenderContext } from './persona-message';

const log = getLogger('population.manager');

export type PopulationMode = 'single' | 'tournament';

export interface RunPopulationOptions {
  contract: FinalContract;
  repoRoot: string;
  registry: PersonaRegistry;
  session: Session;
  ledger: JsonlLedger;
  runId?: string;
  commandTimeoutMs?: number;
  maxObligations?: number;
  // the v8 CLI defaults to `single`; tournament mode opts in via --mode.
  mode?: PopulationMode;
  tournamentConfig?: Partial<Record<ObligationV1['type'], TournamentConfig>> | undefined;
  skipObligationIndexes?: ReadonlySet<number>;
  memoStore?: MemoStore;
  wasmRuntime?: WasmRuntime;
  strategyTimeoutMs?: number;
  // Tournament candidate generation is intentionally NOT streaming-routed:
  // tournaments race candidates in parallel and mid-stream abort breaks
  // race fairness.
  streaming?: StreamingVerifierConfig;
  preGeneration?: boolean;
  postMerge?: boolean;
  falsifiers?: FalsifiersFlag;
  adapterRegistry?: AdapterRegistry;
  adapterTimeBudgetMs?: number;
  costTracker?: LiveCostTracker;
  snapshotCleanupPolicy?: SnapshotCleanupPolicy;
  falsifierScheduler?: FalsifierScheduler;
}

export interface ObligationOutcome {
  obligationIndex: number;
  obligation: ObligationV1;
  personaId: string | null;
  satisfied: boolean;
  detail: string;
  tournament?: TournamentResult | null;
}

export interface RunPopulationResult {
  outcomes: ObligationOutcome[];
  satisfied: number;
  failed: number;
  totalUsage: SessionUsage;
  wallTimeMs: number;
  mode: PopulationMode;
  memoizedObligations: number;
  verifierCallsSavedByMemoization: number;
  deterministicObligations: number;
  deterministicReroutes: number;
  preVerifiedObligations: number;
  streamingAbortedCandidates: number;
  streamingCharsBeforeAbort: number;
  postMerge: PostMergeRunOutcome | null;
}

export interface PostMergeRunOutcome {
  passed: boolean;
  obligationCount: number;
  failedCount: number;
  outcomes: Array<{
    obligationIndex: number;
    obligationType: string;
    passed: boolean;
    detail: string;
  }>;
}

export async function runPopulation(
  options: RunPopulationOptions,
): Promise<RunPopulationResult> {
  const start = Date.now();
  const { contract, repoRoot, registry, session, ledger, commandTimeoutMs } = options;
  const runId = options.runId ?? ledger.run();
  const cap = options.maxObligations ?? contract.obligations.length;
  // Paths owned by file-must-exist obligations. Subsequent personas must
  // not stomp on the architect's body via their unified diffs.
  const fileMustExistPaths = new Set<string>(
    contract.obligations
      .filter((o): o is typeof o & { type: 'file-must-exist'; path: string } =>
        o.type === 'file-must-exist',
      )
      .map((o) => o.path),
  );
  const mode: PopulationMode = options.mode ?? 'single';
  const builder = new PopulationStateBuilder(contract.obligations);
  const skip = options.skipObligationIndexes ?? new Set<number>();
  const memoStore = options.memoStore;
  const wasmRuntime = options.wasmRuntime;
  const streamingConfig = options.streaming;
  const streamingAssertions: readonly StreamingAssertion[] = streamingConfig
    ? buildAssertions(streamingConfig)
    : [];
  const usingStreaming = streamingAssertions.length > 0;
  // §8: never retry a failed WASM strategy — once rerouted to synthesis,
  // the deterministic floor is out of the picture for that index.
  const deterministicTried = new Set<number>();

  ledger.append<RunStartedEntry>({
    type: 'run-started',
    contractId: contract.manifest.contractId,
    contractHash: contract.manifest.contractHash,
    obligationCount: contract.obligations.length,
    goal: contract.manifest.goal,
  });

  let memoizedObligations = 0;
  for (let i = 0; i < contract.obligations.length; i += 1) {
    if (!skip.has(i)) continue;
    const o = contract.obligations[i];
    if (!o) continue;
    builder.setStatus(i, 'satisfied');
    ledger.append<ObligationMemoizedEntry>({
      type: 'obligation-memoized',
      obligationIndex: i,
      obligationType: o.type,
      obligationKey: obligationKey(o),
      source: 'prior-run',
      responseSha256: null,
      detail: `obligation index ${i} satisfied by prior run; skipping synthesis`,
    });
    memoizedObligations += 1;
  }

  const outcomes: ObligationOutcome[] = [];
  let totalUsage = emptyUsage();
  let verifierCallsSavedByMemoization = 0;
  let deterministicObligations = 0;
  let deterministicReroutes = 0;
  let preVerifiedObligations = 0;
  let streamingAbortedCandidates = 0;
  let streamingCharsBeforeAbort = 0;
  let attempted = 0;

  // ── Deterministic floor ─────────────────────────────────────────
  if (wasmRuntime) {
    for (let i = 0; i < contract.obligations.length; i += 1) {
      if (skip.has(i)) continue;
      const o = contract.obligations[i];
      if (!o || !o.deterministicStrategy) continue;
      if (!wasmRuntime.has(o.deterministicStrategy)) continue;
      if (deterministicTried.has(i)) continue;

      const detResult = await dispatchDeterministicFloor(
        i,
        o,
        wasmRuntime,
        repoRoot,
        ledger,
        commandTimeoutMs,
        options.strategyTimeoutMs,
      );
      deterministicTried.add(i);

      if (detResult.applied) {
        builder.setStatus(i, 'satisfied');
        deterministicObligations += 1;
        outcomes.push({
          obligationIndex: i,
          obligation: o,
          personaId: null,
          satisfied: true,
          detail: detResult.detail,
          tournament: null,
        });
      } else {
        deterministicReroutes += 1;
      }
    }
  }

  // ── Pre-generation check ────────────────────────────────────────
  // Order matters: pre-generation runs build/test commands, costlier
  // than memoization or the deterministic floor — only the obligations
  // that survived both cheap paths reach this pass.
  if (options.preGeneration) {
    const alreadyExcluded = new Set<number>(skip);
    for (const o of outcomes) alreadyExcluded.add(o.obligationIndex);
    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    const preResult = preVerifyObligations({
      obligations: contract.obligations,
      skipIndexes: alreadyExcluded,
      verifyOptions: verifyOpts,
    });
    for (const idx of preResult.satisfiedIndexes) {
      const o = contract.obligations[idx];
      if (!o) continue;
      builder.setStatus(idx, 'satisfied');
      const check = preResult.checks.find((c) => c.obligationIndex === idx);
      const detail = check?.detail ?? 'pre-generation check satisfied';
      ledger.append<ObligationPreVerifiedEntry>({
        type: 'obligation-pre-verified',
        obligationIndex: idx,
        obligationType: o.type,
        detail,
      });
      outcomes.push({
        obligationIndex: idx,
        obligation: o,
        personaId: null,
        satisfied: true,
        detail: `pre-verified: ${detail}`,
        tournament: null,
      });
      preVerifiedObligations += 1;
    }
  }

  // ── Main scheduling loop ────────────────────────────────────────
  while (attempted < cap) {
    const selection = selectPersonaForState(registry, builder.view());
    if (!selection) break;
    attempted += 1;
    const { persona, obligationIndex } = selection;
    const obligation = contract.obligations[obligationIndex];
    if (!obligation) break;
    builder.setStatus(obligationIndex, 'in-progress');

    ledger.append<ObligationAttemptedEntry>({
      type: 'obligation-attempted',
      obligationIndex,
      obligationType: obligation.type,
      personaId: persona.id,
    });

    const renderCtx = buildRenderContext(
      obligation,
      repoRoot,
      contract.manifest,
      commandTimeoutMs,
    );

    if (mode === 'tournament') {
      const result = await executeTournament({
        obligation,
        obligationIndex,
        primaryPersona: persona,
        registry,
        session,
        ledger,
        repoRoot,
        commandTimeoutMs,
        tournamentConfig: options.tournamentConfig,
        memoStore,
        renderContext: renderCtx,
        fileMustExistPaths,
        runId,
        ...(usingStreaming ? { streamingAssertions } : {}),
        ...(options.costTracker !== undefined ? { costTracker: options.costTracker } : {}),
      });
      totalUsage = addUsage(totalUsage, result.tournament.usage);
      verifierCallsSavedByMemoization += result.tournament.verifierCallsSavedByMemoization;
      streamingAbortedCandidates += result.tournament.streamingAbortedCandidates;
      streamingCharsBeforeAbort += result.tournament.streamingCharsBeforeAbort;
      const winnerPersonaId = result.tournament.winner?.personaId ?? null;
      let tournamentSatisfied = result.satisfied;
      let tournamentDetail = result.detail;
      if (result.satisfied) {
        const falsified = await dispatchFalsifiersForObligation(
          obligationIndex,
          obligation,
          options.adapterRegistry,
          ledger,
          repoRoot,
          options.falsifiers ?? 'on',
          options.adapterTimeBudgetMs ?? 60_000,
          options.falsifierScheduler,
          options.costTracker,
        );
        if (falsified.counterExample) {
          tournamentSatisfied = false;
          tournamentDetail = falsified.detail;
          const rb = await rollbackObligation(
            obligationIndex,
            ledger,
            repoRoot,
            runId,
            'per-obligation-falsification',
          );
          ledger.append<ObligationRolledBackEntry>({
            type: 'obligation-rolled-back',
            obligationIndex,
            trigger: 'per-obligation-falsification',
            success: rb.success,
            restoredFiles: rb.restoredFiles,
            detail: rb.success
              ? `rolled back ${rb.restoredFiles.length} file(s) after falsification`
              : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
          });
          if (!rb.success && rb.failure?.kind !== 'no-snapshot-found') {
            throw new Error(
              `rollback failed for obligation ${obligationIndex}: ${rb.failure?.detail ?? 'unknown'}`,
            );
          }
        }
      }
      if (tournamentSatisfied) {
        builder.setStatus(obligationIndex, 'satisfied');
        ledger.append<ObligationSatisfiedEntry>({
          type: 'obligation-satisfied',
          obligationIndex,
          obligationType: obligation.type,
          detail: tournamentDetail,
        });
      } else {
        builder.setStatus(obligationIndex, 'failed');
        ledger.append<ObligationFailedEntry>({
          type: 'obligation-failed',
          obligationIndex,
          obligationType: obligation.type,
          detail: tournamentDetail,
        });
      }
      outcomes.push({
        obligationIndex,
        obligation,
        personaId: winnerPersonaId,
        satisfied: tournamentSatisfied,
        detail: tournamentDetail,
        tournament: result.tournament,
      });
      continue;
    }

    // ── Single mode ────────────────────────────────────────────────
    const singleOpts: SingleModeOptions = {
      fileMustExistPaths,
      runId,
      commandTimeoutMs,
      renderContext: renderCtx,
      streamingAssertions,
      adapterRegistry: options.adapterRegistry,
      falsifiers: options.falsifiers,
      adapterTimeBudgetMs: options.adapterTimeBudgetMs,
      falsifierScheduler: options.falsifierScheduler,
      costTracker: options.costTracker,
    };

    const singleResult = await executeSingleMode(
      obligationIndex,
      obligation,
      session,
      persona,
      builder,
      repoRoot,
      ledger,
      singleOpts,
    );

    totalUsage = addUsage(totalUsage, singleResult.usage);
    if (singleResult.streamingAborted) {
      streamingAbortedCandidates += 1;
      streamingCharsBeforeAbort += singleResult.streamingAbortedAtChars;
    }

    outcomes.push({
      obligationIndex,
      obligation,
      personaId: persona.id,
      satisfied: singleResult.satisfied,
      detail: singleResult.detail,
      tournament: null,
    });
  }

  // ── Post-merge integration check ────────────────────────────────
  let satisfied = builder.countInStatus('satisfied');
  let failed = builder.countInStatus('failed');

  let postMerge: PostMergeRunOutcome | null = null;
  if (options.postMerge) {
    const pmResult = await handlePostMerge(
      contract,
      builder,
      repoRoot,
      ledger,
      runId,
      outcomes,
      commandTimeoutMs,
    );
    // Post-merge is authoritative; use its recomputed counts.
    satisfied = pmResult.satisfied;
    failed = pmResult.failed;
    postMerge = {
      passed: pmResult.passed,
      obligationCount: pmResult.obligationCount,
      failedCount: pmResult.failedCount,
      outcomes: pmResult.outcomes,
    };
  }

  ledger.append<RunFinishedEntry>({
    type: 'run-finished',
    satisfied,
    failed,
    totalUsage,
  });

  // Runs after the final ledger entry so it can never race the writer.
  const runFailed = failed > 0 || postMerge?.passed === false;
  try {
    cleanupSnapshots(repoRoot, runId, runFailed, options.snapshotCleanupPolicy ?? DEFAULT_SNAPSHOT_POLICY);
  } catch (err) {
    log.warn('snapshot cleanup failed (non-fatal)', { error: err instanceof Error ? err.message : String(err) });
  }

  return {
    outcomes,
    satisfied,
    failed,
    totalUsage,
    wallTimeMs: Date.now() - start,
    mode,
    memoizedObligations,
    verifierCallsSavedByMemoization,
    deterministicObligations,
    deterministicReroutes,
    preVerifiedObligations,
    streamingAbortedCandidates,
    streamingCharsBeforeAbort,
    postMerge,
  };
}

export function listPersonaIds(registry: PersonaRegistry): string[] {
  return registry.list().map((p: PersonaSpec) => p.id);
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// Re-export so external consumers (tests, v8 CLI handlers) keep their
// import path stable after the split.
export { renderDynamicMessage, type RenderContext } from './persona-message';
export { isTestFilePath } from './test-framework-misuse';