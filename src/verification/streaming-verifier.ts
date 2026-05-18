/**
 * Phase 6: streaming-verification driver.
 *
 * Receives partial generation output from the session's streaming API at
 * intervals and evaluates checkable contract assertions against the
 * partial. When an assertion fires a violation that cannot be repaired
 * by continuing, the generation is cancelled. Tokens generated to that
 * point are still billed by the provider; tokens not generated are
 * saved.
 *
 * See `v8-overhaul-guide.md` §5.5 (multi-point verification) and
 * `v8-implementation-guide.md` §9 (Phase 6 deliverables and exit
 * criteria).
 */

import type { ObligationV1 } from '../shared-types/obligation-types';
import type {
  Session,
  SessionRequest,
  SessionStreamObserver,
  SessionStreamResult,
  SessionUsage,
  StreamDecision,
} from '../session/types';
import type { LiveCostTracker } from './live-cost-tracker';

/**
 * A checkable assertion the streaming verifier evaluates against the
 * accumulating partial output. Assertions are sync and cheap — they run
 * on every chunk. Returning `null` means "no violation observed (yet)";
 * returning a string is the violation reason and triggers an abort.
 */
export interface StreamingAssertion {
  /** Stable id used in ledger output. */
  id: string;
  /** Free-form description for error messages and benchmarks. */
  description: string;
  /**
   * Evaluate against the partial. Return null when nothing is wrong;
   * return a string violation reason to fire an abort.
   */
  evaluate(args: {
    obligation: ObligationV1;
    partialText: string;
  }): string | null;
}

/**
 * The default forbidden-imports assertion. Detects import / require
 * statements referencing any module name in the configured deny list.
 * A canonical doomed-obligation example from the impl guide §9 is
 * "import a package that doesn't exist": once the candidate writes the
 * import line, the assertion fires and the rest of the generation is
 * not paid for.
 *
 * The matcher recognises:
 *   - JS / TS:    `import … from 'name'`, `require('name')`,
 *                 `import 'name'`, `import('name')` (dynamic)
 *   - Python:     `import name`, `from name import …`
 *
 * Names match by prefix to catch submodule references (e.g. listing
 * `forbidden-pkg` rejects `from forbidden-pkg.sub import X`).
 */
export function forbiddenImportsAssertion(
  forbidden: readonly string[],
): StreamingAssertion {
  const cleaned = forbidden.map((s) => s.trim()).filter((s) => s.length > 0);
  return {
    id: 'forbidden-imports',
    description:
      cleaned.length === 0
        ? 'forbidden-imports (no entries; assertion is a no-op)'
        : `forbidden-imports: ${cleaned.join(', ')}`,
    evaluate({ partialText }) {
      if (cleaned.length === 0) return null;
      for (const name of cleaned) {
        if (matchesForbiddenImport(partialText, name)) {
          return `partial output references forbidden import "${name}"`;
        }
      }
      return null;
    },
  };
}

/**
 * Test whether `text` contains an import / require statement for the
 * given module name. Conservative on purpose: false positives waste a
 * candidate, false negatives waste an entire stream.
 */
export function matchesForbiddenImport(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // JS / TS quoted forms: `'name'`, `"name"`, including dotted submodule.
  const quoted = new RegExp(`['"\`]${escaped}(?:[/.][^'"\`]*)?['"\`]`);
  if (quoted.test(text)) return true;
  // Python: `import name`, `import name.sub`, `from name import …`,
  //         `from name.sub import …`. Boundary on the right with end,
  //         dot, whitespace, or comma.
  const py = new RegExp(`(?:^|\\n)\\s*(?:from|import)\\s+${escaped}(?=$|\\s|\\.|,)`, 'm');
  if (py.test(text)) return true;
  return false;
}

/**
 * Check the partial against every assertion; return the first violation,
 * or null when nothing fired. Determinism: assertions evaluated in
 * registration order.
 */
export function evaluateAssertions(
  assertions: readonly StreamingAssertion[],
  obligation: ObligationV1,
  partialText: string,
): { assertionId: string; reason: string } | null {
  for (const a of assertions) {
    const reason = a.evaluate({ obligation, partialText });
    if (reason !== null) {
      return { assertionId: a.id, reason };
    }
  }
  return null;
}

