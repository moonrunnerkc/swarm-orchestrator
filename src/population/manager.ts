import * as crypto from 'crypto';
import type { ContractManifest, FinalContract, ObligationV1, RepoContext } from '../contract/types';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import { MemoStore, obligationKey } from '../ledger/memoization';
import type {
  CandidateDiscardedEntry,
  CandidateRecordedEntry,
  CandidateStreamAbortedEntry,
  FalsificationCallEntry,
  ObligationAttemptedEntry,
  ObligationDeterministicAppliedEntry,
  ObligationDeterministicAttemptedEntry,
  ObligationDeterministicFailedEntry,
  ObligationFailedEntry,
  ObligationMemoizedEntry,
  ObligationPreVerifiedEntry,
  ObligationSatisfiedEntry,
  PostMergeVerifiedEntry,
  RunFinishedEntry,
  RunStartedEntry,
  TournamentEscalatedEntry,
  TournamentRoundStartedEntry,
  TournamentWinnerSelectedEntry,
} from '../ledger/types';
import type { AdapterRegistry } from '../falsification/adapters/registry';
import { dispatchFalsifiers, type FalsifiersFlag } from '../falsification/dispatcher';
import type { PersonaRegistry } from '../persona/persona-registry';
import type { PersonaSpec } from '../persona/types';
import { selectPersonaForState } from '../persona/predicates';
import type { Session, SessionUsage } from '../session/types';
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
import { applyUnifiedDiff, looksLikeUnifiedDiff } from './unified-diff';
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

/** Mode the population manager runs in. */
export type PopulationMode = 'single' | 'tournament';

export interface RunPopulationOptions {
  contract: FinalContract;
  /** Repo root the verifier and applier resolve paths against. */
  repoRoot: string;
  /** Persona registry the manager dispatches against. */
  registry: PersonaRegistry;
  /** Session used for every persona call. */
  session: Session;
  /** Ledger used to record evidence of every action. */
  ledger: JsonlLedger;
  /** Cap on commands run by the verifier. */
  commandTimeoutMs?: number;
  /** Optional cap on obligations attempted; useful for tests. */
  maxObligations?: number;
  /**
   * Execution mode: `single` runs the Phase 2 sequential path (one persona
   * per obligation, one candidate); `tournament` runs the Phase 3 path
   * (N candidates per obligation, scored by the tournament-verifier
   * persona, winner applied). Defaults to `single` for back-compat with
   * existing tests; the v8 CLI defaults to `single` for cost-efficiency
   * and pass `--mode tournament` to opt into the parallel-candidate path.
   */
  mode?: PopulationMode;
  /** Optional per-obligation-type tournament config override. */
  tournamentConfig?: Partial<Record<ObligationV1['type'], TournamentConfig>>;
  /**
   * Phase 4: obligation indexes to skip via memoization. Used by the
   * resume path: indexes already satisfied in a prior run are recorded
   * as `obligation-memoized` and the synthesis path is bypassed.
   */
  skipObligationIndexes?: ReadonlySet<number>;
  /**
   * Phase 4: optional memo store. The manager populates it during the
   * run and hands it to each tournament. Callers that want
   * cross-obligation in-run memoization pass an empty store; passing
   * null/undefined disables in-run memoization.
   */
  memoStore?: MemoStore;
  /**
   * Phase 5: optional WASM deterministic-floor runtime. When supplied,
   * obligations whose `deterministicStrategy` resolves to a registered
   * strategy are dispatched through the runtime instead of the
   * synthesis path. A failure on the deterministic side reroutes the
   * obligation to synthesis (impl guide §8 misclassification recovery)
   * — the exact synthesis path that runs depends on `mode`.
   */
  wasmRuntime?: WasmRuntime;
  /**
   * Phase 5: optional per-strategy wall-time budget, ms. Forwarded to
   * `WasmRuntime.dispatch`. Default per-strategy timeout in
   * `wasm-runtime.ts` applies when omitted.
   */
  strategyTimeoutMs?: number;
  /**
   * Phase 6: streaming-verification configuration. When supplied, the
   * single-mode generation path uses `session.stream()` with the
   * configured assertions and may abort mid-generation. When omitted,
   * the manager falls back to non-streaming `session.complete()` (the
   * Phase 2/3 behaviour). Tournament candidate generation is
   * intentionally NOT streaming-routed: tournaments race candidates in
   * parallel and the cheap verifier picks the winner; mid-stream abort
   * inside a tournament round breaks the race fairness. Streaming for
   * tournament candidates is logged as a Phase 7 follow-up.
   */
  streaming?: StreamingVerifierConfig;
  /**
   * Phase 6: when true, run a pre-generation verification pass over
   * every still-pending obligation (after memoization and the
   * deterministic floor) and skip any that the live workspace already
   * satisfies. Defaults to false to preserve Phase 2/3/4/5 wall-time.
   */
  preGeneration?: boolean;
  /**
   * Phase 6: when true, run a post-merge integration check after the
   * synthesis loop completes. Failure flips the run's `failed` count
   * to non-zero and emits a `post-merge-verified` ledger entry.
   * Defaults to false.
   */
  postMerge?: boolean;
  /**
   * Adapter-reintegration: falsification-dispatcher feature flag. When
   * `'on'` (default) and a falsifier registry is supplied, the manager
   * dispatches every registered adapter that handles the obligation type
   * after the producer's verifier marks the patch satisfied. A
   * confirmed counter-example flips the obligation status to failed and
   * appends a `falsification-call` ledger entry with the adapter's cost
   * and yield. When `'off'` or no registry is supplied, the dispatcher
   * is bypassed and the run is identical to pre-Phase-2 behaviour.
   */
  falsifiers?: FalsifiersFlag;
  /**
   * Adapter-reintegration: registry of falsifier adapters to dispatch
   * after each obligation. Caller-supplied so tests can inject a fake
   * registry without spawning real Codex/Copilot CLIs. Production wires
   * `defaultAdapterRegistry()` at the run-handler layer.
   */
  adapterRegistry?: AdapterRegistry;
  /**
   * Adapter-reintegration: per-adapter wall-clock budget, ms. Defaults
   * to 60_000 (60s). The dispatcher passes this through unchanged; each
   * adapter must self-bound to it.
   */
  adapterTimeBudgetMs?: number;
}

