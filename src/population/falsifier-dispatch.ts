/**
 * Falsifier dispatch for a single obligation.
 *
 * Extracted from manager.ts so the manager's main loop stays focused on
 * scheduling while falsification details (adapter dispatch, dispatcher
 * error capture, counter-example recording) live in their own module.
 * Adapter throws are caught and recorded as failed dispatch entries:
 * an adapter going sideways must not crash the run, the producer's
 * verifier has already approved the patch.
 */

import type { ObligationV1 } from '../contract/types';
import type { AdapterRegistry } from '../falsification/adapters/registry';
import { dispatchFalsifiers, type FalsifiersFlag } from '../falsification/dispatcher';
import type { FalsifierScheduler } from '../falsification/scheduler';
import type { JsonlLedger } from '../ledger/jsonl-ledger';
import type {
  FalsificationCallEntry,
  FalsifierDispatchDecisionEntry,
} from '../ledger/types';
import { COST_CAP_ABORT_REASON, type LiveCostTracker } from '../verification/live-cost-tracker';
import { getLogger } from '../logger';

const _log = getLogger('population.falsifier-dispatch');

export interface DispatchFalsifiersResult {
  /** True when a counter-example was found (the obligation should be rejected). */
  counterExample: boolean;
  /** Human-readable detail of the first counter-example, or empty string. */
  detail: string;
}

export async function dispatchFalsifiersForObligation(
  obligationIndex: number,
  obligation: ObligationV1,
  adapterRegistry: AdapterRegistry | undefined,
  ledger: JsonlLedger,
  repoRoot: string,
  falsifiers: FalsifiersFlag,
  timeBudgetMs: number,
  scheduler?: FalsifierScheduler,
  costTracker?: LiveCostTracker,
): Promise<DispatchFalsifiersResult> {
  if (falsifiers === 'off' || adapterRegistry === undefined) {
    return { counterExample: false, detail: '' };
  }
  if (adapterRegistry.forObligation(obligation.type).length === 0) {
    return { counterExample: false, detail: '' };
  }

  let outcome;
  try {
    const dispatchOpts: Parameters<typeof dispatchFalsifiers>[2] = {
      falsifiers,
      timeBudgetMs,
      workspaceRoot: repoRoot,
      contextRefs: [],
      patchSha: '',
    };
    if (scheduler) (dispatchOpts as { scheduler?: FalsifierScheduler }).scheduler = scheduler;
    if (costTracker) {
      (dispatchOpts as { shouldCancel?: () => string | null }).shouldCancel = () =>
        costTracker.isCancelled() ? COST_CAP_ABORT_REASON : null;
    }
    outcome = await dispatchFalsifiers(obligation, adapterRegistry, dispatchOpts);
    if (scheduler) scheduler.flush();
    if (outcome.dispatchDecision) {
      ledger.append<FalsifierDispatchDecisionEntry>({
        type: 'falsifier-dispatch-decision',
        obligationIndex,
        obligationType: obligation.type,
        kind: outcome.dispatchDecision.kind,
        order: outcome.dispatchDecision.order.slice(),
        scores: outcome.dispatchDecision.scores.map((s) => ({
          adapter: s.adapter,
          score: Number.isFinite(s.score) ? s.score : null,
        })),
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
    return { counterExample: false, detail: '' };
  }

  if (outcome.disabled) return { counterExample: false, detail: '' };

  let firstCounterExampleDetail: string | null = null;
  for (const call of outcome.calls) {
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
      counterExamplesFound: call.cost.counterExamplesFound,
      wallClockMs: call.cost.wallClockMs,
      dollarsBilled: call.cost.dollarsBilled,
      dollarsApiEquivalent: call.cost.dollarsApiEquivalent,
      detail,
    });
  }

  if (firstCounterExampleDetail !== null) {
    return { counterExample: true, detail: firstCounterExampleDetail };
  }
  return { counterExample: false, detail: '' };
}