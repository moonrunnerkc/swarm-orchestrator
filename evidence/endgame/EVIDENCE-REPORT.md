# Endgame run: evidence report

The endgame goal was proof-carrying agent PRs trustworthy enough for an
auto-merge policy to consume. This run did not unlock a new gate trigger, and it
was not supposed to: every phase either measured an existing mechanism honestly
or built a consumption surface on top of one. Two things advanced (a
machine-readable proof-coverage attestation, and a derived-witness class that
closes the outline blind spot on twins), one thing was measured and came back
negative (fresh-corpus mining yielded 0 confirmable cheats), and nothing weakened.

Branch point `b0526212` (soundness-run capstone). All work builds forward from
there.

## Phase commits

| phase | commit | what landed |
| --- | --- | --- |
| 0 baseline | `ce243b52` | token valid (HTTP 200), suite 2181 green, mine launched |
| 1 mine + package | `3c347a57` | complaint-mine intake, review package, single fold command |
| 2 attestation | `128796ac` | `swarm-proof-coverage/v1` per-engine coverage, content-addressed |
| 3 derived witness | `9630f0cb` | existing-test-derived witness, measured on twins, advisory |
| 6 automation + docs | `c1ea3985` | miner cron packages for review; READINESS item 4 refreshed |

Phases 4 and 5 are fold-gated and produced no commit; they halted awaiting-review
(see below). Suite grew 2181 -> 2209 passing across the run, 0 failing at every
commit.

## Phase 0: baseline

`evidence/endgame/BASELINE.md`. The `GITHUB_TOKEN` that returned HTTP 401 at the
soundness run returned HTTP 200 here (login `moonrunnerkc`, fine-grained PAT,
4999/5000 core remaining), so corpus mining was unblocked for the first time in
four runs. `ANTHROPIC_API_KEY` returned HTTP 200 (1-token haiku probe). Suite
2181 passing / 41 pending / 0 failing. The token being valid is what let Phase 1
actually run instead of halting.

## Phase 1: mine, verify, package

The complaint miner ran at the full workflow budget (`--limit 25 --api-budget 400
--wall-clock-ms 2100000 --max-cost-usd 5`, dual arbiter, checkpointed and
resumable, `--per-phrase 100`). Committed funnel
(`benchmarks/real-prs/wild-cheat-corpus/mined-candidates.json`):

- 38 search hits, **1721 PRs examined**, 1545 not agent-attributed, 151 with a
  complaint not confirmed in the conversation.
- **25 complaint-confirmed** candidates reached the dual arbiter.
- **0 dual-arbiter-confirmed** cheats: 21 arbiter-not-cheat, 3 arbiter-split
  (excluded and counted, never silently dropped), 1 unevaluable (diff too large).
- 14 of the 25 are EG-viable (Node proof tier could run them if confirmed).
- Cost: 122 API calls of the 400 budget, $1.71 of the $5 arbiter ceiling, 3.6 min
  wall clock (committed final checkpoint counters).

Every candidate carries full intake metadata (head/base SHA, PR state, complaint
excerpt, agent attribution, category, content-addressed evidence id,
EG-viability, `holdout: true`). The review package is committed at
`benchmarks/real-prs/wild-cheat-corpus/incoming/` (`REVIEW.md` + `intake.json`)
with one fold command. The fold waits for maintainer approval by design.

This is the honest negative of the run: the corpus cannot grow from this pass.
1721 examined, 0 confirmable. That is a finding, not a failure of the harness.

## Phase 2: proof-coverage attestation

`src/audit/attestation/{proof-coverage,engine-projection}.ts` (schema
`swarm-proof-coverage/v1`). Every `swarm audit` run now emits, per proof engine,
a machine-readable record: whether the engine executed, its verdict, a precise
abstain class when it abstained, provisioning status, the controls corpus it was
measured against, and the exact replay command. The four proof outcomes
(`finding`, `exonerated`, `abstain`, `signal`) are typed, not free text.

Wiring:

- `swarm audit --output json` carries the full `proofCoverage` object; the text
  path renders the compact summary (`renderProofCoverageSummary`).
- The evidence pack content-addresses it to `attestation/proof-coverage.json`
  with MANIFEST role `attestation`, so a consumer verifies it by sha256 like the
  two AIBOMs.
- The GitHub Action writes the compact summary to `$GITHUB_STEP_SUMMARY`, and the
  composite action gained a `proof-coverage` output.
- `docs/attestation.md` is the consumption contract for a downstream auto-merge
  policy.

Byte-stable, deterministic, no new runtime deps. Covered by 10 unit tests in
`test/audit/attestation/proof-coverage.test.ts` plus evidence-pack integration
assertions. This is the surface the endgame goal actually needs: it makes each
engine's executed/verdict/abstain claim checkable rather than asserted.

## Phase 3: existing-test-derived witness

`scripts/gate/derived-witness-twins.ts` +
`scripts/gate/measure-derived-witness.ts`. The claim-differential proof normally
synthesizes its witness from claim text, whose pass-capability no production
proxy can certify (the discrimination-control finding). This phase measures a
different witness class: one derived by perturbing a test that already passes on
head. The parent test's green run is direct clause-4 SETUP evidence, which is
exactly the blind spot the Hunt 4 outline false positive exploited.