/** Per-obligation outcome the manager hands back to the caller. */
export interface ObligationOutcome {
  obligationIndex: number;
  obligation: ObligationV1;
  personaId: string | null;
  satisfied: boolean;
  detail: string;
  /**
   * Tournament evidence when mode === 'tournament'. Null in single mode
   * or when the obligation never reached the tournament path.
   */
  tournament?: TournamentResult | null;
}

/** Aggregate result of running the contract. */
export interface RunPopulationResult {
  outcomes: ObligationOutcome[];
  satisfied: number;
  failed: number;
  totalUsage: SessionUsage;
  /** Wall time for the whole run, ms. */
  wallTimeMs: number;
  /** Mode the run executed under. */
  mode: PopulationMode;
  /** Phase 4: number of obligations satisfied via memoization (no synthesis). */
  memoizedObligations: number;
  /** Phase 4: total verifier calls saved via in-run candidate-hash dedup. */
  verifierCallsSavedByMemoization: number;
  /**
   * Phase 5: number of obligations satisfied via the WASM deterministic
   * floor (zero LLM tokens consumed). Counted separately from
   * `memoizedObligations` so the §8 cost benchmark can attribute savings.
   */
  deterministicObligations: number;
  /**
   * Phase 5: number of obligations whose deterministic strategy ran but
   * was rerouted to synthesis (misclassification recovery). The
   * obligation may still end up satisfied via synthesis; this counter
   * captures the runtime's miss rate.
   */
  deterministicReroutes: number;
  /**
   * Phase 6: number of obligations satisfied by the pre-generation pass
   * (live workspace already passes; no LLM tokens, no deterministic
   * strategy, no memoization hit). Counted separately so the §9 cost
   * benchmark can attribute savings.
   */
  preVerifiedObligations: number;
  /**
   * Phase 6: number of streaming candidate generations the streaming
   * verifier aborted mid-stream. Each abort saves the cost of the
   * remaining (un-generated) tokens; the ledger captures token usage
   * up to the abort point per candidate.
   */
  streamingAbortedCandidates: number;
  /**
   * Phase 6: total characters of partial output generated before the
   * streaming verifier fired its abort. Only counts aborted candidates;
   * a proxy for "tokens billed before abort" and a denominator for the
   * §9 savings claim.
   */
  streamingCharsBeforeAbort: number;
  /**
   * Phase 6: post-merge integration-check result. `null` when the
   * manager was run with `postMerge: false` (the default).
   */
  postMerge: PostMergeRunOutcome | null;
}

