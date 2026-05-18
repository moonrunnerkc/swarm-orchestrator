/**
 * Single-mode obligation executor: generate → apply → verify → reprompt.
 *
 * Extracted from manager.ts so the main loop focuses on scheduling
 * while the retry loop with reprompt-on-failure feedback lives in its
 * own module. Streaming path takes the first attempt and skips retry —
 * the streaming verifier already aborts early on forbidden imports,
 * which is its own corrective signal.
 */

import * as crypto from 'crypto';
import type { ObligationV1 } from '../contract/types';
import type { AdapterRegistry } from '../falsification/adapters/registry';
import type { FalsifierScheduler } from '../falsification/scheduler';
import { type FalsifiersFlag } from '../falsification/dispatcher';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type {
  CandidateRecordedEntry,
  CandidateStreamAbortedEntry,
  ObligationFailedEntry,
  ObligationRolledBackEntry,
  ObligationSatisfiedEntry,
} from '../ledger/types';
import type { PersonaSpec } from '../persona/types';
import type { Session, SessionRequest, SessionUsage } from '../session/types';
import { addUsage, emptyUsage } from '../session/types';
import type { LiveCostTracker } from '../verification/live-cost-tracker';
import type { StreamingAssertion, StreamingVerifierOutcome } from '../verification/streaming-verifier';
import { runStreamingCompletion } from '../verification/streaming-verifier';
import { attemptApplyAndVerify, type AttemptApplyAndVerifyResult } from './apply-verify';
import { dispatchFalsifiersForObligation } from './falsifier-dispatch';
import { providerAttribution } from './provider-attribution';
import { rollbackObligation } from './rollback';
import { type RenderContext } from './persona-message';
import { renderDynamicMessage } from './persona-message';
import { PopulationStateBuilder } from './state';
import { getLogger } from '../logger';

const _log = getLogger('population.single-mode-executor');

export interface SingleModeOptions {
  fileMustExistPaths: ReadonlySet<string>;
  runId: string;
  commandTimeoutMs: number | undefined;
  renderContext: RenderContext;
  streamingAssertions: readonly StreamingAssertion[];
  adapterRegistry: AdapterRegistry | undefined;
  falsifiers: FalsifiersFlag | undefined;
  adapterTimeBudgetMs: number | undefined;
  falsifierScheduler: FalsifierScheduler | undefined;
  costTracker: LiveCostTracker | undefined;
  retryMax?: number | undefined;
}

export interface SingleModeResult {
  satisfied: boolean;
  detail: string;
  usage: SessionUsage;
  streamingAborted: boolean;
  streamingAbortedAtChars: number;
}

/** SHA-256 helper used for response fingerprinting in ledger entries. */
function sha256(s: string): string {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * Execute a single-mode obligation: generate → apply → verify with
 * reprompt-on-failure feedback loop. Bounded at `options.retryMax`
 * (default 2) so a confused persona can't burn the run's token budget.
 */
export async function executeSingleMode(
  obligationIndex: number,
  obligation: ObligationV1,
  session: Session,
  persona: PersonaSpec,
  state: PopulationStateBuilder,
  repoRoot: string,
  ledger: JsonlLedger,
  options: SingleModeOptions,
): Promise<SingleModeResult> {
  const RETRY_MAX = options.retryMax ?? 2;
  const usingStreaming = options.streamingAssertions.length > 0;

  const dynamic = renderDynamicMessage(obligation, repoRoot, options.renderContext);
  let retryFeedback: string | null = null;
  const buildRequest = (): SessionRequest => ({
    personaId: persona.id,
    personaSystemSuffix: persona.systemSuffix,
    sampling: { ...persona.sampling },
    userMessage: retryFeedback === null ? dynamic : `${dynamic}\n\n${retryFeedback}`,
  });

  let totalUsage = emptyUsage();
  let responseText: string;
  let responseUsage: SessionUsage;
  let responseModel: string;
  let streamingOutcome: StreamingVerifierOutcome | null = null;

  if (usingStreaming) {
    streamingOutcome = await runStreamingCompletion(
      session,
      buildRequest(),
      obligation,
      options.streamingAssertions,
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
    state.setStatus(obligationIndex, 'failed');
    const failDetail = `streaming verifier aborted: ${streamingOutcome.abortReason ?? 'unspecified violation'}`;
    ledger.append<ObligationFailedEntry>({
      type: 'obligation-failed',
      obligationIndex,
      obligationType: obligation.type,
      detail: failDetail,
    });
    return {
      satisfied: false,
      detail: failDetail,
      usage: totalUsage,
      streamingAborted: true,
      streamingAbortedAtChars: streamingOutcome.abortedAtChars,
    };
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
      runId: options.runId,
      fileMustExistPaths: options.fileMustExistPaths,
      commandTimeoutMs: options.commandTimeoutMs,
      renderContext: options.renderContext,
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
      finalSatisfied = false;
      finalDetail = falsified.detail;
      if (attemptResult.pre) {
        const rb = await rollbackObligation(
          obligationIndex,
          ledger,
          repoRoot,
          options.runId,
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
    state.setStatus(obligationIndex, 'satisfied');
    ledger.append<ObligationSatisfiedEntry>({
      type: 'obligation-satisfied',
      obligationIndex,
      obligationType: obligation.type,
      detail: finalDetail,
    });
  } else {
    state.setStatus(obligationIndex, 'failed');
    ledger.append<ObligationFailedEntry>({
      type: 'obligation-failed',
      obligationIndex,
      obligationType: obligation.type,
      detail: finalDetail,
    });
  }

  return {
    satisfied: finalSatisfied,
    detail: finalDetail,
    usage: totalUsage,
    streamingAborted: false,
    streamingAbortedAtChars: 0,
  };
}