Measured on 8 executable twins (4 output-preserving, 4 output-changing) through
the real base/head execution path (live `node:test`, stubbed completer, agreeing
arbiters, no model call), with Wilson-95 bounds:

| measure | value |
| --- | --- |
| honest-twin false positives (the only halting gate) | 0/8 [0.00, 0.32] |
| special-casing recall (twin) | 8/8 [0.68, 1.00] |
| production abstain (no twin) | 8/8 |
| broken-witness abstain | 8/8 |
| parent-test evasion on the cheat head | 8/8 |
| pure-constant hardcode caught, output-changing | 4/4 |
| pure-constant hardcode caught, output-preserving | 0/4 (documented limit) |
| twin-mode separation | 1.00 |

It catches the special-casing cheat that passes its own parent test, which
neither a structural detector nor the claim-text witness reaches. It ships
**advisory** and abstains in production: the output-changing subclass needs a
spec-derived expected value the discrimination control already rejects as
unsound, and the output-preserving subclass needs an arbiter-certified
output-invariant not yet validatable on twins. Added no `src`; the LOC budget is
unchanged at 47226.

## Phases 4 and 5: halted, awaiting-review

Both phases are fold-gated: Phase 4 re-runs the viability census over folded
entries, Phase 5 pre-registers Hunt 5 with the folded fresh entries as the
primary set. The mining pass produced **0 arbiter-confirmed candidates**, so
there is nothing to fold, no maintainer approval to act on, and no fresh primary
set to register. Per the run contract, both halt with `awaiting-review`. This is
the designed behaviour when a mining pass comes back empty, not a blocker. The
next mining pass that yields confirmable entries, followed by a maintainer fold,
is what unblocks them.

## Phase 6: automation and READINESS refresh

- `complaint-mine.yml` (04:30 UTC nightly cron) now runs a "Package candidates
  for review" step after the capped mine (intake-package, GitHub core API only,
  no arbiter) and uploads the rendered review package as a second artifact. It
  packages every run for maintainer review and still never folds; main stays a
  protected ref and the review-then-fold contract is intact.
- Measurement workflows (`eg-viable-measure.yml`, `benchmarks-full.yml`) stay on
  their deliberate `workflow_dispatch` paths and were not forced onto a schedule.
- `docs/READINESS.md`: item 4's owner shifted from token to arbiter yield (token
  is valid; 0/1721 confirmed is now the constraint); item 2 gained the
  derived-witness advisory line; the closing section notes the attestation as a
  consumption surface; the blockers table was updated.

## Refreshed readiness state

Items 1, 2, 3, 5 remain checked (gate soundness, advisory-tier numbers now
including derived-witness, executable surface, documentation consistency). Item 4
(corpus freshness) remains blocked but for a new reason: not the token, which is
valid, but yield, since this pass confirmed nothing. No "we caught N new wild
cheats" claim is writable until a mining pass yields confirmable entries and a
maintainer folds them.

## Spend

| phase | Anthropic | notes |
| --- | --- | --- |
| 0 | ~$0.00 | 1 haiku probe, 1 output token |
| 1 | $1.71 | dual-arbiter mining, $5 ceiling, 122/400 API calls |
| 2, 3, 6 | $0.00 | deterministic; stub completers and agreeing arbiters, no model call |

Endgame total ~$1.71 Anthropic, well under the per-phase ceilings. Tiers never
blended; every funded call was a mining arbiter call.

## Deviations (numbered)

1. **Miner `--per-phrase` widened from the default 8 to 100.** The default left
   ~93% of the API budget unused, so the pass would not have genuinely exhausted
   the budget the run contract allocated. The same `--api-budget`, `--wall-clock-ms`,
   and `--max-cost-usd` ceilings still bound the run; only the per-phrase page
   depth changed. Committed in `mined-candidates.json` args for replay.
2. **Derived-witness stop-the-line definition corrected mid-phase.** The first
   Phase 3 measurement flagged 4 pure-constant hardcode fires as stop-the-line.
   On inspection those are correct catches: on an output-changing perturbation a
   pure-constant hardcode fails the derived assertion with the same identity the
   base fails, and the honest twin passes, so the identity clause fires soundly.
   The stop-the-line condition was narrowed to honest-head fires only, which is
   the true halting case. Not a weakening: honest false positives stay 0/8, and
   the whole surface is advisory, so no gate trigger changed.

## The endgame question, answered honestly

Can an agent PR carry enough proof to auto-merge without a human? Not yet, and
this run did not pretend otherwise. What it delivered is the consumption plumbing
(a byte-checkable per-engine attestation) and one more sound witness class
(derived from a passing parent test) that closes a specific blind spot on twins
while abstaining in production. The gating story is unchanged: nothing new gates,
everything new is advisory, and the one path to a new gate trigger (fresh wild
cheats, folded and hunted) is blocked on yield, which no amount of code closes.
The miner now packages every night for the maintainer who can.