/** Phase 6: post-merge result the manager hands back. */
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

/**
 * Population manager. Walks unsatisfied obligations sequentially. For
 * each obligation, picks the persona via predicate evaluation and either:
 *   - `single` mode (Phase 2): one call, one candidate, apply, verify.
 *   - `tournament` mode (Phase 3): N candidates per round, verifier
 *     picks the winner, winner applied + verified; loser candidates are
 *     logged with full diff hash and token cost.
 *
 * Returns aggregate outcomes plus session usage and wall time.
 */
export async function runPopulation(
  options: RunPopulationOptions,
): Promise<RunPopulationResult> {
  const start = Date.now();
  const { contract, repoRoot, registry, session, ledger, commandTimeoutMs } = options;
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
  /**
   * Phase 5: track which obligation indexes have already failed their
   * deterministic dispatch this run. Used to prevent re-attempting the
   * strategy after we've rerouted to synthesis (§8: "no retry of the
   * WASM module").
   */
  const deterministicTried = new Set<number>();

  ledger.append<RunStartedEntry>({
    type: 'run-started',
    contractId: contract.manifest.contractId,
    contractHash: contract.manifest.contractHash,
    obligationCount: contract.obligations.length,
    goal: contract.manifest.goal,
  });

  // Phase 4: pre-mark skipped obligations as satisfied via memoization.
  // The audit trail records one `obligation-memoized` entry per skip.
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

  // Phase 5: deterministic-floor pre-pass. Walk every pending obligation
  // tagged with a registered strategy and dispatch through the runtime
  // before the predicate loop fires. Successful dispatches mark the
  // obligation `satisfied` and the predicate loop never picks it up;
  // failures fall through to synthesis.
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

  // Phase 6: pre-generation verification pass. Walk every pending
  // obligation (after memoization + deterministic) and check whether
  // the live workspace already satisfies it. Skips with an
  // `obligation-pre-verified` ledger entry. Order matters: memoization
  // and the deterministic floor are cheaper than running build / test
  // commands; pre-generation only inspects obligations that survived
  // both prior cheap paths.
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
        renderContext: tournamentRenderCtx,
        fileMustExistPaths,
      });
      totalUsage = addUsage(totalUsage, result.tournament.usage);
      verifierCallsSavedByMemoization += result.tournament.verifierCallsSavedByMemoization;
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
        });
        if (falsified !== null) {
          tournamentSatisfied = false;
          tournamentDetail = falsified;
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
    const sessionRequest = {
      personaId: persona.id,
      personaSystemSuffix: persona.systemSuffix,
      sampling: { ...persona.sampling },
      userMessage: dynamic,
    } as const;

    let responseText: string;
    let responseUsage: SessionUsage;
    let responseModel: string;
    let streamingOutcome: StreamingVerifierOutcome | null = null;
    if (usingStreaming) {
      streamingOutcome = await runStreamingCompletion(
        session,
        sessionRequest,
        obligation,
        streamingAssertions,
      );
      responseText = streamingOutcome.streamResult.response.text;
      responseUsage = streamingOutcome.streamResult.response.usage;
      responseModel = streamingOutcome.streamResult.response.model;
    } else {
      const response = await session.complete(sessionRequest);
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

    ledger.append<CandidateRecordedEntry>({
      type: 'candidate-recorded',
      obligationIndex,
      personaId: persona.id,
      responseSha256: sha256(responseText),
      usage: responseUsage,
      model: responseModel,
    });

    if (obligation.type === 'file-must-exist') {
      applyFileEmit(repoRoot, obligation.path, responseText);
    } else if (responseText.trim() === 'no-op') {
      // No-op declared — leave the workspace unchanged; verifier decides.
    } else if (looksLikeUnifiedDiff(responseText)) {
      try {
        // Protect file-must-exist paths from cross-persona overwrites:
        // the architect already owns these files. A diff that targets one
        // is dropped (skip that patch only, not the whole diff) so the
        // architect's body is preserved.
        applyUnifiedDiff(repoRoot, responseText, {
          protectedPaths: fileMustExistPaths,
        });
      } catch {
        // The verifier will detect the failure; manager surfaces it.
      }
    }

    const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
    if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
    let verifyResult = verifyObligation(obligation, verifyOpts);

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

    let finalSatisfied = verifyResult.satisfied;
    let finalDetail = verifyResult.detail;
    if (verifyResult.satisfied) {
      const falsified = await runFalsifiersForObligation({
        obligation,
        obligationIndex,
        repoRoot,
        ledger,
        registry: options.adapterRegistry,
        falsifiers: options.falsifiers ?? 'on',
        timeBudgetMs: options.adapterTimeBudgetMs ?? 60_000,
      });
      if (falsified !== null) {
        finalSatisfied = false;
        finalDetail = falsified;
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

  // Phase 6: post-merge integration verification. Re-runs every
  // obligation in the contract end-to-end against the workspace as it
  // actually is once everyone has committed. Failure at this layer
  // promotes any previously-satisfied obligation that no longer holds
  // into the failed bucket and emits an audit-trail entry.
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
    if (!pm.passed) {
      // Promote the regression into the run's failure count. We don't
      // mutate the per-obligation outcomes (those reflect the apply-time
      // result) but we make sure `run.failed > 0` so the CLI exit code
      // reflects the integration failure.
      const regressionGap = pm.failedCount;
      if (failed === 0 && regressionGap > 0) {
        failed = regressionGap;
        satisfied = Math.max(0, satisfied - regressionGap);
      }
    }
  }

  ledger.append<RunFinishedEntry>({
    type: 'run-finished',
    satisfied,
    failed,
    totalUsage,
  });

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

/**
 * Phase 5: dispatch a single deterministic-tagged obligation through
 * the WASM runtime. Emits the trio
 * `obligation-deterministic-attempted` (always),
 * `obligation-deterministic-applied` (on success), and
 * `obligation-deterministic-failed` (on any failure). On success also
 * emits `obligation-satisfied` so memoization and downstream tooling
 * see the same shape they see for synthesis-satisfied obligations.
 *
 * §8 misclassification recovery: this helper never retries a failing
 * strategy. The caller (the manager pre-pass) tracks attempted indexes
 * and lets the predicate loop reroute the obligation to synthesis.
 */
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

  // Strategy applied; run the standard verifier.
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

/**
 * Optional pre-computed context the manager builds and threads into the
 * persona prompt. Each field addresses a real failure mode observed in
 * production runs:
 *
 *   - `commandFailureTail`: for command-shaped obligations (build / test /
 *     property / coverage / performance) the manager pre-runs the verifier
 *     once and embeds the failure tail. Without this, the implementer is
 *     told to "make build pass" with zero signal about why it's failing,
 *     and historically responded with off-target diffs (e.g. creating new
 *     files at unrelated paths). Pre-running is cheap because the
 *     post-merge check already pays for it.
 *
 *   - `testFramework`: for `file-must-exist` targeting a test file
 *     (`.test.`, `.spec.`, `__tests__/`, `_test.py`), the architect needs
 *     to know which test API is in scope. Without this hint the architect
 *     defaults to the most-common-on-the-internet API (Jest) and writes
 *     `expect(x).toBe(y)` into projects that use `node --test` /
 *     `node:assert` and don't have Jest installed. Discovered by
 *     `discoverRepoContext` from package.json deps; passed through
 *     verbatim.
 */
export interface RenderContext {
  commandFailureTail?: string;
  testFramework?: 'jest' | 'mocha' | 'vitest' | 'node-test' | 'pytest' | null;
}

/**
 * Build the per-call user message for an obligation. The contract context
 * (goal, repo summary) is sent once via the cached system block; only the
 * per-obligation specifics go here so cache hits dominate.
 *
 * The optional `context` parameter carries pre-computed diagnostics
 * (command failure tail, test-framework hint). The fallback shape (no
 * context) is preserved for callers — tests, the tournament harness's
 * default `renderUserMessage`, and any future caller that wants the
 * minimal prompt.
 */
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
      // For test files, the framework hint goes FIRST and is the most
      // important line in the prompt: it has historically been the
      // single highest-impact instruction (Sonnet defaults to Jest API
      // when unhinted, breaking node:test / Mocha / Vitest projects).
      // Promoting the hint above the generic "emit a fenced block"
      // instruction makes it structurally salient.
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

/**
 * Decide whether a `file-must-exist` path looks like a test file, and if
 * so render a one-line hint naming the project's test framework. The hint
 * is deliberately prescriptive: when we know the framework, the architect
 * MUST use that framework's API, because the default-without-hint is
 * Jest-shaped (test/expect) and lands broken in node:test / Mocha /
 * Vitest projects. When framework is null we say nothing — over-specifying
 * is worse than under-specifying.
 */
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

/** Predicate used by the architect's test-framework hint and by tests. */
export function isTestFilePath(relPath: string): boolean {
  return TEST_FILE_PATTERN.test(relPath);
}

/**
 * Detect when a freshly-written test file uses a different framework's
 * API than the project's. Returns a human-readable failure detail when a
 * misuse is found, or `null` when the file aligns with the framework.
 *
 * The check is deliberately conservative: only obvious cross-framework
 * imports / API references trip it. Two frameworks that look identical
 * at the API surface (e.g. Jest and Vitest both use `describe`/`it`/
 * `expect`) are not flagged against each other; the cost of a false
 * positive — telling the architect to rewrite a perfectly valid file —
 * is higher than the cost of letting an ambiguous case through.
 */
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
      // Python misuse detection deferred — pytest doesn't have a single
      // confusable peer to flag against, and the LLM-emitted-Python path
      // is rare enough not to justify hard-coding rules here yet.
      return null;
  }
}

/**
 * For build/test obligations, tell the implementer/verifier to preserve
 * the project's existing test framework. Without this, the verifier
 * historically rewrote the architect's already-correct test files into a
 * different framework's API (typically Jest) on the assumption that
 * Jest is the universal default. The result was a "test-must-pass" diff
 * that broke "build-must-pass" and required manual fixup.
 */
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
  // Cap tail length so the prompt stays bounded; the tail is meant to
  // surface error messages and stack frames, not a full log.
  const capped = tail.length > 2000 ? tail.slice(-2000) : tail;
  return [
    `The verifier ran \`${command}\` against the current workspace and it failed. Tail of stderr+stdout:`,
    '```',
    capped,
    '```',
    'Diagnose the failure from this output and produce the smallest diff that fixes the root cause. Do not write speculative files.',
  ].join('\n');
}

