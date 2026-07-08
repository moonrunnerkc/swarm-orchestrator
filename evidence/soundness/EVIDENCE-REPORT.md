# Soundness run: evidence report

The capstone for the run whose one goal was a product whose every claim is sound
before any of it is written about. It closed the one unsound gate path the Hunt 4
near-miss exposed (the `claim-falsified-synthesized` false positive), swept the
documentation for the two stale-claim classes the last two runs invalidated,
corrected the judge framing to match its data, closed the viability census as an
open item, and committed a definition of done. No new capability shipped except the
discrimination control; scope was held.

Branch point `cc1d1c42589cfbea85bfe6adbb8f67c02f68406e`; all work is on `main`.
Every number below carries the script that regenerates it.

## Per-phase commit map

| phase | commit | what |
| --- | --- | --- |
| 0 baseline | `b080a89b` | branch point, suite state, credit/token probes |
| 1 discrimination control (core) | `4c47744f` | the four-clause conjunction + wiring + 19 unit + 5 e2e |
| 1 twin measurement | `a13f51dd` | executable twin corpus + measurement + report |
| 1 disclosed verification + docs | `9d30a4e0` | outline replay test, dataset diagnosed annotation, proof-protocols section |
| 2 documentation truth sweep | `c4ecbf69` | synthesized verdict corrected to advisory; pin test; dated appends |
| 3 judge framing correction | `5b010b2b` | clean rate over n=52; wild miss leads; joint conclusion |
| 4 viability census close-out | `4a8ad497` | executable surface 7/27; no bounded provisioner remains |
| 5 definition of done | `d2207d63` | `docs/READINESS.md` |
| deliverable (this file) | committed last | |

## Phase 0: baseline

`evidence/soundness/BASELINE.md`. At branch point: suite **2152 passing, 39
pending, 0 failing**; Anthropic probe **HTTP 200** (credits live); `GITHUB_TOKEN`
**HTTP 401** (Phase 4 stays blocked). The whole run turned out to need almost no
model spend (see Spend), so the 200 mattered only for the option to run funded, and
the 401 blocked exactly one item (corpus mining).

## Phase 1: the discrimination control

The defect, precisely: `claim-falsified-synthesized` ("base fails AND head fails")
could not distinguish "the PR did not deliver its claim" from "the witness cannot
pass anywhere." Outline's witness read a cached counter through the wrong path,
asserted `expect(count).toEqual(1)` against `undefined`, failed identically on base
and head, and errored on 1 of 3 re-runs.

### The control: a four-clause conjunction, each clause its own cut

`src/audit/execution-grounded/discrimination-control.ts`. It is pure logic over
already-run witness outcomes and can only hold a verdict back, never let a new one
through.

1. **Failure classification.** Every run is classified as an assertion failure (the
   test ran and its assertion did not hold) or a setup error (exception, missing
   dependency, timeout, non-assertion crash). Only assertion failures count; a setup
   error on any run abstains. Fail-closed: a non-zero exit with no assertion banner
   is a setup error.
2. **Determinism quorum, K=3.** K runs on base and K on head. K=3 is the minimum
   that catches a one-in-three nondeterministic run (the outline instance); each run
   is a model-free sandbox execution, so the cost is wall-clock only. Every counted
   run on a side must produce the same classification and the same failure identity;
   any divergence abstains.
3. **Failure-identity discrimination.** The base and head failures must be the same
   assertion failing the same way; a divergence abstains. The matched identity is
   recorded.
4. **Pass-capability evidence.** Affirmative evidence the witness can pass on some
   correct implementation of the claim. Only then does the finding fire.

### Production semantics: the finding abstains in production

Clause 4 is the heart. On twins it is direct: the honest twin is the correct
implementation and must pass the witness. In production there is no reference
implementation, and the honest design work found no bounded runtime proxy sound
enough to certify pass-capability:

- A **sensitivity probe** (perturb the asserted expectation and require the outcome
  to change) shows only that the assertion is live, not that a correct
  implementation would satisfy it. The outline witness's assertion was live and
  still could never pass, so a live-assertion probe would certify it falsely.
- A **self-check scaffold** that reconstructs a known-correct scenario needs the
  domain knowledge the witness compiler lacked in the first place.

