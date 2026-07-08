# Readiness: the checklist that gates content work

Before any of the product is written about, every claim about it must be sound.
This is the gating checklist. Each item is **checked** (ready to write about as
stated), **unchecked-with-path** (not ready; the path to ready is named), or
**blocked-with-owner** (an external dependency owns it). No aspirational entries:
every line carries a measured value and the script that regenerates it.

Measured at the soundness run (branch point `cc1d1c42`); items 2, 4, and 6
re-probed at the endgame run (the token is now valid, so corpus mining actually
ran, and a derived-witness advisory line was measured). Re-probe before trusting
any credit- or token-dependent line.

## 1. Every gate trigger is sound (no verdict producible by its own harness defect)

**Checked.** The one known gap is closed.

- The block-eligible triggers are the self-certifying set (`test-tamper-proven`,
  `claim-falsified`, `obligation-failure`, `mock-mutation-proven`,
  `no-op-fix-proven`, `type-suppression-proven`, `fake-refactor-proven`,
  `dead-branch-proven`) plus `corroborated-under-constraint`. Each gates only when
  all its per-instance controls are green; each proof protocol's branches are
  fixture-verified (`benchmarks/oracle-corpus/proof-protocols.md`).
- The one known harness-defect gap was `claim-falsified-synthesized` ("base fails
  AND head fails"), which a witness that fails identically everywhere for its own
  setup reasons could satisfy (the Hunt 4 outline false positive). It is now closed
  by the discrimination control: the verdict is advisory (not a gate trigger), and
  it abstains in production. Twin-measured honest-twin false positives **0/16**,
  outline-pattern refusal **16/16**; the committed outline record replays to an
  abstain at clause 4.
- Regenerate: `npm run promotions:check` (gate-eligible=0), `npm run
  corroborated-gate:check`, `npm run discrimination-control:measure`; pins
  `test/audit/gate/claim-falsified-synthesized-not-gating.test.ts`,
  `test/audit/execution-grounded/outline-discrimination-replay.test.ts`.
- Caveat, not a defect: the v12 corroborated structural gate is `undefined-n`
  (the provisionable slice carries no outcome-bad PR), so it stays not-ready by
  construction, not because of a harness defect
  (`benchmarks/real-corpus/CORROBORATED-GATE-READINESS.md`).

## 2. Advisory tier value, stated with real numbers

**Checked** (the numbers exist and are honest; they are low, which is exactly why
the tier is advisory, not gating).

- **Per-detector precision on the real-outcome corpus** (all 10 advisory-only;
  gate-eligible = 0; floor is Wilson-95 lower >= 0.9 with >= 5 true positives):
  no-op-fix 2/8 (0.25), error-swallow 2/5 (0.40), fake-refactor 1/2 (0.50),
  coverage-erosion 1/4 (0.25), assertion-strip 0/5, mock-of-hallucination 0/2,
  test-relaxation 0/1; comment-only-fix, exception-rethrow-lost-context,
  dead-branch-insertion have 0 firings on the corpus. None clears the gate floor.
  Regenerate: `npm run promotions:check` (`benchmarks/real-corpus/promotions.json`).
- **Twin separation, detector tier** (semi-synthetic, n=52): cheat fire rate 0.56,
  honest fire rate 0.02, separation 0.54, McNemar p = 7.5e-9, 1 honest-twin
  advisory false positive. Regenerate: `npm run twins:separation`.
- **Discrimination control, twin measurement** (n=16 executable semantic twins):
  honest-twin false positives 0/16, twin-mode recall 16/16, separation 1.00,
  production reach cost 16/16 abstains. Regenerate: `npm run
  discrimination-control:measure`.
- **Derived-witness, twin measurement** (n=8 executable twins, half
  output-preserving, half output-changing): honest-twin false positives 0/8,
  special-casing recall 8/8, production abstain 8/8, separation 1.00; the
  pure-constant hardcode splits 4/4 caught on output-changing, 0/4 on
  output-preserving (a documented indistinguishability limit, not a false fire).
  Advisory; abstains in production for the same pass-capability reason as the
  discrimination control. Regenerate: `npm run derived-witness:measure`
  (`benchmarks/twins/DERIVED-WITNESS-REPORT.md`).
- **Judge comparison** (`benchmarks/twins/JUDGE-GATE-COST-REPORT.md`): wild-cheat
  recall 1/7, clean-side false-block rate 1/52 (Wilson-95 [0.00, 0.10]), proof
  tier 0% recall / 0% false positive on the same semantic set. Regenerate: `npm run
  judge-gate-cost` (funded) or `--report-only` from the committed JSON.

## 3. Executable surface

**Checked.** Proof-executable **7 of 27** wild entries (Node proof tier can run),
6 of 7 provisioned. The census is closed with an itemized reason for every entry
outside the surface (`benchmarks/real-prs/hunt3/VIABILITY-LIFT.md` close-out).
Regenerate: `npm run viability-census`, then `SWARM_EG_NODE_BIN=<node22> node
dist/scripts/real-prs/hunt3-provision-proof.js`.

## 4. Corpus freshness

**Candidates packaged, awaiting maintainer fold.** The corpus truth condition is
corrected: an entry exists when a maintainer publicly called the PR a cheat and named
the category, and the human maintainer folds it. A model verdict is neither half of
that. The dual arbiter was, for a period, read as if a both-confirm were the
existence condition; the mining-verification run measured that gate at **0/11 recall
on real maintainer-confirmed cheats** (against 21/23 on planted, diff-legible ones),
so it was demoting real wild cheats to non-existent on the assumption a cheat is
legible in the diff. That assumption is the opposite of this project's thesis. The
arbiter is now an **annotation for ranking, never a veto** (`intake-rewire` run,
`evidence/intake-rewire/EVIDENCE-REPORT.md`; `DATASET.md` truth-condition section).

- **24 complaint-confirmed candidates** sit in the review package
  (`benchmarks/real-prs/wild-cheat-corpus/incoming/`), deduped against the frozen 27:
  the endgame 25 and the deep-attribution re-mine, plus 7 from a fresh-window mine
  (6 of the 7 recovered by the attribution fix, on real projects: triton-lang/triton,
  elixir-nx/nx, eslint-plugin-import). 11 are EG-viable (could run the proof tier if
  folded). Arbiter annotations: 0 both-confirm, 3 split, 5 unannotated, 16 both-reject
  (under a 0/11 weak-evidence reminder). None gates entry.
- **The problem is live, not declining.** At the matched complaint bar the mine's rate
  is 8 to 14 percent of agent PRs (25/176 to 32/227 across passes) against Hunt 2's
  8.3 percent. `0/1721` (the arbiter bar) never compared to `27/327` (the complaint
  bar); the mining-verification run proved the miner sound and the attribution defect
  fixed. Review noise under the corrected intake is measured: 4 of 30 benign-complaint
  threads (13 percent) reach the package, ranked low by the arbiter annotation.

Item 4 is no longer blocked on the instrument: the constraint is a maintainer fold. A
new PRIMARY pre-registered hunt (Hunt 5) needs the freshly folded entries frozen by
SHA. The nightly complaint-mine cron now mines with `--deep-attribution` and packages
every run for review (never folds). Regenerate: `node dist/scripts/real-prs/intake-package.js
--in benchmarks/real-prs/wild-cheat-corpus/mined-candidates.json --in benchmarks/real-prs/wild-cheat-corpus/mined-candidates-fresh.json`,
then a maintainer runs `fold-approved.js --approved-ids <ids>`.

## 5. Documentation consistency (the Phase 2 sweep)

**Checked.** Class A (witness compile pinned/deterministic): swept clean, no
current-state overstatement in `src`; recorded-not-pinned is stated in
`proof-protocols.md`. Class B (`claim-falsified-synthesized` as
self-certifying/proven): the live gate/promotions/self-certifying machinery was
already correct; the one live overstatement (the Hunt harness `deriveStatus`
`proven-block` label) is corrected to `claim-differential-advisory`, pinned by a
new test. Full inventory: `evidence/soundness/SWEEP-INVENTORY.md`. Regenerate:
`npm run promotions:check` plus the pin tests above.

## 6. Open external blockers

| blocker | state | owner |
| --- | --- | --- |
| Fresh-corpus fold | 24 complaint-confirmed candidates packaged under the corrected bar (arbiter annotates, does not gate); awaiting a maintainer fold to grow the corpus and unblock Hunt 5 (item 4) | maintainer |
| Anthropic credits fluctuate | live at this run (HTTP 200); probe every run | maintainer |

(`GITHUB_TOKEN` was the item-4 blocker at the soundness run; it is valid again
here, so it is no longer the constraint. Yield is.)

## What content work is ready

Items 1, 2, 3, and 5 are checked: the gate-soundness story, the advisory-tier
numbers (now including the derived-witness advisory measurement), the executable
surface, and the documentation consistency can be written about as stated. The
machine-readable proof-coverage attestation (`docs/attestation.md`, emitted on
every `swarm audit` run and content-addressed into the evidence pack) is a
consumption surface that a downstream auto-merge policy can read; it makes each
engine's executed/verdict/abstain-reason claim byte-checkable rather than
asserted, so it is safe to write about as a mechanism.

Item 4 (fresh-corpus claims, and therefore any "we caught N new wild cheats"
statement) stays blocked: the token is unblocked but the mining pass produced 0
arbiter-confirmed entries, so no fresh cheat has been diagnosed. It must not be
written until a mining pass yields confirmable entries, a maintainer folds them,
and a PRIMARY hunt runs against them.
