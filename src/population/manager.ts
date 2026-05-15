import * as crypto from 'crypto';
import type { FinalContract, ObligationV1 } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import { MemoStore, obligationKey } from '../ledger/memoization';
import type {
  CandidateRecordedEntry,
  CandidateStreamAbortedEntry,
  FalsificationCallEntry,
  FalsifierDispatchDecisionEntry,
  ObligationAttemptedEntry,
  ObligationDeterministicAppliedEntry,
  ObligationDeterministicAttemptedEntry,
  ObligationDeterministicFailedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationPreVerifiedEntry,
  ObligationRolledBackEntry,
  ObligationSatisfiedEntry,
  PostMergeVerifiedEntry,
  ProviderAttribution,
  RunFinishedEntry,
  RunStartedEntry,
  WorkspaceSnapshotEntry,
} from '../ledger/types';
import type { AdapterRegistry } from '../falsification/adapters/registry';
import { dispatchFalsifiers, type FalsifiersFlag } from '../falsification/dispatcher';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import { selectPersonaForState } from '../persona/predicates';
import type { Session, SessionRequest, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import { postMergeVerify } from '../verification/post-merge';
import { preVerifyObligations } from '../verification/pre-generation';
import { verifyObligation } from '../verification/run-verifier';
import {
  buildAssertions,
  runStreamingCompletion,
  type StreamingAssertion,
  type StreamingVerifierConfig,
  type StreamingVerifierOutcome,
} from '../verification/streaming-verifier';
import type { WasmRuntime } from '../wasm/wasm-runtime';
import { applyFileEmit } from './diff-applier';
import {
  computePostApplyShas,
  snapshotBeforeApply,
  type PreApplySnapshot,
} from './diff-snapshot';
import { rollbackObligation } from './rollback';
import { applyUnifiedDiff, looksLikeUnifiedDiff } from './unified-diff';
import { applyWholeFileResponse, looksLikeWholeFileResponse } from './whole-file-apply';
import { PopulationStateBuilder } from './state';
import {
  cleanupSnapshots,
  DEFAULT_SNAPSHOT_POLICY,
  type SnapshotCleanupPolicy,
} from './snapshot-cleanup';
import { COST_CAP_ABORT_REASON, type LiveCostTracker } from '../verification/live-cost-tracker';
import type { FalsifierScheduler } from '../falsification/scheduler';
import { getLogger } from '../logger';
import {
  buildRenderContext,
  renderDynamicMessage,
  type RenderContext,
} from './persona-message';
import { detectTestFrameworkMisuse, isTestFilePath } from './test-framework-misuse';
import { executeTournament } from './tournament-driver';
import type { TournamentConfig, TournamentResult } from './tournament';

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
  tournamentConfig?: Partial<Record<ObligationV1['type'], TournamentConfig>>;
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

// The shared apply→verify→rollback seam. Both single-mode (sequential
// retry with reprompt) and tournament-mode (parallel candidates with
// verifier scoring) feed responses through this helper. Reprompt-with-
// feedback is single-mode-only and stays in the caller.
//
// `trigger` selects the rollback policy:
//   - `per-obligation-failed-apply` (single-mode): roll back only when
//     patches actually applied AND the obligation isn't file-must-exist
//     (architect file creation has no pre-state to restore to).
//   - `per-obligation-falsification` (tournament-mode): roll back any
//     time a pre-snapshot exists and verification failed. Tournament's
//     historical behavior — preserved here to keep parity captures
//     byte-stable.
export interface AttemptApplyAndVerifyArgs {
  obligation: ObligationV1;
  obligationIndex: number;
  responseText: string;
  repoRoot: string;
  ledger: JsonlLedger;
  runId: string;
  fileMustExistPaths: ReadonlySet<string>;
  commandTimeoutMs: number | undefined;
  renderContext: RenderContext;
  trigger: 'per-obligation-failed-apply' | 'per-obligation-falsification';
}

export interface AttemptApplyAndVerifyResult {
  satisfied: boolean;
  applyDetail: string;
  verifyDetail: string;
  applyOk: boolean;
  applied: boolean;
  pre: PreApplySnapshot | null;
}

export async function attemptApplyAndVerify(
  args: AttemptApplyAndVerifyArgs,
): Promise<AttemptApplyAndVerifyResult> {
  const {
    obligation,
    obligationIndex,
    responseText,
    repoRoot,
    ledger,
    runId,
    fileMustExistPaths,
    commandTimeoutMs,
    renderContext,
    trigger,
  } = args;

  // applyDetail surfaces *why* a persona's response did or didn't change
  // the workspace. Without this trace, a downstream verifier failure
  // ("predicate exited 1") gives no signal whether the persona emitted
  // an unapplyable diff, declared no-op, or simply produced prose.
  // applyOk is true when the applier produced its intended on-disk
  // outcome (file-emit landed, diff applied, or persona legitimately
  // declared no-op); false on parse/apply errors or unrecognized
  // responses. Single-mode uses applyOk to decide whether to prefix the
  // verifier detail with applyDetail in the composite failure message.
  let applyDetail: string;
  let applyOk = false;
  let applied = false;
  const pre = snapshotBeforeApply(repoRoot, runId, obligation, obligationIndex, responseText);

  if (obligation.type === 'file-must-exist') {
    const r = applyFileEmit(repoRoot, obligation.path, responseText);
    applied = true;
    applyOk = true;
    applyDetail = r.detail;
  } else if (responseText.trim() === 'no-op' || responseText.trim() === '"no-op"') {
    applyDetail = 'no-op declared';
    applyOk = true;
  } else if (looksLikeWholeFileResponse(responseText)) {
    // Whole-file replacement path: persona emits one or more
    // `<<<FILE <path> ... FILE>>>` blocks with the full new contents.
    // protectedPaths is intentionally NOT passed: in the whole-file
    // flow the persona is shown the current file body via the
    // file-context injector and asked to write the FULL new contents
    // (additive, not stomping).
    try {
      const result = applyWholeFileResponse(repoRoot, responseText);
      if (result.applied) {
        applied = true;
        applyOk = true;
        applyDetail = result.detail;
      } else {
        applyDetail = `whole-file write did not apply: ${result.detail}`;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      applyDetail = `whole-file parse/apply error: ${message}`;
      applied = true;
    }
  } else if (looksLikeUnifiedDiff(responseText)) {
    try {
      const result = applyUnifiedDiff(repoRoot, responseText, {
        protectedPaths: fileMustExistPaths,
      });
      if (result.applied) {
        applied = true;
        applyOk = true;
        applyDetail = result.detail;
      } else {
        applyDetail = `unified diff did not apply: ${result.detail}`;
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      applyDetail = `unified diff parse/apply error: ${message}`;
      // A throw mid-application means an earlier hunk may have already
      // landed on disk before the failing hunk's context mismatch was
      // detected. Treat as "may have mutated" — fires the rollback
      // below, which is idempotent (no-op if pre==current).
      applied = true;
    }
  } else {
    applyDetail =
      'persona response is neither a unified diff nor "no-op" — ' +
      'workspace left unchanged. Response head: ' +
      responseText.trim().slice(0, 120).replace(/\s+/g, ' ');
  }

  if (pre) {
    const files = computePostApplyShas(repoRoot, pre);
    ledger.append<WorkspaceSnapshotEntry>({
      type: 'workspace-snapshot',
      obligationIndex,
      files,
    });
  }

  const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
  if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
  let verifyResult = verifyObligation(obligation, verifyOpts);

  // Defense-in-depth: a test file written with the wrong framework's
  // API passes file-must-exist but breaks build/test downstream. Promote
  // that misalignment into a precise, persona-attributable failure here.
  if (
    verifyResult.satisfied &&
    obligation.type === 'file-must-exist' &&
    renderContext.testFramework &&
    isTestFilePath(obligation.path)
  ) {
    const misuse = detectTestFrameworkMisuse(
      repoRoot,
      obligation.path,
      renderContext.testFramework,
    );
    if (misuse) verifyResult = { satisfied: false, detail: misuse };
  }

  const shouldRollback = !verifyResult.satisfied && pre !== null && (
    trigger === 'per-obligation-falsification'
      ? true
      : applied && obligation.type !== 'file-must-exist'
  );

  if (shouldRollback) {
    const rb = await rollbackObligation(obligationIndex, ledger, repoRoot, runId, trigger);
    ledger.append<ObligationRolledBackEntry>({
      type: 'obligation-rolled-back',
      obligationIndex,
      trigger,
      success: rb.success,
      restoredFiles: rb.restoredFiles,
      detail: rb.success
        ? trigger === 'per-obligation-failed-apply'
          ? `rolled back ${rb.restoredFiles.length} file(s) after failed apply (workspace restored to pre-attempt state)`
          : `rolled back ${rb.restoredFiles.length} file(s) after tournament winner failed verification`
        : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
    });
    if (!rb.success && rb.failure?.kind !== 'no-snapshot-found') {
      throw new Error(
        `${trigger} rollback failed for obligation ${obligationIndex}: ${rb.failure?.detail ?? 'unknown'}`,
      );
    }
  }

  return {
    satisfied: verifyResult.satisfied,
    applyDetail,
    verifyDetail: verifyResult.detail,
    applyOk,
    applied,
    pre,
  };
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
  const strategyTimeoutMs = options.strategyTimeoutMs;
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

  if (wasmRuntime) {
    for (let i = 0; i < contract.obligations.length; i += 1) {
      if (skip.has(i)) continue;
      const o = contract.obligations[i];
      if (!o || !o.deterministicStrategy) continue;
      if (!wasmRuntime.has(o.deterministicStrategy)) continue;
      if (deterministicTried.has(i)) continue;
      const detOutcome = await dispatchDeterministic({
        obligation: o,
        obligationIndex: i,
        runtime: wasmRuntime,
        repoRoot,
        commandTimeoutMs,
        strategyTimeoutMs,
        ledger,
      });
      deterministicTried.add(i);
      if (detOutcome.satisfied) {
        builder.setStatus(i, 'satisfied');
        deterministicObligations += 1;
        outcomes.push({
          obligationIndex: i,
          obligation: o,
          personaId: null,
          satisfied: true,
          detail: detOutcome.detail,
          tournament: null,
        });
      } else {
        deterministicReroutes += 1;
      }
    }
  }

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
        const falsified = await runFalsifiersForObligation({
          obligation,
          obligationIndex,
          repoRoot,
          ledger,
          registry: options.adapterRegistry,
          falsifiers: options.falsifiers ?? 'on',
          timeBudgetMs: options.adapterTimeBudgetMs ?? 60_000,
          ...(options.falsifierScheduler ? { scheduler: options.falsifierScheduler } : {}),
          ...(options.costTracker ? { costTracker: options.costTracker } : {}),
        });
        if (falsified !== null) {
          tournamentSatisfied = false;
          tournamentDetail = falsified;
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

    // Single mode: generate→apply→verify with reprompt-on-failure
    // feedback loop. Bounded at RETRY_MAX so a confused persona can't
    // burn the run's token budget. Streaming path takes the first
    // attempt and skips retry — the streaming verifier already aborts
    // early on forbidden imports, which is its own corrective signal.
    const dynamic = renderDynamicMessage(obligation, repoRoot, renderCtx);
    const RETRY_MAX = 2;
    let retryFeedback: string | null = null;
    const buildRequest = (): SessionRequest => ({
      personaId: persona.id,
      personaSystemSuffix: persona.systemSuffix,
      sampling: { ...persona.sampling },
      userMessage: retryFeedback === null ? dynamic : `${dynamic}\n\n${retryFeedback}`,
    });

    let responseText: string;
    let responseUsage: SessionUsage;
    let responseModel: string;
    let streamingOutcome: StreamingVerifierOutcome | null = null;
    if (usingStreaming) {
      streamingOutcome = await runStreamingCompletion(
        session,
        buildRequest(),
        obligation,
        streamingAssertions,
        options.costTracker,
      );
      responseText = streamingOutcome.streamResult.response.text;
      responseUsage = streamingOutcome.streamResult.response.usage;
      responseModel = streamingOutcome.streamResult.response.model;
    } else {
      const response = await session.complete(buildRequest());
      responseText = response.text;
      responseUsage = response.usage;
      responseModel = response.model;
    }
    totalUsage = addUsage(totalUsage, responseUsage);

    if (streamingOutcome?.aborted) {
      streamingAbortedCandidates += 1;
      streamingCharsBeforeAbort += streamingOutcome.abortedAtChars;
      ledger.append<CandidateStreamAbortedEntry>({
        type: 'candidate-stream-aborted',
        obligationIndex,
        roundIndex: 0,
        candidateIndex: 0,
        personaId: persona.id,
        partialResponseSha256: sha256(responseText),
        abortedAtChars: streamingOutcome.abortedAtChars,
        reason: streamingOutcome.abortReason ?? 'streaming verifier aborted',
        usageAtAbort: responseUsage,
        model: responseModel,
        ...providerAttribution(session),
      });
      builder.setStatus(obligationIndex, 'failed');
      const failDetail = `streaming verifier aborted: ${streamingOutcome.abortReason ?? 'unspecified violation'}`;
      ledger.append<ObligationFailedEntry>({
        type: 'obligation-failed',
        obligationIndex,
        obligationType: obligation.type,
        detail: failDetail,
      });
      outcomes.push({
        obligationIndex,
        obligation,
        personaId: persona.id,
        satisfied: false,
        detail: failDetail,
        tournament: null,
      });
      continue;
    }

    let attempt = 0;
    let attemptResult: AttemptApplyAndVerifyResult;
    for (;;) {
      if (attempt > 0) {
        const response = await session.complete(buildRequest());
        responseText = response.text;
        responseUsage = response.usage;
        responseModel = response.model;
        totalUsage = addUsage(totalUsage, responseUsage);
      }

      ledger.append<CandidateRecordedEntry>({
        type: 'candidate-recorded',
        obligationIndex,
        personaId: persona.id,
        responseSha256: sha256(responseText),
        usage: responseUsage,
        model: responseModel,
        ...providerAttribution(session),
      });

      attemptResult = await attemptApplyAndVerify({
        obligation,
        obligationIndex,
        responseText,
        repoRoot,
        ledger,
        runId,
        fileMustExistPaths,
        commandTimeoutMs,
        renderContext: renderCtx,
        trigger: 'per-obligation-failed-apply',
      });

      if (attemptResult.satisfied) break;
      if (attempt >= RETRY_MAX) break;
      const failureContext = attemptResult.applyOk
        ? attemptResult.verifyDetail
        : `${attemptResult.applyDetail}; verifier: ${attemptResult.verifyDetail}`;
      retryFeedback =
        'Your previous attempt did not satisfy the obligation. Specifics:\n' +
        failureContext +
        '\n\nReissue your response. If the failure was a context mismatch, ' +
        'look at the file contents in this prompt and use ONLY those exact ' +
        'lines as ` ` and `-` lines in your diff. If the failure was a ' +
        'predicate exit-1, your diff did not produce the asserted property ' +
        '— adjust the diff to make the predicate exit zero.';
      attempt += 1;
    }

    let finalSatisfied = attemptResult.satisfied;
    let finalDetail = attemptResult.satisfied || attemptResult.applyOk
      ? attemptResult.verifyDetail
      : `${attemptResult.applyDetail}; verifier: ${attemptResult.verifyDetail}`;
    if (finalSatisfied) {
      const falsified = await runFalsifiersForObligation({
        obligation,
        obligationIndex,
        repoRoot,
        ledger,
        registry: options.adapterRegistry,
        falsifiers: options.falsifiers ?? 'on',
        timeBudgetMs: options.adapterTimeBudgetMs ?? 60_000,
        ...(options.falsifierScheduler ? { scheduler: options.falsifierScheduler } : {}),
        ...(options.costTracker ? { costTracker: options.costTracker } : {}),
      });
      if (falsified !== null) {
        finalSatisfied = false;
        finalDetail = falsified;
        if (attemptResult.pre) {
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
    }

    if (finalSatisfied) {
      builder.setStatus(obligationIndex, 'satisfied');
      ledger.append<ObligationSatisfiedEntry>({
        type: 'obligation-satisfied',
        obligationIndex,
        obligationType: obligation.type,
        detail: finalDetail,
      });
    } else {
      builder.setStatus(obligationIndex, 'failed');
      ledger.append<ObligationFailedEntry>({
        type: 'obligation-failed',
        obligationIndex,
        obligationType: obligation.type,
        detail: finalDetail,
      });
    }

    outcomes.push({
      obligationIndex,
      obligation,
      personaId: persona.id,
      satisfied: finalSatisfied,
      detail: finalDetail,
      tournament: null,
    });
  }

  let satisfied = builder.countInStatus('satisfied');
  let failed = builder.countInStatus('failed');

  let postMerge: PostMergeRunOutcome | null = null;
  if (options.postMerge) {
    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    const pm = postMergeVerify({ contract, verifyOptions: verifyOpts });
    const slimOutcomes = pm.outcomes.map((o) => ({
      obligationIndex: o.obligationIndex,
      obligationType: o.obligation.type,
      passed: o.passed,
      detail: o.detail,
    }));
    ledger.append<PostMergeVerifiedEntry>({
      type: 'post-merge-verified',
      passed: pm.passed,
      obligationCount: pm.obligationCount,
      failedCount: pm.failedCount,
      outcomes: slimOutcomes,
      detail: pm.passed
        ? `post-merge integration check passed across ${pm.obligationCount} obligation(s)`
        : `post-merge integration check failed: ${pm.failedCount}/${pm.obligationCount} obligation(s) regressed`,
    });
    postMerge = {
      passed: pm.passed,
      obligationCount: pm.obligationCount,
      failedCount: pm.failedCount,
      outcomes: slimOutcomes,
    };
    // Post-merge is authoritative for the integrated state; recompute
    // satisfied/failed from pm.outcomes so the exit code reflects
    // post-merge truth, not a stale apply-time counter.
    satisfied = pm.outcomes.filter((o) => o.passed).length;
    failed = pm.outcomes.filter((o) => !o.passed).length;

    if (!pm.passed) {
      // Rollback policy: only abandon the merge when a STRUCTURAL
      // obligation regresses. Predicate-only regressions
      // (property-must-hold, function-must-have-signature,
      // coverage-must-exceed, etc.) are quality checks; rolling back
      // working code for cosmetic predicate misses destroys real
      // progress. May 2026 eval: test-must-pass succeeded, 14/16
      // obligations passed at post-merge, 2 over-literal greps failed —
      // a full rollback erased the entire feature.
      const structuralRegression = pm.outcomes.some(
        (o) =>
          !o.passed &&
          (o.obligation.type === 'test-must-pass' ||
            o.obligation.type === 'build-must-pass' ||
            o.obligation.type === 'file-must-exist'),
      );
      const regressionGap = pm.failedCount;
      if (!structuralRegression) {
        failed = 0;
        satisfied = pm.obligationCount - regressionGap;
        ledger.append<ObligationRolledBackEntry>({
          type: 'obligation-rolled-back',
          obligationIndex: -1,
          trigger: 'post-merge-regression',
          success: true,
          restoredFiles: [],
          detail:
            `post-merge regression detected (${regressionGap} obligation(s)) but ` +
            'no structural failure — keeping applied work. ' +
            'Predicate-only regressions are quality warnings, not rollback triggers.',
        });
      }
      if (structuralRegression) {
        for (let i = outcomes.length - 1; i >= 0; i -= 1) {
          const o = outcomes[i];
          if (!o) continue;
          if (!o.satisfied) continue;
          if (o.personaId === null) continue;
          const rb = await rollbackObligation(
            o.obligationIndex,
            ledger,
            repoRoot,
            runId,
            'post-merge-regression',
          );
          ledger.append<ObligationRolledBackEntry>({
            type: 'obligation-rolled-back',
            obligationIndex: o.obligationIndex,
            trigger: 'post-merge-regression',
            success: rb.success,
            restoredFiles: rb.restoredFiles,
            detail: rb.success
              ? `rolled back ${rb.restoredFiles.length} file(s) after post-merge regression`
              : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
          });
          if (!rb.success && rb.failure?.kind !== 'no-snapshot-found') {
            throw new Error(
              `post-merge rollback failed for obligation ${o.obligationIndex}: ${rb.failure?.detail ?? 'unknown'}`,
            );
          }
        }
      }
    }
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

interface DispatchDeterministicArgs {
  obligation: ObligationV1;
  obligationIndex: number;
  runtime: WasmRuntime;
  repoRoot: string;
  commandTimeoutMs: number | undefined;
  strategyTimeoutMs: number | undefined;
  ledger: JsonlLedger;
}

interface DispatchDeterministicResult {
  satisfied: boolean;
  detail: string;
}

// §8 misclassification recovery: never retries a failing strategy.
// The caller tracks attempted indexes and reroutes to synthesis.
async function dispatchDeterministic(
  args: DispatchDeterministicArgs,
): Promise<DispatchDeterministicResult> {
  const {
    obligation,
    obligationIndex,
    runtime,
    repoRoot,
    commandTimeoutMs,
    strategyTimeoutMs,
    ledger,
  } = args;
  const strategyName = obligation.deterministicStrategy ?? '';

  ledger.append<ObligationDeterministicAttemptedEntry>({
    type: 'obligation-deterministic-attempted',
    obligationIndex,
    obligationType: obligation.type,
    strategyName,
  });

  const dispatchOpts: { strategyName?: string; timeoutMs?: number } = {};
  if (strategyTimeoutMs !== undefined) dispatchOpts.timeoutMs = strategyTimeoutMs;
  const outcome = await runtime.dispatch(obligation, repoRoot, dispatchOpts);

  if (outcome.error !== null) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'error',
      detail: outcome.detail,
    });
    return { satisfied: false, detail: outcome.detail };
  }

  if (!outcome.applied) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'not-applied',
      detail: outcome.detail,
    });
    return { satisfied: false, detail: outcome.detail };
  }

  const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
  if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
  const verifyResult = verifyObligation(obligation, verifyOpts);
  if (!verifyResult.satisfied) {
    ledger.append<ObligationDeterministicFailedEntry>({
      type: 'obligation-deterministic-failed',
      obligationIndex,
      obligationType: obligation.type,
      strategyName,
      reason: 'verifier-rejected',
      detail: `${outcome.detail}; verifier said: ${verifyResult.detail}`,
    });
    return { satisfied: false, detail: verifyResult.detail };
  }

  ledger.append<ObligationDeterministicAppliedEntry>({
    type: 'obligation-deterministic-applied',
    obligationIndex,
    obligationType: obligation.type,
    strategyName,
    filesAffected: outcome.filesAffected,
    wallTimeMs: outcome.wallTimeMs,
    detail: outcome.detail,
  });
  ledger.append<ObligationSatisfiedEntry>({
    type: 'obligation-satisfied',
    obligationIndex,
    obligationType: obligation.type,
    detail: `deterministic ${strategyName}: ${outcome.detail}`,
  });
  return { satisfied: true, detail: outcome.detail };
}

export function listPersonaIds(registry: PersonaRegistry): string[] {
  return registry.list().map((p: PersonaSpec) => p.id);
}

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

export function providerAttribution(session: Session): ProviderAttribution {
  // Older test mocks satisfy Session structurally without providerInfo.
  if (typeof session.providerInfo !== 'function') return {};
  const info = session.providerInfo();
  return {
    provider: info.provider,
    modelId: info.model,
    backend: info.backend,
    grammar: info.grammar,
    seed: info.seed,
    usageEstimated: info.usageEstimated,
  };
}

interface RunFalsifiersArgs {
  readonly obligation: ObligationV1;
  readonly obligationIndex: number;
  readonly repoRoot: string;
  readonly ledger: JsonlLedger;
  readonly registry: AdapterRegistry | undefined;
  readonly falsifiers: FalsifiersFlag;
  readonly timeBudgetMs: number;
  readonly scheduler?: FalsifierScheduler;
  readonly costTracker?: LiveCostTracker;
}

// Adapter throws are caught and recorded as failed dispatch entries:
// an adapter going sideways must not crash the run, the producer's
// verifier has already approved the patch.
async function runFalsifiersForObligation(
  args: RunFalsifiersArgs,
): Promise<string | null> {
  const { obligation, obligationIndex, repoRoot, ledger, registry, falsifiers } = args;
  if (falsifiers === 'off' || registry === undefined) return null;
  if (registry.forObligation(obligation.type).length === 0) return null;
  let outcome;
  try {
    const dispatchOpts: Parameters<typeof dispatchFalsifiers>[2] = {
      falsifiers,
      timeBudgetMs: args.timeBudgetMs,
      workspaceRoot: repoRoot,
      contextRefs: [],
      patchSha: '',
    };
    if (args.scheduler) (dispatchOpts as { scheduler?: FalsifierScheduler }).scheduler = args.scheduler;
    if (args.costTracker) {
      const tracker = args.costTracker;
      (dispatchOpts as { shouldCancel?: () => string | null }).shouldCancel = () =>
        tracker.isCancelled() ? COST_CAP_ABORT_REASON : null;
    }
    outcome = await dispatchFalsifiers(obligation, registry, dispatchOpts);
    if (args.scheduler) args.scheduler.flush();
    if (outcome.dispatchDecision) {
      ledger.append<FalsifierDispatchDecisionEntry>({
        type: 'falsifier-dispatch-decision',
        obligationIndex,
        obligationType: obligation.type,
        kind: outcome.dispatchDecision.kind,
        order: outcome.dispatchDecision.order.slice(),
        scores: outcome.dispatchDecision.scores.map((s) => ({ adapter: s.adapter, score: Number.isFinite(s.score) ? s.score : null })),
      });
    }
  } catch (err) {
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex,
      obligationType: obligation.type,
      adapterName: '<dispatcher>',
      resultKind: 'dispatcher-error',
      counterExamplesFound: 0,
      wallClockMs: 0,
      dollarsBilled: 0,
      dollarsApiEquivalent: 0,
      detail: `falsifier dispatch threw: ${(err as Error).message.slice(0, 800)}`,
    });
    return null;
  }
  if (outcome.disabled) return null;
  let firstCounterExampleDetail: string | null = null;
  for (const call of outcome.calls) {
    const counterExamples = call.cost.counterExamplesFound;
    let detail: string;
    if (call.result.kind === 'counter-example-input') {
      const inputs = call.result.inputs;
      const repro = inputs[0]?.reproducer ?? '<no reproducer>';
      detail =
        `${call.adapterName} found ${inputs.length} counter-example(s); ` +
        `first reproducer: ${repro.slice(0, 200)}`;
      if (firstCounterExampleDetail === null) firstCounterExampleDetail = detail;
    } else if (call.result.kind === 'no-falsification-found') {
      detail = `${call.adapterName} found no falsification (${call.result.reason}, ${call.result.attempts} attempts)`;
    } else if (call.result.kind === 'regression-fixture') {
      detail = `${call.adapterName} produced regression fixture at ${call.result.fixturePath}`;
      if (firstCounterExampleDetail === null) firstCounterExampleDetail = detail;
    } else {
      detail = `${call.adapterName} produced property-violation trace (${call.result.steps.length} steps)`;
      if (firstCounterExampleDetail === null) firstCounterExampleDetail = detail;
    }
    ledger.append<FalsificationCallEntry>({
      type: 'falsification-call',
      obligationIndex,
      obligationType: obligation.type,
      adapterName: call.adapterName,
      resultKind: call.result.kind,
      counterExamplesFound: counterExamples,
      wallClockMs: call.cost.wallClockMs,
      dollarsBilled: call.cost.dollarsBilled,
      dollarsApiEquivalent: call.cost.dollarsApiEquivalent,
      detail,
    });
  }
  return firstCounterExampleDetail;
}

// Re-export so external consumers (tests, v8 CLI handlers) keep their
// import path stable after the split.
export { renderDynamicMessage, type RenderContext } from './persona-message';
export { isTestFilePath } from './test-framework-misuse';