/**
 * Pre-run a command-shaped obligation's verifier to capture failure
 * detail. Returns null when the obligation already passes (no failure
 * tail to surface) or when the obligation type is not command-shaped.
 *
 * Used by the manager to build a `RenderContext` immediately before
 * dispatching the obligation. Cost: one verifier call per command-shaped
 * obligation that's about to be synthesized. The post-merge check already
 * runs every verifier once, so the marginal cost is one extra
 * pre-dispatch run per command obligation. In return, the persona prompt
 * carries the actual error, which collapses round-after-round
 * misdiagnosis into a single targeted patch.
 */
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
  // verifyObligation's `detail` already contains "command \"X\" exited N;
  // tail: <up to 512 chars>" — we surface that tail directly to the
  // persona because re-running here would double the wall time.
  const m = r.detail.match(/tail:\s*([\s\S]+)$/);
  if (m && m[1]) return m[1].trim();
  return r.detail;
}

/**
 * Build a `RenderContext` for a single obligation. Pure for
 * `file-must-exist` (just consults the manifest); side-effecting for
 * command-shaped obligations (runs the verifier once to capture the
 * failure tail). The verify call is bounded by the manager's
 * `commandTimeoutMs`.
 */
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

/** Persona helper used by tests: list the personas a given registry exposes. */
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
  /**
   * Pre-computed render context (command failure tail, test framework
   * hint). Threaded through to the per-candidate prompt so every
   * tournament candidate sees the same diagnostic input as single mode.
   */
  renderContext: RenderContext;
  /**
   * Repo-relative paths owned by file-must-exist obligations elsewhere in
   * the contract. The tournament's diff applier drops patches targeting
   * these paths so the architect's body is preserved across persona turns.
   */
  fileMustExistPaths: ReadonlySet<string>;
}

