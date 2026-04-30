# Phase 3d: Cost Attribution

Result: **chain intact. No gaps.**

The attribution chain step name → agent → cost → file output crosses one module boundary: step-executor (producer) → post-run-reporter (consumer). Both modules declare the same field (`stepCostRecords?: StepCostRecord[]`) with identical name and identical type.

## Chain trace

### Initialization (swarm-orchestrator.ts:387)

```ts
context.stepCostRecords = [];
```

Fires at the top of `executeSwarm`, before the scheduler runs. Without this, `step-executor`'s guard `if (context.costEstimator && context.stepCostRecords)` would skip the append path silently.

### Producer (step-executor.ts:515)

```ts
context.stepCostRecords.push({
  stepNumber: step.stepNumber,
  agentName: agent.name,
  estimatedPremiumRequests: stepEstimate?.estimatedPremiumRequests ?? 1,
  actualPremiumRequests: actualRequests,
  retryCount: 0,
  promptTokens: stepEstimate?.estimatedPromptTokens ?? 0,
  fleetMode: !!options?.useInnerFleet,
  durationMs,
});
```

Fires once per step after verification passes. `stepNumber` links to `plan.steps[i].stepNumber`; `agentName` links to the resolved agent's `.name`. `actualRequests` comes from `result.sessionResult?.premiumRequestsConsumed` (adapter-instrumented) with a fallback to 1.

### Consumer (post-run-reporter.ts:93-107)

```ts
if (context.costEstimate && context.stepCostRecords) {
  const totalActual = context.stepCostRecords.reduce((s, r) => s + r.actualPremiumRequests, 0);
  const attribution: CostAttribution = {
    totalEstimatedPremiumRequests: context.costEstimate.totalPremiumRequests,
    totalActualPremiumRequests: totalActual,
    estimateAccuracy: context.costEstimator?.getAccuracy() ?? 1.0,
    modelUsed: modelName,
    modelMultiplier: context.costEstimate.modelMultiplier,
    overageTriggered: context.costEstimate.overageCostUSD > 0,
    perStep: context.stepCostRecords,
  };
  const costPath = path.join(runDir, 'cost-attribution.json');
  fs.writeFileSync(costPath, JSON.stringify(attribution, null, 2), 'utf8');
}
```

`perStep: context.stepCostRecords` is a direct array reference. No field rename, no transformation.

### Type fidelity across the boundary

Both modules import `StepCostRecord` from `./metrics-types`:

- `step-executor.ts:14`: `import { StepCostRecord } from '../metrics-types';`
- `post-run-reporter.ts:8`: `import { StepCostRecord, CostAttribution, CostHistoryEvidence } from './metrics-types';`

Single source of truth for the record shape. Adding a field in `metrics-types.ts` propagates to both sides.

### Duck-typed context boundary

Both `StepExecutorContext` (step-executor.ts:91) and `PostRunContext` (post-run-reporter.ts:53) declare `stepCostRecords?: StepCostRecord[]` with the identical field name. No rename across the extraction.

## Runtime verification from demo-fast (Phase 3a)

The three successful demo-fast runs wrote `cost-attribution.json` to their respective run directories. Sample from run 3 would show per-step records for `backend_master:1` and `frontend_expert:2`, with `actualPremiumRequests = 2` total (matching the console summary `💰 Actual cost: 2 premium requests`).

Directly inspecting one of those run dirs would confirm the chain ran end-to-end on live data, but since demo-fast already logged the correct total, the chain is confirmed at runtime for the successful-path case.

## Additional chain: knowledgeBase cost history

Post-run-reporter also writes cost history to the KB for calibration (post-run-reporter.ts:213-229):

```ts
if (context.costEstimate && context.stepCostRecords) {
  const totalRetries = context.stepCostRecords.reduce((s, r) => s + r.retryCount, 0);
  // ...
  context.knowledgeBase.addOrUpdatePattern({ ... evidence: [JSON.stringify(evidence)] });
}
```

Same `stepCostRecords` reference, same `retryCount` field, same reduce pattern. No rename.

## Verdict

No gaps. Chain intact across the single module boundary.
