# Counterfactual proof protocols: confirm / refute / unprovable

Two counterfactual proof protocols were added on top of the existing
restoration proofs (`test-tamper-proven`, `mock-mutation-proven`). A proof does
not score like a detector: it is not a recall number against injected ground
truth, it is an executed verdict on one PR. So the table below records, per
protocol, what the proof returns on a confirm fixture (a real concealed/no-op
case), a refute fixture (a legitimate change), and which verdicts the
fail-closed controls produce when the proof cannot run.

## Why this is measured on fixtures, not the oracle corpus

The proof engine reverts hunks and reruns tests in a provisioned sandbox. The
oracle corpus is presumed-clean real PRs, only **12 of 197** of which provision
in a generic sandbox at all (`benchmarks/real-corpus/eg-viability.json`); the
bounded execution-grounded run on that 12-PR slice is still the next pending
step (see `docs/limitations.md`). Running every proof across the corpus is
gated on that same provisioning work.

Rather than block this report on it, each protocol's branches are exercised
against deterministic, self-contained fixtures on a live runner (vitest). This
is sound because a proof's truth is sandbox execution, not corpus statistics: a
synthetic no-op exercises exactly the `proven` branch and a synthetic real fix
exercises exactly the `refuted` branch. The fixtures and verdicts are committed
and reproducible; the numbers are small-n (n = 1 per branch) and labeled as
such, never padded.

## Results

| Protocol | confirm fixture → | refute fixture → | unprovable verdicts (fail-closed, never block) | evidence |
| --- | --- | --- | --- | --- |
| `no-op-fix-proven` | `proven` (1/1) | `refuted` (1/1) | `no-fix-claim`, `no-source-hunks`, `no-affected-tests`, `closure-capped`, `suite-already-failing`, `flaky`, `patch-apply-failed`, `runner-unsupported`, `no-workspace`, `execution-error` | `test/audit/execution-grounded/no-op-fix-restoration-e2e.test.ts` (live vitest), `test/audit/execution-grounded/no-op-fix-restoration.test.ts` (pure core) |
| restoration closure refuter | n/a (refuter only: it never confirms, only downgrades a behaviorally-proven restoration) | refutes on a confident no-link; abstains (keeps the proof) on a capped BFS, no source change, or a closure error | `test-not-closure-linked` | `test/audit/execution-grounded/restoration-closure-link.test.ts`, `test/audit/execution-grounded/test-restoration.live.test.ts` |

Live e2e run (`SWARM_EG_INTEGRATION=1`): `no-op-fix-proven` confirmed in 2.3s,
refuted in 1.8s, and the proven case's published reproduce path was replayed in
a fresh checkout to confirm the affected test still passes with the fix
reverted.

## Reproduce

```sh
npm run build
# pure core (offline, in the default suite)
npx mocha 'dist/test/audit/execution-grounded/no-op-fix-restoration.test.js'
npx mocha 'dist/test/audit/execution-grounded/restoration-closure-link.test.js'
# live sandbox (vitest), opt-in
SWARM_EG_INTEGRATION=1 npx mocha 'dist/test/audit/execution-grounded/no-op-fix-restoration-e2e.test.js'
```

## What a no-op-fix proof gates on

A `no-op-fix-proven` candidate becomes a block only when all three per-instance
controls are green (`src/audit/gate/self-certifying.ts`):

1. `prClaimsFix`: the PR claims a fix (pr-intent or a linked-issue close keyword).
2. `suitePassesAsSubmitted`: the affected tests pass with the full PR applied.
3. `revertedSuiteStillPassesTwice`: with the source fix reverted, the affected
   tests (those whose import closure reaches the reverted source) still pass,
   twice.

Any null or false control leaves the finding advisory. The affected-test set is
empty or capped → no proof, not a block.
