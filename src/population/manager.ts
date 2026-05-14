import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { ContractManifest, FinalContract, ObligationV1, RepoContext } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import { MemoStore, obligationKey } from '../ledger/memoization';
import type {
  CandidateDiscardedEntry,
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
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
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
import { computePostApplyShas, snapshotBeforeApply } from './diff-snapshot';
import { rollbackObligation } from './rollback';
import { applyUnifiedDiff, looksLikeUnifiedDiff } from './unified-diff';
import { applyWholeFileResponse, looksLikeWholeFileResponse } from './whole-file-apply';
import { PopulationStateBuilder } from './state';
import {
  DEFAULT_TOURNAMENT_CONFIG,
  runTournament,
  type TournamentCandidate,
  type TournamentConfig,
  type TournamentLedgerSink,
  type TournamentPersonaSlate,
  type TournamentResult,
} from './tournament';
import {
  cleanupSnapshots,
  DEFAULT_SNAPSHOT_POLICY,
  type SnapshotCleanupPolicy,
} from './snapshot-cleanup';
import type { LiveCostTracker } from '../verification/live-cost-tracker';
import type { FalsifierScheduler } from '../falsification/scheduler';
import { getLogger } from '../logger';

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

export async function runPopulation(
  options: RunPopulationOptions,
): Promise<RunPopulationResult> {
  const start = Date.now();
  const { contract, repoRoot, registry, session, ledger, commandTimeoutMs } = options;
  const runId = options.runId ?? ledger.run();
  const cap = options.maxObligations ?? contract.obligations.length;
  // Paths owned by file-must-exist obligations. The architect persona
  // creates these; subsequent personas (security-reviewer, verifier, etc.)
  // must not overwrite them via their unified diffs. Without this guard a
  // property-must-hold predicate that mentions the file path tempts the
  // satisfying persona into emitting a `--- /dev/null` create patch that
  // stomps on the architect's body — and when the model thinks aloud and
  // the diff is partial, the file ends up truncated.
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

    if (mode === 'tournament') {
      const tournamentRenderCtx = buildRenderContext(
        obligation,
        repoRoot,
        contract.manifest,
        commandTimeoutMs,
      );
      const execOpts: ExecuteTournamentArgs = {
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
        renderContext: tournamentRenderCtx,
        fileMustExistPaths,
        runId,
      };
      if (usingStreaming) execOpts.streamingAssertions = streamingAssertions;
      if (options.costTracker !== undefined) execOpts.costTracker = options.costTracker;
      const result = await executeTournament(execOpts);
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

    // Single mode (Phase 2 path; Phase 6 layers streaming on top).
    const renderCtx = buildRenderContext(
      obligation,
      repoRoot,
      contract.manifest,
      commandTimeoutMs,
    );
    const dynamic = renderDynamicMessage(obligation, repoRoot, renderCtx);
    // Retry-on-failure feedback loop: the May 2026 eval showed
    // personas writing diffs with imagined context lines and no way to
    // correct because the orchestrator never gave them the error.
    // Closing the loop: on apply/verify failure, augment the user
    // message with the structured failure and re-prompt the same
    // persona. Bounded at RETRY_MAX so a confused persona can't burn
    // the run's token budget. Streaming path takes the first attempt
    // and skips retry — the streaming verifier already aborts early on
    // forbidden imports, which is its own corrective signal.
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

    // These are reassigned at the top of each retry iteration; declared
    // here so they're in scope for the per-obligation rollback block
    // and the satisfied/failed bookkeeping below the loop. The retry
    // loop body always runs at least once (it's a `for (;;)` with
    // explicit breaks), so TS's definite-assignment analysis is
    // satisfied without an initial value.
    let applyDetail: string | null;
    let appliedAnyPatches: boolean;
    let pre: ReturnType<typeof snapshotBeforeApply>;
    let verifyResult: ReturnType<typeof verifyObligation>;
    let finalSatisfied: boolean;
    let finalDetail: string;
    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;

    // Retry loop. The first iteration uses the response we already
    // computed above; subsequent iterations re-call session.complete
    // with retryFeedback appended so the persona sees the specific
    // failure from the previous attempt. Streaming-path responses do
    // not retry (the streaming verifier handles its own correction).
    for (let attempt = 0; ; attempt += 1) {
      if (attempt > 0) {
        // Re-prompt with corrective feedback.
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

      // applyDetail surfaces *why* a persona's response did or didn't change
      // the workspace. Without this trace, a downstream verifier failure
      // ("predicate exited 1") gives no signal whether the persona emitted
      // an unapplyable diff, declared no-op, or simply produced prose.
      applyDetail = null;
      appliedAnyPatches = false;
      pre = snapshotBeforeApply(repoRoot, runId, obligation, obligationIndex, responseText);
      if (obligation.type === 'file-must-exist') {
        applyFileEmit(repoRoot, obligation.path, responseText);
        appliedAnyPatches = true;
      } else if (responseText.trim() === 'no-op') {
        applyDetail = 'persona declared no-op; workspace left unchanged';
      } else if (looksLikeWholeFileResponse(responseText)) {
        // Whole-file replacement path: persona emits one or more
        // `<<<FILE <path> ... FILE>>>` blocks with the full new
        // contents of each file. This bypasses unified-diff context
        // matching entirely — LLMs reliably produce coherent file
        // bodies but flake on `--- a/<path>` context lines.
        // protectedPaths is intentionally NOT passed: in the
        // whole-file flow the persona is shown the current file
        // body via the file-context injector and asked to write the
        // FULL new contents (additive, not stomping). The
        // truncation guard inside applyWholeFileResponse catches
        // pathological shrinkage cases.
        try {
          const result = applyWholeFileResponse(repoRoot, responseText);
          if (result.applied) {
            appliedAnyPatches = true;
          } else {
            applyDetail = `whole-file write did not apply: ${result.detail}`;
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          applyDetail = `whole-file parse/apply error: ${message}`;
          appliedAnyPatches = true;
        }
      } else if (looksLikeUnifiedDiff(responseText)) {
        try {
          // Protect file-must-exist paths from cross-persona overwrites:
          // the architect already owns these files. A diff that targets one
          // is dropped (skip that patch only, not the whole diff) so the
          // architect's body is preserved.
          const result = applyUnifiedDiff(repoRoot, responseText, {
            protectedPaths: fileMustExistPaths,
          });
          if (result.applied) {
            appliedAnyPatches = true;
          } else {
            applyDetail = `unified diff did not apply: ${result.detail}`;
          }
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          applyDetail = `unified diff parse/apply error: ${message}`;
          // A throw mid-application means an earlier hunk may have
          // already landed on disk before the failing hunk's context
          // mismatch was detected. We don't know if any patches did
          // land, so treat this as "may have mutated" — that fires the
          // per-obligation-failed-apply rollback below, which is
          // idempotent (no-op if pre==current, restores otherwise).
          appliedAnyPatches = true;
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

      verifyResult = verifyObligation(obligation, verifyOpts);

      // Defense-in-depth: when the architect just wrote a test file and the
      // contract knows the project's test framework, sanity-check the file
      // against that framework. The standard verifier only checks file
      // existence; without this guard a test file written with the wrong
      // framework's API passes file-must-exist, breaks build/test in
      // confusing ways downstream, and post-merge has to surface the
      // failure with a stack trace instead of "wrong test framework". This
      // promotes the misalignment into a precise, persona-attributable
      // obligation failure.
      if (
        verifyResult.satisfied &&
        obligation.type === 'file-must-exist' &&
        renderCtx.testFramework &&
        isTestFilePath(obligation.path)
      ) {
        const misuse = detectTestFrameworkMisuse(
          repoRoot,
          obligation.path,
          renderCtx.testFramework,
        );
        if (misuse) verifyResult = { satisfied: false, detail: misuse };
      }

      finalSatisfied = verifyResult.satisfied;
      finalDetail = verifyResult.detail;
      // Surface why no patch was applied: a verifier failure ("predicate
      // exited 1") with no upstream context leads users to debug the
      // predicate when the real problem is that the persona's response
      // wasn't an applyable diff.
      if (!finalSatisfied && applyDetail !== null) {
        finalDetail = `${applyDetail}; verifier: ${finalDetail}`;
      }

      // Per-attempt cleanup: when this attempt FAILED verification but
      // its diff actually applied (mutated files on disk), roll those
      // mutations back. Without this, partial half-correct diffs cascade
      // into the next attempt's (or next obligation's) pre-snapshot and
      // trip the post-merge rollback's strict state-equality invariant.
      if (!finalSatisfied && appliedAnyPatches && pre && obligation.type !== 'file-must-exist') {
        const rb = await rollbackObligation(
          obligationIndex,
          ledger,
          repoRoot,
          runId,
          'per-obligation-failed-apply',
        );
        ledger.append<ObligationRolledBackEntry>({
          type: 'obligation-rolled-back',
          obligationIndex,
          trigger: 'per-obligation-failed-apply',
          success: rb.success,
          restoredFiles: rb.restoredFiles,
          detail: rb.success
            ? `rolled back ${rb.restoredFiles.length} file(s) after failed apply (workspace restored to pre-attempt state)`
            : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
        });
        if (!rb.success && rb.failure?.kind !== 'no-snapshot-found') {
          throw new Error(
            `per-obligation-failed-apply rollback failed for obligation ${obligationIndex}: ${rb.failure?.detail ?? 'unknown'}`,
          );
        }
        // Workspace is now restored to pre-attempt state. The next
        // retry iteration will reset appliedAnyPatches at its top;
        // if we break out of the loop here (no more retries), the
        // outer code only reads finalSatisfied/finalDetail, not
        // appliedAnyPatches — so no explicit reset is needed.
      }

      if (finalSatisfied) break;
      if (attempt >= RETRY_MAX) break;
      retryFeedback =
        'Your previous attempt did not satisfy the obligation. Specifics:\n' +
        finalDetail +
        '\n\nReissue your response. If the failure was a context mismatch, ' +
        'look at the file contents in this prompt and use ONLY those exact ' +
        'lines as ` ` and `-` lines in your diff. If the failure was a ' +
        'predicate exit-1, your diff did not produce the asserted property ' +
        '— adjust the diff to make the predicate exit zero.';
    }
    if (verifyResult.satisfied) {
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

        if (pre) {
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
            // state-mismatch, recovery-invariant-violated, and io-error are
            // hard failures; continuing on a corrupted workspace silently
            // breaks subsequent obligations.
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
    // Post-merge is authoritative for the integrated state. Even if
    // an apply-time attempt failed for some obligation, what matters
    // for the exit code is whether the FINAL integrated workspace
    // passes its obligations. Recompute satisfied/failed from
    // pm.outcomes so the exit code reflects post-merge truth, not a
    // stale apply-time counter from the per-obligation phase.
    satisfied = pm.outcomes.filter((o) => o.passed).length;
    failed = pm.outcomes.filter((o) => !o.passed).length;

    if (!pm.passed) {
      // Rollback policy: only abandon the merge when a STRUCTURAL
      // obligation regresses. Structural = test-must-pass,
      // build-must-pass, file-must-exist (code that wouldn't compile,
      // wouldn't run tests, or is missing required files is genuinely
      // broken). Predicate-only regressions (property-must-hold,
      // function-must-have-signature, coverage-must-exceed, etc.) are
      // QUALITY checks; their failure means the run did not meet some
      // assertion, but the code itself works. Rolling back working
      // code for cosmetic predicate misses (e.g. `grep -q "204"` when
      // the code uses `httpStatus.NO_CONTENT`) destroys real progress.
      // The May 2026 eval hit exactly this: test-must-pass succeeded,
      // 14/16 obligations passed at post-merge, 2 over-literal greps
      // failed — and a full rollback erased the entire feature.
      const structuralRegression = pm.outcomes.some(
        (o) =>
          !o.passed &&
          (o.obligation.type === 'test-must-pass' ||
            o.obligation.type === 'build-must-pass' ||
            o.obligation.type === 'file-must-exist'),
      );
      const regressionGap = pm.failedCount;
      if (!structuralRegression) {
        // Keep the applied work AND keep the exit-code green: the
        // code compiles, tests pass, and required files exist.
        // Predicate-only regressions are surfaced as quality
        // warnings in the ledger — visible to anyone who reads
        // `swarm v8 stats <run-id>` — but they do NOT promote into
        // run.failed because the policy already decided the work is
        // shippable. Exit-code semantics stay aligned with the
        // workspace state: kept-with-warnings → exit 0.
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
        // Roll back ALL applied obligations in reverse order. Structural
        // regression means the integrated workspace is broken; restoring
        // to the pre-run state matches v6's abandon-the-bad-branch
        // behaviour.
        for (let i = outcomes.length - 1; i >= 0; i -= 1) {
        const o = outcomes[i];
        if (!o) continue;
        if (!o.satisfied) continue;
        if (o.personaId === null) continue; // pre-verified / deterministic / memoized; no snapshot exists.

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

// commandFailureTail: pre-running the verifier once before synthesis
// surfaces the actual error to the persona; without it the implementer
// gets "make build pass" with zero signal and historically responded
// with off-target diffs.
// testFramework: without this hint the architect defaults to Jest API
// and lands broken files in node:test / Mocha / Vitest projects.
export interface RenderContext {
  commandFailureTail?: string;
  testFramework?: 'jest' | 'mocha' | 'vitest' | 'node-test' | 'pytest' | null;
}

// Contract context (goal, repo summary) is sent once via the cached
// system block; only per-obligation specifics go here so cache hits
// dominate.
export function renderDynamicMessage(
  obligation: ObligationV1,
  repoRoot: string,
  context?: RenderContext,
): string {
  const lines = [
    `Obligation:`,
    JSON.stringify(obligation),
    '',
    `Repository root: ${repoRoot}`,
    '',
  ];
  switch (obligation.type) {
    case 'file-must-exist': {
      // Framework hint goes FIRST: structurally salient placement
      // overrides the model's Jest-default-when-unhinted bias.
      const fwHint = renderTestFrameworkHint(obligation.path, context?.testFramework ?? null);
      if (fwHint) {
        lines.push('REQUIRED:', fwHint, '');
      }
      lines.push(`Emit the file content for ${obligation.path}.`);
      lines.push(
        'Wrap the file body in a single fenced code block. No prose outside the fences.',
      );
      break;
    }
    case 'build-must-pass':
      lines.push(`The repository must satisfy: ${obligation.command}`);
      lines.push('If the build is already passing, output the literal text "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that makes the build pass.',
      );
      lines.push(
        'Use repo-relative paths in diff headers (`--- a/path` and `+++ b/path`); never write outside existing files unless the diff explicitly creates a new path the obligation requires.',
      );
      if (context?.testFramework) {
        lines.push(renderFrameworkPreservationHint(context.testFramework));
      }
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.command, context.commandFailureTail));
      }
      break;
    case 'test-must-pass':
      lines.push(`The repository must satisfy: ${obligation.command}`);
      lines.push('If tests already pass, output the literal text "no-op".');
      lines.push('Otherwise output a unified diff against repo root that makes tests pass.');
      lines.push(
        'Use repo-relative paths in diff headers; never write outside existing files unless the diff explicitly creates a path the obligation requires.',
      );
      if (context?.testFramework) {
        lines.push(renderFrameworkPreservationHint(context.testFramework));
      }
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.command, context.commandFailureTail));
      }
      break;
    case 'function-must-have-signature':
      lines.push(
        `Function "${obligation.name}" in ${obligation.file} must declare the signature ` +
          `"${obligation.signature}".`,
      );
      lines.push('If the file already declares the function with this signature, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that brings the file into compliance.',
      );
      appendFileContext(lines, repoRoot, [obligation.file]);
      break;
    case 'property-must-hold':
      lines.push(
        `The property over "${obligation.target}" asserted by predicate "${obligation.predicate}" ` +
          `must hold (predicate exits zero).`,
      );
      lines.push('If the property already holds, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that makes the predicate pass.',
      );
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.predicate, context.commandFailureTail));
      }
      appendFileContext(lines, repoRoot, extractFilePathsFromPredicate(obligation.predicate));
      break;
    case 'import-graph-must-satisfy':
      lines.push(
        `Import graph rooted at ${obligation.scope} must satisfy "${obligation.constraint}".`,
      );
      lines.push('If the constraint already holds, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that removes the offending edges.',
      );
      break;
    case 'coverage-must-exceed':
      lines.push(
        `Coverage report ${obligation.scope} must report ${obligation.metric} pct >= ` +
          `${obligation.threshold}%.`,
      );
      lines.push('If coverage already meets the threshold, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that adds tests until coverage clears the threshold.',
      );
      break;
    case 'performance-must-not-regress':
      lines.push(
        `Benchmark "${obligation.benchmark}" must not regress past ` +
          `${(obligation.threshold * 100).toFixed(1)}% versus the baseline value at ` +
          `${obligation.baseline}.`,
      );
      lines.push('If the benchmark already meets the budget, output "no-op".');
      lines.push(
        'Otherwise output a unified diff against repo root that recovers the regression.',
      );
      if (context?.commandFailureTail) {
        lines.push('', renderFailureBlock(obligation.benchmark, context.commandFailureTail));
      }
      break;
  }
  return lines.join('\n');
}

// 6 KB ≈ 1500 tokens — covers a typical controller/route file without
// dominating the prompt budget.
const FILE_CONTEXT_MAX_BYTES = 6 * 1024;
const TOTAL_FILE_CONTEXT_MAX_BYTES = 16 * 1024;

// Without inlining current file contents, personas guess at context
// lines and diffs hit "context mismatch" errors (May 2026 eval failure
// mode).
function appendFileContext(
  lines: string[],
  repoRoot: string,
  paths: readonly string[],
): void {
  let remaining = TOTAL_FILE_CONTEXT_MAX_BYTES;
  const seen = new Set<string>();
  for (const relPath of paths) {
    if (remaining <= 0) break;
    if (seen.has(relPath)) continue;
    seen.add(relPath);
    let abs: string;
    try {
      abs = path.resolve(repoRoot, relPath);
    } catch {
      continue;
    }
    // Defense: reject paths that escape repoRoot via ../
    const rel = path.relative(repoRoot, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
    if (!fs.existsSync(abs)) continue;
    let body: string;
    try {
      body = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const truncated = body.length > FILE_CONTEXT_MAX_BYTES;
    const slice = truncated ? body.slice(0, FILE_CONTEXT_MAX_BYTES) : body;
    const byteCost = slice.length + 80;
    if (byteCost > remaining) continue;
    remaining -= byteCost;
    lines.push('');
    lines.push(`Current contents of ${relPath} (use these exact lines as diff context):`);
    lines.push('```');
    lines.push(slice + (truncated ? '\n[…truncated…]' : ''));
    lines.push('```');
  }
}

// Conservative on purpose: false negatives are fine (persona gets no
// extra context); false positives are gated by appendFileContext's
// fs.existsSync check.
function extractFilePathsFromPredicate(predicate: string): string[] {
  const candidates: string[] = [];
  const tokenRe = /(?:^|[\s'"`])([a-zA-Z0-9_.][a-zA-Z0-9_./-]*\/[a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)(?=[\s'"`)|;&]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(predicate)) !== null) {
    const token = m[1];
    if (token === undefined) continue;
    if (token.startsWith('/') || token.startsWith('-')) continue;
    if (!candidates.includes(token)) candidates.push(token);
  }
  return candidates;
}

// Prescriptive when framework is known; silent when null —
// over-specifying is worse than under-specifying.
function renderTestFrameworkHint(
  relPath: string,
  framework: RepoContext['testFramework'],
): string | null {
  if (!isTestFilePath(relPath)) return null;
  switch (framework) {
    case 'jest':
      return 'This is a test file. Use Jest API: `import { ... } from \'@jest/globals\'` (or rely on globals), `describe`, `test`/`it`, `expect(x).toBe(y)`. Do NOT mix in node:test or Mocha imports.';
    case 'vitest':
      return 'This is a test file. Use Vitest API: `import { describe, it, expect } from \'vitest\'`. Do NOT mix in Jest, node:test, or Mocha imports.';
    case 'mocha':
      return 'This is a test file. Use Mocha API: `import { describe, it } from \'mocha\'` plus an assertion library that the project already depends on (typically `chai` or `node:assert`). Do NOT use Jest `expect(x).toBe(y)`.';
    case 'node-test':
      return 'This is a test file. Use Node.js built-in test runner: `import { describe, it } from \'node:test\'` and `import assert from \'node:assert/strict\'`. Use `assert.equal(actual, expected)` (or `assert.deepEqual`); do NOT use Jest `expect(...).toBe(...)` — node:test has no `expect`. Import source files using extension-less paths that match the project\'s tsconfig moduleResolution.';
    case 'pytest':
      return 'This is a test file. Use pytest API: `def test_xxx():` with plain `assert <expr>`. Do NOT use unittest.TestCase classes unless the project already does.';
    case null:
    case undefined:
      return null;
  }
}

const TEST_FILE_PATTERN = /(\.|_)(test|spec)\.[a-zA-Z0-9]+$|(^|\/)__tests__\//;

export function isTestFilePath(relPath: string): boolean {
  return TEST_FILE_PATTERN.test(relPath);
}

// Conservative: only obvious cross-framework imports/API references
// trip it. Lookalike frameworks (Jest vs Vitest) are not flagged
// against each other — a false positive (rewrite a valid file) is
// costlier than letting an ambiguous case through.
function detectTestFrameworkMisuse(
  repoRoot: string,
  relPath: string,
  framework: NonNullable<RenderContext['testFramework']>,
): string | null {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const abs = path.isAbsolute(relPath) ? relPath : path.join(repoRoot, relPath);
  let body: string;
  try {
    body = fs.readFileSync(abs, 'utf8');
  } catch {
    return null;
  }
  const usesJestExpect = /\bexpect\s*\(/.test(body) && /\.\s*to(Be|Equal|StrictEqual|HaveLength|Contain|MatchObject|Throw)/i.test(body);
  const importsNodeTest = /from\s+['"]node:test['"]/.test(body) || /from\s+['"]node:assert/.test(body);
  const importsJestGlobals = /from\s+['"]@jest\/globals['"]/.test(body);
  const importsVitest = /from\s+['"]vitest['"]/.test(body);
  const importsMocha = /from\s+['"]mocha['"]/.test(body);

  const wrong = (msg: string): string =>
    `architect wrote ${relPath} using the wrong test framework for this project (project uses ${framework}). ${msg} Re-emit using the project's framework API.`;

  switch (framework) {
    case 'node-test':
      if (usesJestExpect) return wrong('File uses Jest-style `expect(x).toBe(y)`, which node:test does not support.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'jest':
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'vitest':
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsMocha) return wrong('File imports from `mocha`.');
      return null;
    case 'mocha':
      if (usesJestExpect) return wrong('File uses Jest-style `expect(x).toBe(y)`; Mocha + chai uses `expect(x).to.equal(y)`.');
      if (importsNodeTest) return wrong('File imports from `node:test` / `node:assert`.');
      if (importsJestGlobals) return wrong('File imports from `@jest/globals`.');
      if (importsVitest) return wrong('File imports from `vitest`.');
      return null;
    case 'pytest':
      // Deferred: pytest has no single confusable peer to flag against.
      return null;
  }
}

// Without this hint, the verifier historically rewrote already-correct
// test files into Jest API and broke build-must-pass.
function renderFrameworkPreservationHint(
  framework: NonNullable<RenderContext['testFramework']>,
): string {
  return (
    `This project uses the **${framework}** test framework. Preserve it. ` +
    'Do not switch test frameworks (no Jest in node:test projects, no node:test in Jest projects, etc.) ' +
    'and do not add a different framework to package.json. Fix the failure within the existing framework.'
  );
}

function renderFailureBlock(command: string, tail: string): string {
  const capped = tail.length > 2000 ? tail.slice(-2000) : tail;
  return [
    `The verifier ran \`${command}\` against the current workspace and it failed. Tail of stderr+stdout:`,
    '```',
    capped,
    '```',
    'Diagnose the failure from this output and produce the smallest diff that fixes the root cause. Do not write speculative files.',
  ].join('\n');
}

// Marginal cost vs. the post-merge check is one extra verifier run per
// command obligation; in return the persona prompt carries the real
// error and collapses round-after-round misdiagnosis into one patch.
function preRunCommandVerifier(
  obligation: ObligationV1,
  options: Parameters<typeof verifyObligation>[1],
): string | null {
  if (
    obligation.type !== 'build-must-pass' &&
    obligation.type !== 'test-must-pass' &&
    obligation.type !== 'property-must-hold' &&
    obligation.type !== 'performance-must-not-regress'
  ) {
    return null;
  }
  const r = verifyObligation(obligation, options);
  if (r.satisfied) return null;
  // Reuse the tail from verifyObligation's detail; re-running here
  // would double the wall time.
  const m = r.detail.match(/tail:\s*([\s\S]+)$/);
  if (m && m[1]) return m[1].trim();
  return r.detail;
}

function buildRenderContext(
  obligation: ObligationV1,
  repoRoot: string,
  manifest: ContractManifest,
  commandTimeoutMs: number | undefined,
): RenderContext {
  const ctx: RenderContext = {};
  if (obligation.type === 'file-must-exist') {
    const fw = manifest.repoContext.testFramework ?? null;
    if (fw !== null) ctx.testFramework = fw;
  } else {
    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    const tail = preRunCommandVerifier(obligation, verifyOpts);
    if (tail) ctx.commandFailureTail = tail;
  }
  return ctx;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function providerAttribution(session: Session): ProviderAttribution {
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

export function listPersonaIds(registry: PersonaRegistry): string[] {
  return registry.list().map((p: PersonaSpec) => p.id);
}

interface ExecuteTournamentArgs {
  obligation: ObligationV1;
  obligationIndex: number;
  primaryPersona: PersonaSpec;
  registry: PersonaRegistry;
  session: Session;
  ledger: JsonlLedger;
  repoRoot: string;
  commandTimeoutMs: number | undefined;
  tournamentConfig: RunPopulationOptions['tournamentConfig'];
  memoStore: MemoStore | undefined;
  renderContext: RenderContext;
  fileMustExistPaths: ReadonlySet<string>;
  runId: string;
  streamingAssertions?: readonly StreamingAssertion[];
  costTracker?: LiveCostTracker;
}

interface ExecuteTournamentResult {
  satisfied: boolean;
  detail: string;
  tournament: TournamentResult;
}

async function executeTournament(args: ExecuteTournamentArgs): Promise<ExecuteTournamentResult> {
  const {
    obligation,
    obligationIndex,
    primaryPersona,
    registry,
    session,
    ledger,
    repoRoot,
    commandTimeoutMs,
    tournamentConfig,
    memoStore,
    runId,
  } = args;

  const config = {
    ...DEFAULT_TOURNAMENT_CONFIG[obligation.type],
    ...(tournamentConfig?.[obligation.type] ?? {}),
  };

  const fallback: PersonaSpec[] = registry
    .list()
    .filter((p) => p.id !== primaryPersona.id && p.handles.length === 0 ? false : p.id !== primaryPersona.id);
  const personas: TournamentPersonaSlate = { primary: [primaryPersona], fallback };

  const sink: TournamentLedgerSink = {
    recordRoundStarted(p) {
      ledger.append<TournamentRoundStartedEntry>({
        type: 'tournament-round-started',
        ...p,
      });
    },
    recordCandidate(p) {
      ledger.append<CandidateRecordedEntry>({
        type: 'candidate-recorded',
        ...p,
        ...providerAttribution(session),
      });
    },
    recordWinner(p) {
      ledger.append<TournamentWinnerSelectedEntry>({
        type: 'tournament-winner-selected',
        ...p,
      });
    },
    recordDiscard(p) {
      ledger.append<CandidateDiscardedEntry>({
        type: 'candidate-discarded',
        ...p,
        ...providerAttribution(session),
      });
    },
    recordEscalation(p) {
      ledger.append<TournamentEscalatedEntry>({
        type: 'tournament-escalated',
        ...p,
      });
    },
  };

  const tournamentOpts: Parameters<typeof runTournament>[0] = {
    obligation,
    obligationIndex,
    session,
    personas,
    config,
    renderUserMessage: (o) => renderDynamicMessage(o, repoRoot, args.renderContext),
    applyCandidate: async (candidate: TournamentCandidate, ob: ObligationV1) => {
      const pre = snapshotBeforeApply(
        repoRoot,
        runId,
        ob,
        obligationIndex,
        candidate.response.text,
      );
      const applyDetail = applyTournamentCandidate(
        repoRoot,
        ob,
        candidate.response.text,
        args.fileMustExistPaths,
      );
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
      const verifyResult = verifyObligation(ob, verifyOpts);
      if (!verifyResult.satisfied && pre) {
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
            ? `rolled back ${rb.restoredFiles.length} file(s) after tournament winner failed verification`
            : `rollback failed: ${rb.failure?.detail ?? 'unknown'}`,
        });
      }
      return {
        satisfied: verifyResult.satisfied,
        detail: `${applyDetail}; ${verifyResult.detail}`,
      };
    },
    ledgerSink: sink,
    streamingSink: {
      recordStreamAborted(p) {
        ledger.append<CandidateStreamAbortedEntry>({
          type: 'candidate-stream-aborted',
          ...p,
        });
      },
    },
  };
  if (memoStore !== undefined) tournamentOpts.memoStore = memoStore;
  if (args.streamingAssertions !== undefined) tournamentOpts.streamingAssertions = args.streamingAssertions;
  if (args.costTracker !== undefined) tournamentOpts.costTracker = args.costTracker;
  const result = await runTournament(tournamentOpts);

  if (result.satisfied) {
    return {
      satisfied: true,
      detail: result.detail,
      tournament: result,
    };
  }
  return {
    satisfied: false,
    detail: result.detail,
    tournament: result,
  };
}

function applyTournamentCandidate(
  repoRoot: string,
  obligation: ObligationV1,
  responseText: string,
  protectedPaths: ReadonlySet<string>,
): string {
  const trimmed = responseText.trim();
  if (trimmed === 'no-op' || trimmed === '"no-op"') {
    return 'no-op declared';
  }
  if (obligation.type === 'file-must-exist') {
    const r = applyFileEmit(repoRoot, obligation.path, responseText);
    return r.detail;
  }
  if (looksLikeUnifiedDiff(responseText)) {
    try {
      const r = applyUnifiedDiff(repoRoot, responseText, { protectedPaths });
      return r.detail;
    } catch (err) {
      return `unified diff apply error: ${(err as Error).message.slice(0, 120)}`;
    }
  }
  return 'response was neither no-op nor a unified diff; nothing applied';
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
        tracker.isCancelled() ? 'cost-cap exceeded' : null;
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
