/**
 * Transient-error retry for the Copilot CLI.
 *
 * The GitHub Copilot CLI sometimes prints
 *
 *     Request failed due to a transient API error. Retrying...
 *
 * to stdout or stderr and then exits with a non-zero status code,
 * leaving the caller holding the bag. The CLI's "Retrying..." message
 * is misleading — internally it gave up. End-of-run-battery and
 * falsifier dispatch then read the failed exec as a real CLI failure,
 * which surfaces as either a `dispatcher-error` ledger entry or, worse,
 * an empty worker branch because the spawn happened in the middle of a
 * session.
 *
 * The fix is to recognize that marker and re-spawn the CLI up to a
 * bounded N times before declaring the invocation failed. The marker
 * is matched case-insensitively against the union of stdout and
 * stderr; an exit code of 0 short-circuits regardless of marker
 * presence (some Copilot prompts include the literal phrase in their
 * own text and exit cleanly).
 */

import { SwarmError } from '../../errors';

/** Minimal subprocess-result shape the retry helper needs. */
export interface TransientRetryableResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Marker the Copilot CLI prints when its API call failed transiently
 * and it is supposedly going to retry. Observed CLI versions print
 * the message verbatim with three trailing dots; the regex tolerates
 * one or more dots and case variants because the CLI is not contract.
 */
const TRANSIENT_API_ERROR_PATTERN =
  /Request failed due to a transient API error\.\s*Retrying\.{1,}/i;

/** True when the result looks like a Copilot transient-API-error exit. */
export function isTransientApiError(result: TransientRetryableResult): boolean {
  if (result.exitCode === 0) return false;
  return TRANSIENT_API_ERROR_PATTERN.test(`${result.stdout}\n${result.stderr}`);
}

export interface TransientRetryOptions<R extends TransientRetryableResult> {
  /** Maximum spawn attempts. Must be >= 1. */
  readonly maxAttempts: number;
  /**
   * Side-effect hook fired after every attempt (including transient
   * ones). The integration in `CopilotFalsifier` uses this to keep the
   * existing observability `onInvocation` semantics — every real spawn
   * goes into the per-obligation transcript so transient failures stay
   * visible.
   */
  readonly onAttempt?: (result: R, attempt: number) => void;
}

/**
 * Error thrown when every attempt returned a transient-marker result.
 * Subclass of Error so callers can branch on `instanceof` without
 * parsing the message. Keeps the last result attached as `cause` per
 * the `preserve-caught-error` lint rule.
 */
export class TransientApiRetryExhaustedError extends SwarmError {
  readonly maxAttempts: number;
  readonly lastResult: TransientRetryableResult;
  constructor(maxAttempts: number, lastResult: TransientRetryableResult, remediation?: string) {
    const tailStderr = (lastResult.stderr || '').slice(-512).trim();
    const tailStdout = (lastResult.stdout || '').slice(-512).trim();
    super(
      `copilot exec hit the transient API error marker on all ${maxAttempts} attempts ` +
        `("Request failed due to a transient API error. Retrying..." in CLI output ` +
        `followed by a non-zero exit). The CLI prints the marker as if it were retrying ` +
        `internally but exits without recovering. Last stderr tail: ` +
        `${tailStderr || '(empty)'}; last stdout tail: ${tailStdout || '(empty)'}. ` +
        `Re-run when the upstream provider is healthy or raise maxAttempts.`,
      'TRANSIENT_RETRY_EXHAUSTED',
      remediation !== undefined
        ? { cause: { lastResult }, remediation }
        : { cause: { lastResult } },
    );
    this.name = 'TransientApiRetryExhaustedError';
    this.maxAttempts = maxAttempts;
    this.lastResult = lastResult;
  }
}

/**
 * Run `invoke` up to `maxAttempts` times, retrying when the returned
 * result matches the transient-API-error marker. Returns the first
 * non-transient result. Throws `TransientApiRetryExhaustedError` if
 * every attempt was transient.
 */
export async function invokeWithTransientRetry<R extends TransientRetryableResult>(
  invoke: () => Promise<R>,
  options: TransientRetryOptions<R>,
): Promise<R> {
  const { maxAttempts, onAttempt } = options;
  if (maxAttempts < 1 || !Number.isInteger(maxAttempts)) {
    throw new Error(`invokeWithTransientRetry: maxAttempts must be a positive integer (got ${maxAttempts})`);
  }
  let lastTransient: R | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await invoke();
    if (onAttempt !== undefined) {
      onAttempt(result, attempt);
    }
    if (!isTransientApiError(result)) {
      return result;
    }
    lastTransient = result;
  }
  // lastTransient is non-null because the loop above ran at least once
  // and only assigns when a transient result was observed.
  throw new TransientApiRetryExhaustedError(maxAttempts, lastTransient as R,
    'Try: re-run when the upstream provider is healthy, or increase --max-transient-retries, or use --session-provider deterministic');
}
