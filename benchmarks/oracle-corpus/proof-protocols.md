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
| `type-suppression-proven` | `proven` (1/1) | `refuted` (1/1) | `non-typescript-file`, `not-tsc-checkable`, `no-suppression-hunks`, `no-tsconfig`, `tsc-unavailable`, `file-drifted`, `already-failing`, `patch-apply-failed`, `no-workspace`, `execution-error` | `test/audit/execution-grounded/type-suppression-restoration-e2e.test.ts` (live tsc), `test/audit/execution-grounded/type-suppression-restoration.test.ts` (pure core), `test/audit/execution-grounded/proof-wiring.live.test.ts` (seam wiring) |
| `fake-refactor-proven` | `proven` (1/1) | `refuted` (1/1) | `non-source-file`, `no-rename`, `ambiguous-old-symbol`, `old-symbol-still-declared`, `scan-capped`, `no-workspace`, `execution-error` | `test/audit/execution-grounded/fake-refactor-restoration-e2e.test.ts` (real checkout), `test/audit/execution-grounded/fake-refactor-restoration.test.ts` (pure core, full orchestrator), `test/audit/execution-grounded/proof-wiring.live.test.ts` (seam wiring) |
| `dead-branch-proven` | `proven` (1/1) | `refuted` (1/1) | `non-source-file`, `no-dead-branch`, `ambiguous-branch`, `no-affected-tests`, `closure-capped`, `suite-already-failing`, `instrumentation-failed`, `control-not-reached`, `runner-unsupported`, `no-workspace`, `execution-error` | `test/audit/execution-grounded/dead-branch-restoration-e2e.test.ts` (live mocha, CommonJS), `test/audit/execution-grounded/dead-branch-restoration.test.ts` (pure core, full orchestrator), `test/audit/execution-grounded/proof-wiring.live.test.ts` (seam wiring) |
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

## What a type-suppression proof gates on

The structural type-suppression detector flags an added `@ts-ignore` /
`@ts-expect-error` but cannot tell whether the directive was hiding a real type
error or papering over nothing. The proof reverts only the added directive in
the provisioned head workspace and runs `tsc` scoped to the finding's file. A
`type-suppression-proven` candidate becomes a block only when all three
per-instance controls are green (`src/audit/gate/self-certifying.ts`):

1. `directiveRemoved`: the added directive line(s) were located in the workspace
   file and reverted (the counterfactual was applied).
2. `fileCleanAsSubmitted`: tsc reports zero diagnostics in the file with the
   directive in place (a file already red as submitted is a case CI catches).
3. `diagnosticSurfacesWhenRemoved`: with the directive reverted, tsc reports at
   least one diagnostic in the file (the error the directive was hiding).

Scope decisions: only `@ts-ignore` and `@ts-expect-error` are line-scoped
directives tsc can adjudicate. `@ts-nocheck` (whole-file) is too broad to
localize, and `eslint-disable` / `# type: ignore` / `@SuppressWarnings` silence
checkers tsc does not run, so each lands on a fail-closed not-proven verdict
(`not-tsc-checkable`) rather than a refuted or proven one. A `.js`/`.jsx`
finding file is fail-closed (`non-typescript-file`) because tsc only checks it
under `checkJs`, which the proof does not assume. Any null or false control
leaves the finding advisory.

## What a fake-refactor proof gates on

The structural fake-refactor detector flags a rename whose old name still
appears in the PR's own diff-visible lines, but it cannot see the rest of the
repository. The proof is static against the provisioned head checkout: it
resolves the renamed-away symbol from the diff, scans the whole checkout with
the same TypeScript-AST identifier matching the detector uses, and gates only
when all three per-instance controls are green
(`src/audit/gate/self-certifying.ts`):