Certifying "can pass on a correct implementation" without a reference implementation
reduces to synthesizing a correct implementation, which carries the same blind
spot. So the sound conclusion, taken deliberately, is that **no production proxy is
trustworthy, and `claim-falsified-synthesized` abstains in production**. It is the
explicitly-valid Phase 1 outcome: an honest abstaining trigger beats an unsound
firing one. Full write-up in `benchmarks/oracle-corpus/proof-protocols.md`.

### Twin-measured numbers (the validation gate)

`benchmarks/twins/DISCRIMINATION-CONTROL-REPORT.md`, regenerated by `npm run
discrimination-control:measure` over 16 executable semantic twins (8 goal-not-fixed,
8 cheat-mock-mutation), four modes each, live node:test, no model call:

| measurement | value (Wilson-95) |
| --- | --- |
| honest-twin false positives | 0/16 (0%) [0.00, 0.19] |
| cheat recall, twin mode | 16/16 (100%) [0.81, 1.00] |
| production reach cost (cheats that abstain with no twin) | 16/16 |
| broken-witness (outline pattern) refusal | 16/16 |
| twin-mode separation | 1.00 |

The validation gate is met: **zero findings on honest twins**, measured separation
with the control active, and the reach cost stated plainly (in production the
finding cannot fire; the pass-capability clause turns 16/16 detections into
abstains). 19 unit tests (each clause its own cut) and 5 live e2e cases back it.

### The disclosed outline verification

The control was developed on synthetic and executable semi-synthetic twins only.
The committed Hunt 4 outline record (the raw `claim-falsified-synthesized` fire) was
read exactly once, at the end of Phase 1, as a disclosed verification
(`test/audit/execution-grounded/outline-discrimination-replay.test.ts`). Replayed
through the finished control in production mode it **abstains, refused at clause 4
(pass-capability)**; the 1-of-3 re-run error independently trips clause 1. The
outline corpus entry is downgraded from a fresh held-out entry to `diagnosed`
(spent by Hunt 3, Hunt 4, and this run) in
`benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json`; future pre-registrations
report it separately.

## Phase 2: documentation truth sweep

Full inventory in `evidence/soundness/SWEEP-INVENTORY.md`.

- **Class A (witness compile pinned/deterministic): swept clean.** No current-state
  overstatement exists in `src` (the prior lift run fixed it). `proof-protocols.md`
  now states recorded-not-pinned explicitly, with the model-rejection reason.
- **Class B (`claim-falsified-synthesized` as self-certifying/proven).** The live
  gate, promotions, and self-certifying machinery were already correct (the verdict
  is not a block-trigger kind, and promotions keeps it advisory-only until Wilson-95
  lower >= 0.9 with >= 5 true positives; `npm run promotions:check` passes with
  gate-eligible=0). The one live overstatement was the Hunt harness `deriveStatus`,
  which labeled a controlled synthesized verdict `proven-block`; corrected to
  `claim-differential-advisory` (advisory-pending-measurement, never proven), with
  its test updated. A new pin,
  `test/audit/gate/claim-falsified-synthesized-not-gating.test.ts`, guards that the
  verdict is neither a block-trigger kind nor self-certifying.
- Dated appends (not rewrites) were added to `HUNT-4-REPORT.md` and
  `CLAIM-DIFFERENTIAL-HARDENING-REPORT.md` noting the disclosed control is now
  landed. Committed hunt run artifacts are left as dated history.

## Phase 3: judge framing correction

`benchmarks/twins/JUDGE-GATE-COST-REPORT.md` and the leaderboard fold, regenerated
re-run-free (`node dist/scripts/experiments/judge-gate-cost.js --report-only`, no
model calls, from the committed JSON):

- The clean-side false-block rate is stated over **n=52** (1/52, Wilson-95
  [0.00, 0.10]), the combined denominator (semantic clean 1/8 + broad clean 0/44).
- The retired **12.5%** figure is explained as the semantic-only slice (1/8), a
  small-n interim, not the clean-side rate.
- The **wild recall miss (1/7)** leads the findings.
- The joint conclusion is stated plainly, numbers only: neither the judge nor the
  proof tier catches wild cheats reliably (judge 1/7; proof tier 0/7 by
  abstention), and only the proof tier abstains rather than guesses (0% false
  positive by construction). Both ship advisory.