/** Aggregate result of a streaming-verified completion. */
export interface StreamingVerifierOutcome {
  /** The session-stream result (whose `aborted` flag we mirror below). */
  streamResult: SessionStreamResult;
  /** True when the verifier fired an abort. */
  aborted: boolean;
  /** When aborted, the assertion id that fired. */
  abortAssertionId: string | null;
  /** When aborted, the violation reason. */
  abortReason: string | null;
  /** Character offset at which the abort fired (length of partial). */
  abortedAtChars: number;
}

/**
 * Drive a streaming completion under verifier supervision. The verifier
 * is consulted on every chunk delivered by the session; the first
 * violating assertion wins and aborts the stream.
 *
 * When `costTracker` is supplied, the stream is also gated by the
 * tracker: if projected spend (committed + in-flight estimate) crosses
 * the configured cap, the tracker's observer aborts ahead of the
 * assertion observer and the result records `'cost-cap exceeded'` as
 * the reason. The tracker is updated with the call's actual usage when
 * the stream settles, so subsequent calls see correct cumulative state.
 */
export async function runStreamingCompletion(
  session: Session,
  request: SessionRequest,
  obligation: ObligationV1,
  assertions: readonly StreamingAssertion[],
  costTracker?: LiveCostTracker,
): Promise<StreamingVerifierOutcome> {
  let abortAssertionId: string | null = null;
  let abortReason: string | null = null;
  let abortedAtChars = 0;

  const assertionObserver: SessionStreamObserver = ({ partialText }): StreamDecision => {
    const violation = evaluateAssertions(assertions, obligation, partialText);
    if (violation === null) return { kind: 'continue' };
    abortAssertionId = violation.assertionId;
    abortReason = violation.reason;
    abortedAtChars = partialText.length;
    return { kind: 'abort', reason: violation.reason };
  };

  let observer: SessionStreamObserver = assertionObserver;
  let finalize: ((usage: SessionUsage | null) => void) | null = null;
  if (costTracker) {
    const wrap = costTracker.observerForStream(assertionObserver);
    observer = wrap.observer;
    finalize = wrap.finalize;
  }

  let streamResult: SessionStreamResult;
  try {
    streamResult = await session.stream(request, observer);
  } catch (err) {
    if (finalize) finalize(null);
    throw err;
  }
  if (finalize) finalize(streamResult.response.usage);
  const aborted = streamResult.aborted;
  // Cost-cap aborts populate `abortReason` from the tracker, not from
  // an assertion. Reflect that distinction in the outcome shape.
  if (aborted && abortAssertionId === null && streamResult.abortReason !== null) {
    abortReason = streamResult.abortReason;
    abortAssertionId = COST_CAP_ASSERTION_ID;
    abortedAtChars = streamResult.response.text.length;
  }
  return {
    streamResult,
    aborted,
    abortAssertionId,
    abortReason,
    abortedAtChars: aborted ? abortedAtChars : streamResult.response.text.length,
  };
}

/** Synthetic assertion id used in ledger output when a cost-cap fired. */
const COST_CAP_ASSERTION_ID = 'cost-cap';

/**
 * Phase 6 default streaming-verifier configuration. Combines a
 * forbidden-imports assertion (configurable per run) with an empty
 * extension slot the population manager may extend at call-time.
 */
export interface StreamingVerifierConfig {
  /** Modules whose presence in the partial fires an abort. */
  forbiddenImports: readonly string[];
  /**
   * Additional caller-supplied assertions. Evaluated after the default
   * forbidden-imports assertion in the order supplied.
   */
  extraAssertions?: readonly StreamingAssertion[];
}

/** Build the assertion list a `StreamingVerifierConfig` resolves to. */
export function buildAssertions(
  config: StreamingVerifierConfig,
): readonly StreamingAssertion[] {
  const out: StreamingAssertion[] = [forbiddenImportsAssertion(config.forbiddenImports)];
  if (config.extraAssertions) out.push(...config.extraAssertions);
  return out;
}

/**
 * Convenience: zero-config verifier that disables every default
 * assertion. Useful for tests that want to assert "streaming runs but
 * never aborts".
 */
export const NULL_STREAMING_CONFIG: StreamingVerifierConfig = {
  forbiddenImports: [],
};