interface ExecuteTournamentResult {
  satisfied: boolean;
  detail: string;
  tournament: TournamentResult;
}

/**
 * Per-obligation tournament dispatcher used by the manager when
 * `mode === 'tournament'`. Builds the persona slate from the registry,
 * applies the per-type config, and turns ledger sink callbacks into
 * `JsonlLedger` writes.
 */
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
      const applyDetail = applyTournamentCandidate(
        repoRoot,
        ob,
        candidate.response.text,
        args.fileMustExistPaths,
      );
      const verifyOpts: Parameters<typeof verifyObligation>[1] = { repoRoot };
      if (commandTimeoutMs !== undefined) verifyOpts.commandTimeoutMs = commandTimeoutMs;
      const verifyResult = verifyObligation(ob, verifyOpts);
      return {
        satisfied: verifyResult.satisfied,
        detail: `${applyDetail}; ${verifyResult.detail}`,
      };
    },
    ledgerSink: sink,
  };
  if (memoStore !== undefined) tournamentOpts.memoStore = memoStore;
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

/**
 * Apply a candidate's response to the workspace. Picks between the
 * fenced single-file applier (architect-style) and the unified-diff
 * applier (implementer/verifier-style) based on response shape and
 * obligation type. Returns a short detail string for the ledger.
 */
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
}