## Phase 4: viability census close-out

`benchmarks/real-prs/hunt3/VIABILITY-LIFT.md` close-out. No remaining category has a
bounded, honest provisioner path covering two or more entries under this run's
rules (no paid registries, no recipe that changes what runs, no new proof tier), so
no provisioner was implemented and the conclusion is written instead. Executable
surface **7 of 27**. The 20 outside it: 7 pytest/Go (need a polyglot proof tier, a
new capability, not a provisioner), 4 monorepo-no-lockfile (frozen-lockfile
discipline forbids it; complaint often on the non-Node part), 5 unsupported
languages, 2 no-runner Node, 1 python-no-pytest, 1 gone (404). The census is closed
as an open item; the single highest-value future lift is a polyglot proof tier (7
entries), recorded.

## Phase 5: definition of done

`docs/READINESS.md`, the checklist that gates content work. Items 1 (gate-trigger
soundness), 2 (advisory-tier value with real numbers), 3 (executable surface), and
5 (documentation consistency) are checked. Item 4 (corpus freshness) is blocked
(owner: maintainer, token): 0 fresh proof-executable entries, mining is 401-blocked.
Item 6 lists the external blockers (token, credits). No aspirational entries; every
line carries a measured value and a regenerating script.

## Spend

Recorded per phase. The run was designed to be deterministic and model-free, and it
was: the only Anthropic call was the Phase 0 probe.

| phase | model calls | spend |
| --- | --- | --- |
| 0 probes | 1 haiku (1-token) + 1 GitHub (401) | ~$0.00 |
| 1 discrimination control + twin measurement | none (stub completer, live node:test) | $0.00 |
| 2 documentation sweep | none | $0.00 |
| 3 judge reframe | none (`--report-only` from committed JSON) | $0.00 |
| 4 viability close-out | none | $0.00 |
| 5 READINESS | none | $0.00 |
| **total** | | **~$0.00** |

The whole soundness argument rests on deterministic, replayable evidence, so it cost
essentially nothing to produce and can be regenerated for free.

## Deviations (numbered)

1. **The twin instrument was built.** The existing `twins.json` is diff-only over
   external, largely Python PRs and cannot run through the claim-differential
   base/head execution path, which the prior run recorded as a missing instrument.
   This run built the executable semantic-twin corpus
   (`scripts/gate/discrimination-twins.ts`) and measured the control on it. The
   Phase 1 validation gate was therefore run on this executable corpus, not on the
   diff-based `twins.json`.
2. **Phase 1 clause 4 landed on abstain-in-production.** After the honest design
   work, no bounded runtime proxy was sound enough to certify pass-capability, so
   `claim-falsified-synthesized` abstains in production. This is the explicitly-valid
   Phase 1 outcome the run contract names, not a shortfall.
3. **Phase 2 corrected the generator, not the committed artifacts.** The Hunt
   harness `deriveStatus` was corrected to state present truth; the committed hunt
   run artifacts (with the old `proven-block` label) are dated history and were not
   rewritten, per the append-not-rewrite rule.
4. **Phase 4 implemented no provisioner.** No in-scope bounded, honest path with two
   or more entries remained, so the close-out conclusion was written, which the run
   contract names as the valid "either way" outcome.
5. **Commit-message em dashes were fixed mid-run.** Four phase-subject lines
   initially carried an em-dash connector; they were rewritten to a colon-space
   with `git filter-branch` before this report recorded the hashes, so the
   per-phase hashes above are the corrected ones.

## What this run established

- The one known unsound gate path is closed: `claim-falsified-synthesized` cannot
  fire on an identical everywhere-failure without pass-capability evidence, and it
  abstains in production. Measured on twins (0/16 honest false positives, 16/16
  outline-pattern refusal) and verified against the committed outline record.
- Every documentation claim about witness determinism and the synthesized verdict
  now states present truth; the sweep is clean and pinned.
- The judge and proof-tier numbers are stated over honest denominators, with the
  plain joint conclusion that neither catches wild cheats reliably today and only
  the proof tier abstains rather than guesses.
- The executable surface (7/27) and its census are closed; the corpus-freshness
  blocker is named and owned.
- READINESS.md is the standing gate for content work, with measured values, not
  aspirations.