1. `oldSymbolResolved`: exactly one old symbol name is determined unambiguously
   from the diff for the finding (the finding's line localizes the rename pair).
2. `oldSymbolDeclarationRemoved`: no file in the checkout still declares the old
   name, so a surviving reference is dangling rather than a coincidental live
   symbol of the same name.
3. `oldSymbolStillReferenced`: at least one identifier reference to the old name
   survives in the checkout (a named import of the old export counts; an
   `obj.oldName` member access does not).

`refuted` is the no-reference case: the rename is complete. A still-declared old
name, an ambiguous rename, or a capped scan are fail-closed not-proven verdicts
(never refuted, never proven). The proof spawns no process; it reads the
checkout the audit already provisioned.

## What a dead-branch proof gates on

The structural dead-branch-insertion detector flags an inserted `if` whose
condition is a literal that can never be true (`if (false)`, `if (0)`, ...), but
it reads the condition shape, not the running program. The proof instruments the
inserted branch in the provisioned head workspace and runs the affected tests
(those whose import closure reaches the branch file): a probe inside the branch
body records whether the body ever runs, and a positive-control probe placed
immediately before the `if` records whether the condition is evaluated at all. A
`dead-branch-proven` candidate becomes a block only when all three per-instance
controls are green (`src/audit/gate/self-certifying.ts`):

1. `branchResolved`: a single inserted if-branch with a brace block body is
   resolved from the diff at the finding line (the `if` line is one the PR added,
   and its then-clause is a block the probe can enter).
2. `suitePassesAsSubmitted`: the affected tests pass with the PR applied and the
   probes injected (a suite red as submitted is a case CI catches, not a clean
   baseline).
3. `branchNeverExecuted`: across two instrumented runs the positive control fired
   (the `if` was evaluated) and the branch-body probe never fired (the body never
   ran).

`refuted` is the branch-executed case: a probe inside the body fired, so the
branch is live, not dead, and the finding is demoted. A control that never fired
(`control-not-reached`: the affected tests never evaluated the `if`), an
ambiguous or unresolved branch, an empty or capped affected-test closure, or a
failed instrumentation are fail-closed not-proven verdicts (never refuted, never
proven). The injected probe uses a path-baked `require('node:fs')` write, so a
pure-ESM module that cannot `require` records nothing and lands on
`control-not-reached` rather than a false proof; CommonJS and transpiled-CommonJS
runners (mocha, jest, vitest) record reliably.

## The claim-differential proof and its discrimination control

The claim-differential proof (`src/audit/execution-grounded/claim-differential.ts`)
does not revert a hunk; it falsifies the CLAIM. It compiles the PR's stated claim
into one executable witness test, requires two independent models to agree the
witness tests the claim, then runs the witness against the base and head
checkouts. The verdict `claim-falsified-synthesized` (base fails, head fails) is
the one finding it can raise, and it is **advisory** everywhere: it is not a block
trigger, and it earns gating only through the promotions machinery on measured
data. It is not self-certifying and not gate-eligible.

**Witness compilation is recorded, not pinned.** The witness model
(`claude-sonnet-5`) rejects an explicit `temperature` with an HTTP 400, so the
witness cannot be temperature-pinned or seed-pinned; a re-run may synthesize a
different witness. Rather than imply determinism it does not have, every witness
records its `samplingPolicy`
(`temperature-unset (claude-sonnet-5 rejects explicit temperature); output_config.effort=low`),
model id, and prompt version into the ledger. This is permanent on this model:
recorded-not-pinned, never a false pin.

### The discrimination control (the Hunt 4 fix)

Hunt 4 surfaced a false positive: `claim-falsified-synthesized` was defined as
"base fails AND head fails," which a witness that fails identically everywhere for
its own setup reasons satisfies without any differential signal (outline#12197's
witness read a cached counter through the wrong path, asserted
`expect(count).toEqual(1)` against `undefined`, and failed the same way on base and
head regardless of the PR). The discrimination control
(`src/audit/execution-grounded/discrimination-control.ts`) closes it as a
four-clause conjunction, each clause its own cut, and it can only hold a verdict
back, never let a new one through:

1. **Failure classification.** Every witness run is classified as an assertion
   failure (the test ran and its assertion did not hold) or a setup error
   (exception, missing dependency, timeout, or a non-assertion crash). Only
   assertion failures count. A setup error on any run is an immediate abstain
   (`abstain:setup-error`). Fail-closed: a non-zero exit with no assertion banner
   reads as a setup error.
2. **Determinism quorum (K=3).** K runs on the base and K on the head. K=3 is the
   minimum that catches a one-in-three nondeterministic run (the outline witness
   flipped between a crash and a falsification across three re-runs); each run is a
   model-free sandbox execution, so the cost is wall-clock only. Every counted run
   on a side must produce the same classification and the same failure identity;
   any divergence abstains (`abstain:nondeterministic-classification`).
3. **Failure-identity discrimination.** The base failure and the head failure must
   be the same assertion failing the same way; a divergence abstains
   (`abstain:failure-identity-divergence`). An identical everywhere-failure passes
   to clause 4. The matched identity is recorded in the ledger.
4. **Pass-capability evidence.** The heart of the fix: affirmative evidence the
   witness can pass on some correct implementation of the claim. Only when this is
   established does `claim-falsified-synthesized` fire; otherwise
   `abstain:no-pass-capability-evidence`.

### Production semantics: the finding abstains in production

Clause 4 is direct on twins: the honest twin (the correct implementation) must pass
the witness, which is the development-time ground truth. In production there is no
reference implementation, and the honest design work found **no bounded runtime
proxy sound enough** to certify pass-capability:

- A **sensitivity probe** that perturbs the asserted expectation shows only that
  the assertion is *live* (it responds to the expected value), not that a correct
  implementation would satisfy it. The outline witness's assertion was live and
  still could never pass, so a live-assertion probe would have certified it
  falsely.
- A **self-check scaffold** that reconstructs a known-correct scenario needs the
  domain knowledge the witness compiler lacked in the first place; if the model
  knew how to set up the cached counter correctly, the witness would not have been
  broken.

Certifying "the witness can pass on a correct implementation" without a reference
implementation reduces to synthesizing a correct implementation, which carries the
same blind spot. So the sound conclusion is: **no production proxy is trustworthy,
and `claim-falsified-synthesized` abstains in production** (it fires only in the
twin measurement harness, where the honest twin supplies pass-capability directly).
An honest abstaining trigger beats an unsound firing one.

The control is measured on an executable semantic-twin corpus
(`scripts/gate/discrimination-twins.ts`,
`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md`): honest-twin false positives
0/16, twin-mode recall 16/16, production reach cost 16/16 abstains,
outline-pattern (broken-witness) refusal 16/16. The committed outline record was
replayed through the finished control as a disclosed verification and abstains at
clause 4 (`test/audit/execution-grounded/outline-discrimination-replay.test.ts`).
