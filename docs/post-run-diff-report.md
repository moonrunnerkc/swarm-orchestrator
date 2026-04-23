# Post-Run Duplicate Diff Report

Per the Phase 2 plan ("post-run duplication — mandatory diff before deletion"), this report walks through `swarm-orchestrator.ts` lines 909-1101 (inline block) and `src/post-run-reporter.ts` `runPostExecution` (extracted module) section by section. Two divergences were found.

## Structural overview

The inline block and `runPostExecution` are structurally identical: four sequential sections gated on the same conditions, in the same order.

| Section | Guard | Inline lines | Extracted lines |
|---|---|---|---|
| 1. Metrics / cost-attribution / session-state | `context.metricsCollector` | 917-983 | 54-120 |
| 2. OWASP compliance report | `options.owaspReport` | 985-1042 | 122-179 |
| 3. KB `recordRun` + cost-history pattern | `context.knowledgeBase` | 1044-1073 | 181-210 |
| 4. Auto-PR creation | `options.autoPR` | 1075-1099 | 212-239 |

Side effects, file writes, and logger call sites line up one-for-one in sections 1, 2, and 3.

## Divergence 1 — logger scope

**Inline:** uses the module-level `logger` from `swarm-orchestrator.ts`, scope `'orchestrator'`.

**Extracted:** `getLogger('post-run')` at line 21.

**Behavioral impact:** log prefixes change. Messages like `📊 Metrics saved: ...`, `  OWASP ASI: ...`, `⚠️  PR creation failed: ...` will appear under `[post-run]` instead of `[orchestrator]` once the swap lands.

**Classification:** case (b) per the Phase 2 plan — the extracted module does something the inline code does not (logs under a different scope). Intended by design: a different module should have its own scope so log output stays diagnostic. Confirming intent: acceptable.

**Action:** no port. The scope change is the new baseline after the swap. This diff report is the record of the intentional change.

## Divergence 2 — `autoPR` path loses `mainBranch`

**Inline (`swarm-orchestrator.ts:1086-1089`):**
```ts
const prAutomation = new PRAutomation(toolManager, this.workingDir);
const deployments = deploymentManager.loadDeploymentMetadata(runDir);
const summary = prAutomation.generatePRSummary(context, deployments);
```
`context` is the full `SwarmExecutionContext`, which has `mainBranch: string`.

**Extracted (`post-run-reporter.ts:222-228`):**
```ts
const prAutomation = new PRAutomation(toolManager, workingDir);
const deployments = deploymentManager.loadDeploymentMetadata(runDir);
// generatePRSummary expects SwarmExecutionContext; supply the subset it reads
const prContext = { ...context, plan, runDir } as unknown as import('./swarm-orchestrator').SwarmExecutionContext;
const summary = prAutomation.generatePRSummary(prContext, deployments);
```
`prContext` is built from `PostRunContext` (which has **no** `mainBranch` field) + `plan` + `runDir`.

**What `generatePRSummary` reads** (from `src/pr-automation.ts:27-78`):
- `context.results` ← in PostRunContext ✓
- `context.executionId` ← in PostRunContext ✓
- `context.plan.goal` ← added via spread ✓
- `context.mainBranch` ← **missing**; becomes `undefined`
- Returns `{ baseBranch: context.mainBranch, ... }` — the PR would be created with `--base undefined`.

**Behavioral impact:** running with `--auto-pr` through the extracted module would produce a broken PR (`gh pr create --base undefined ...`) or crash downstream depending on how `undefined` is stringified. The inline version gets the real `mainBranch` from `context` and creates a correct PR.

**Classification:** case (a) per the Phase 2 plan — the inline code does something `runPostExecution` does not (passes `mainBranch` into `generatePRSummary`). Must be ported into `runPostExecution` before the swap.

**Fix to port:** add `mainBranch: string` to `PostRunContext`; include it in the spread that builds `prContext`.

**Test to add:** `test/post-run-reporter.test.ts` case that exercises the `autoPR` branch and asserts the `generatePRSummary` call receives a context whose `mainBranch` matches the input.

## Fields read that live on the full `SwarmExecutionContext` but not on `PostRunContext`

Reviewed every field read inside `runPostExecution`:

| Field read | In PostRunContext? | In spread addition? | OK? |
|---|---|---|---|
| `context.metricsCollector` | yes | — | ✓ |
| `context.costEstimate` | yes | — | ✓ |
| `context.stepCostRecords` | yes | — | ✓ |
| `context.costEstimator` | yes | — | ✓ |
| `context.results` | yes | — | ✓ |
| `context.knowledgeBase` | yes | — | ✓ |
| `context.waveAnalyses` | yes | — | ✓ |
| `context.finalGateResults` | yes | — | ✓ |
| `context.executionId` | yes | — | ✓ |
| `plan` (parameter) | param | — | ✓ |
| `plan.goal` | via param | added by spread for PR path | ✓ |
| `runDir` (parameter) | param | added by spread for PR path | ✓ |
| `context.mainBranch` (read in generatePRSummary) | **NO** | **NO** | ✗ — divergence 2 |

No other fields read. Divergence 2 is the only `generatePRSummary`-boundary gap.

## Execution order

Sections fire in the same order in both paths: metrics → OWASP → KB → autoPR.

One subtle timing note: the inline block runs **after** `mergeAllBranches` (swarm-orchestrator.ts:915). When swapping to `runPostExecution`, the call site will still be post-merge, so timing is preserved.

## Summary

- Section 1 (metrics / session state): identical.
- Section 2 (OWASP): identical except logger scope — divergence 1, intentional.
- Section 3 (KB recordRun + cost history): identical.
- Section 4 (autoPR): divergence 2 — missing `mainBranch`. Must port before swap.

## Next actions

1. Add `mainBranch: string` to `PostRunContext` in `src/post-run-reporter.ts`.
2. Include `mainBranch` in the `prContext` spread so `generatePRSummary` sees the real branch.
3. Add a test in `test/post-run-reporter.test.ts` that locks this (autoPR path, mainBranch on input, verify the generated PR summary has the right `baseBranch`).
4. Commit those changes separately: `fix: port mainBranch into runPostExecution autoPR path`.
5. Then perform the swap at the swarm-orchestrator.ts call site.
