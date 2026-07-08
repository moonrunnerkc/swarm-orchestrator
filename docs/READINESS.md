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

**Blocked (owner: arbiter yield).** Fresh (unspent) proof-executable wild
entries: **0**. The `GITHUB_TOKEN` that blocked this at the soundness run is now
valid (HTTP 200 at the endgame run's Phase 0), so the complaint-mine workflow ran
at full budget: **1721** PRs examined, 25 complaint-confirmed, **0
dual-arbiter-confirmed** (21 arbiter-not-cheat, 3 arbiter-split, 1 unevaluable).
The blocker is no longer the token; it is yield. This pass surfaced no confirmable
wild cheat to grow the corpus, so the corpus is unchanged and no PRIMARY hunt can
be pre-registered. The review package is committed at
`benchmarks/real-prs/wild-cheat-corpus/incoming/` (REVIEW.md + intake.json) with a
single fold command, and the nightly complaint-mine cron now packages every run
for maintainer review (never folds). A new PRIMARY pre-registered hunt still needs
post-freeze folded entries; none landed. Regenerate: dispatch complaint-mine.yml
(or `node dist/scripts/real-prs/mine-complaints.js` with a valid token), then
`node dist/scripts/real-prs/intake-package.js`.

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
| Fresh-corpus yield | complaint-mine ran token-valid; 0/1721 arbiter-confirmed, corpus did not grow (item 4) | miner, maintainer |
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
