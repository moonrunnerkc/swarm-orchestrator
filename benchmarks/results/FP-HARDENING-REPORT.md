# False-positive hardening (Stage 0)

Nothing wild-facing runs until the test-tamper gate's one known false-positive
class is neutralized in-proof, pinned so it cannot regress, honestly surfaced in
the attestation, and wired into the demotion machinery. This is that work. The
class is jeduden/mdsmith#232: a `test-tamper` proven end-to-end on wild Go that
human review found to be a legitimate coverage-moving refactor, not a cheat
(`benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`).

## The four hardening items

### 1. FP regression registry (the CI ratchet)

`benchmarks/real-corpus/fp-registry/` holds one entry per diagnosed gate false
positive, beside its committed PR diff. `npm run fp-registry:check` (wired into
`.github/workflows/ci.yml`) replays each `neutralized-by-refuter` entry's refuter
over the committed diff and every finding file; if the refuter no longer fires,
the gate would block that PR again, so the check exits non-zero and CI goes red.

- Entry one: `jeduden-mdsmith-232` (`test-tamper-proven`, `coverage-relocated`),
  built from the committed Hunt 7 record and the live PR diff.
- Teeth verified: a deliberate-firing entry (a pure tamper the refuter cannot
  catch) makes the checker exit 1; the committed registry exits 0. The mocha
  regression test `test/audit/gate/fp-registry.test.ts` pins both directions.

### 2. Coverage-relocation refuter (in test-tamper)

`coverageRelocated` (`src/audit/execution-grounded/test-restoration.ts`, Step 6d)
runs on an otherwise-proven restoration. When the PR, in the same diff, adds
replacement coverage (a net-new test file, or a golden/snapshot/testdata fixture)
inside a production directory it also changed, the proof downgrades to
`not-proven:coverage-relocated`. Pure diff signal, near-zero per-audit cost, tied
to "the same code" via directory proximity so:

- a pure assertion-deletion tamper (no replacement coverage) still proves, and
- an unrelated added test elsewhere does not fire it.

Conservative: it only turns proven into not-proven, never the reverse.

### 3. FP into the promotions denominators (auto-demotion)

`computeBlockEligibility` (`src/audit/gate/block-eligibility.ts`) now folds
still-live FP-registry firings into each trigger's denominator and auto-demotes a
self-certifying trigger to advisory when its Wilson-95 lower bound drops below the
0.90 bar. A trigger with zero false positives is never demoted, whatever its
true-positive count; a trigger that demonstrably fired on clean PRs demotes until
the FP class is neutralized and precision recovers. Because the jeduden entry is
`neutralized-by-refuter`, it contributes no live firing, so `block-eligibility.json`
regenerates byte-identical (`test-tamper-proven` stays eligible). The mechanism is
demonstrated on a synthetic live FP in `test/audit/gate/block-eligibility.test.ts`.

### 4. Attestation fired-then-disputed state

The proof-coverage attestation gains a `disputed` outcome
(`src/audit/attestation/`). A `not-proven:coverage-relocated` record maps to
`disputed` (all controls green, then a static refuter contested it), never to a
clean pass and distinct from an abstain. `summary.disputed` counts them, the
render names them `human-review-required`, and `docs/attestation.md`'s consumption
contract states a cautious policy must never read a disputed record as clean.

## Twin validation (the gate)

`npm run coverage-relocation:measure` materializes real git fixtures and runs the
REAL test-restoration engine (go-test and pytest), the same code `swarm audit --pr`
invokes post-fetch. Result **6/6**
(`benchmarks/twins/COVERAGE-RELOCATION-REPORT.md`):

| twin class | expectation | result |
|---|---|---|
| planted-tamper (go, pytest) | still prove | 2/2 proven |
| relocation, mdsmith-shaped (go, pytest) | abstain | 2/2 `not-proven:coverage-relocated` |
| honest-clean (go, pytest) | refute | 2/2 refuted |

Every relocation twin reaches `proven` on all three behavioural controls
(base=true, tampered=true, twice=true) and is separated from a real tamper by the
refuter alone. The shipped polyglot-restoration regression stays **4/4** (planted
tampers prove, clean controls refute), so the refuter does not touch a real
tamper. The refuter also verified firing on the real jeduden diff for both
tampered finding files.

## What did not change

- No control, threshold, or bar was changed. The Wilson 0.90 / 5-TP bar is
  untouched; the self-certifying tier became demotable at that same bar, which is
  a stronger safety property, not a weaker one.
- `promotions.json`, `corroborated-gate-precision.json`, and
  `block-eligibility.json` all regenerate byte-identical (gate-eligible=0 /
  undefined-n / block-eligible=8).
- The frozen corpus versions are untouched.

## Reproduce

```sh
npm run build
npm run fp-registry:check
npm run block-policy:check
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/gate/measure-coverage-relocation.js
PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js
```

## Spend

USD 0.00. Every step is deterministic and model-free (GitHub API for the one PR
diff, local git fixtures, real go/pytest execution). No judge, no arbiter.