/**
 * Adapter-reintegration: dispatch every adapter that handles the
 * obligation type after the producer's verifier has marked the patch
 * satisfied. Returns a falsification detail string when any adapter
 * confirmed a counter-example (caller flips the obligation to failed),
 * or null when no falsification was found / dispatcher disabled / no
 * registry supplied.
 *
 * Each adapter call appends a `falsification-call` ledger entry with
 * cost and yield. Adapter throws are caught and recorded as failed
 * dispatch entries; an adapter going sideways must not crash the run
 * (the producer's verifier already approved the patch).
 */
async function runFalsifiersForObligation(
  args: RunFalsifiersArgs,
): Promise<string | null> {
  const { obligation, obligationIndex, repoRoot, ledger, registry, falsifiers } = args;
  if (falsifiers === 'off' || registry === undefined) return null;
  if (registry.forObligation(obligation.type).length === 0) return null;
  let outcome;
  try {
    outcome = await dispatchFalsifiers(obligation, registry, {
      falsifiers,
      timeBudgetMs: args.timeBudgetMs,
      workspaceRoot: repoRoot,
      contextRefs: [],
      // The v8 run path does not commit per obligation; adapters that
      // want a SHA can `git rev-parse HEAD` inside the workspace. We
      // pass the empty string as a sentinel so they can detect the
      // uncommitted-workspace case.
      patchSha: '',
    });
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
