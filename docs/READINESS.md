# Readiness: the checklist that gates content work

Before any of the product is written about, every claim about it must be sound.
This is the gating checklist. Each item is **checked** (ready to write about as
stated), **unchecked-with-path** (not ready; the path to ready is named), or
**blocked-with-owner** (an external dependency owns it). No aspirational entries:
every line carries a measured value and the script that regenerates it.

Measured at the soundness run (branch point `cc1d1c42`). Re-probe before trusting
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

**Blocked (owner: maintainer, token).** Fresh (unspent) proof-executable wild
entries: **0**. All 7 proof-executable entries were diagnosed in Hunt 3/4
(SECONDARY, confirmatory-after-exploration); outline/outline#12197 is now formally
`diagnosed` in the wild-cheat dataset. A new PRIMARY pre-registered hunt needs
post-freeze entries, which the complaint-mine workflow dispatch produces, and that
needs a valid `GITHUB_TOKEN`. The token returned HTTP 401 at this run's Phase 0, so
no entries were mined. This is an external dependency, not a code gap.

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
| `GITHUB_TOKEN` invalid (HTTP 401) | blocks Phase 4 corpus mining (item 4) | maintainer |
| Anthropic credits fluctuate | live at this run (HTTP 200); probe every run | maintainer |

## What content work is ready

Items 1, 2, 3, and 5 are checked: the gate-soundness story, the advisory-tier
numbers, the executable surface, and the documentation consistency can be written
about as stated. Item 4 (fresh-corpus claims, and therefore any "we caught N new
wild cheats" statement) is blocked on the token and must not be written until fresh
entries are mined and diagnosed.
