# Readiness: the checklist that gates content work

Before any of the product is written about, every claim about it must be sound.
This is the gating checklist. Each item is **checked** (ready to write about as
stated), **unchecked-with-path** (not ready; the path to ready is named), or
**blocked-with-owner** (an external dependency owns it). No aspirational entries:
every line carries a measured value and the script that regenerates it.

Measured at the soundness run (branch point `cc1d1c42`); items 2, 4, and 6
re-probed at the endgame run; items 3, 4, and 6 re-probed at the intake-rewire and
reach runs (the corpus grew to v2, the intake was tightened, the restoration engine
was generalized to pytest/Go, and Hunt 5/6 ran). Re-probe before trusting any credit-
or token-dependent line.

**The parked research problem, named as parked:** whether a synthesized semantic
witness can be certified to pass on the correct behavior without a spec-derived oracle
(the pass-capability problem). It is why the claim-differential and derived-witness
tiers abstain in production (items 1, 2). It is not worked on in this line of runs; it
is parked, and every semantic-witness abstain traces to it.

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

**Checked, and the engine reach grew (the pipeline reach did not yet).**
Proof-executable **7 of 27** wild entries by the Node structural pipeline (the census
is closed with an itemized reason for every entry outside the surface,
`benchmarks/real-prs/hunt3/VIABILITY-LIFT.md`). The reach run generalized the
**test-tamper restoration engine to pytest and Go**, live-validated on planted
fixtures (planted tampers prove with full controls green, clean controls refute, 4/4,
`benchmarks/oracle-corpus/POLYGLOT-RESTORATION-REPORT.md`); every control travels and
the TS path is byte-identical.

- **Engine-runner matrix:** test-tamper restoration executes on node/pytest/go;
  no-op-fix stays node-only (its coverage control is Istanbul-only, Go has no import
  closure); the TS-married engines (mock-mutation, type-suppression, dead-branch,
  fake-refactor) keep their non-TS abstains; Elixir has no provisioner (recorded
  exclusion).
- **The reach limit, named by file:line (Hunt 6).** A non-JS/TS wild cheat does not
  yet reach the now-polyglot engine through `swarm audit`: the execution-grounded
  entry gate `mutableSourceFilter` (`src/audit/execution-grounded/index.ts:81`) admits
  only `.js/.ts` extensions, so a `.go/.py` diff bails at "no mutable source lines"
  before provisioning. The next build is generalizing that gate and the JS/TS
  structural detectors to `.go/.py`, carrying (or fail-closed abstaining) the mutation
  and coverage front-end. See `benchmarks/real-prs/hunt6/HUNT-6-REPORT.md`.

Regenerate: `npm run viability-census`; the polyglot engine via
`PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js`.

## 4. Corpus freshness

**The corpus grew: v1 (27) to v2 (29), and the intake is tightened.** Two
maintainer-confirmed wild cheats were folded at the intake-rewire run (vlebo/ctx#24 Go
error-swallow, elixir-nx/nx#1685 Elixir test-relaxation) after a per-entry human read;
they are `benchmarks/real-prs/wild-cheat-corpus/v2/dataset.json`. The truth condition
is a maintainer complaint plus a human fold; the arbiter annotates, never gates
(`evidence/intake-rewire/EVIDENCE-REPORT.md`).

- **The miner is tightened definitionally:** a complaint counts only from a human other
  than the PR author (self-comments and bots, including the Copilot review surface,
  excluded before matching). Package noise fell **13% to 3.3%** on the negative control;
  on the last 24-candidate package, 17 of 24 were self/bot noise
  (`benchmarks/real-prs/mining-verification/TIGHTENING-REPORT.md`).
- **A finding on the inherited corpus:** 19 of the 27 `v1` entries carry a self- or
  bot-authored complaint in the current thread and would not pass the tightened bar
  (temporal-drift and solo-maintainer caveats stated). The frozen set is unchanged;
  this run's own 2 folds pass the tightened bar. Recorded for a future tightened
  re-verification, not acted on.
- **The current review package is 6 candidates** (down from 24 under the tightening),
  2 EG-viable, staged at `benchmarks/real-prs/wild-cheat-corpus/incoming/`. On prior
  human review these read as legitimate-on-the-merits or iteration feedback, so 0 are
  recommended to fold; the sitting is the maintainer's.
- **Two hunts ran on the folded entries, both honest zeros.** Hunt 5: 0 of 2, the
  restoration tier could not execute non-Node. Hunt 6 (after the polyglot engine
  landed): 0 of 2, the barrier moved upstream to the pipeline entry gate
  (`mutableSourceFilter`, JS/TS-only), which bails before the now-capable engine (item
  3, `benchmarks/real-prs/hunt6/HUNT-6-REPORT.md`).
- **The problem is live, not declining:** at the matched complaint bar the mine's rate
  is 8 to 14 percent of agent PRs against Hunt 2's 8.3 percent; `0/1721` (the old
  arbiter bar) never compared to `27/327` (the complaint bar).

The nightly complaint-mine cron mines with `--deep-attribution` and the tightened
intake, and packages every run for review (never folds). Regenerate:
`node dist/scripts/real-prs/intake-package.js --in benchmarks/real-prs/wild-cheat-corpus/mined-candidates-reach.json`,
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
| Fresh-corpus fold | corpus grew to v2 (29); the current 6-candidate tightened package reads as legit-on-merits (0 recommended to fold); further growth awaits a maintainer sitting on a package with a clean cheat (item 4) | maintainer |
| Polyglot pipeline reach | the restoration engine is polyglot (pytest/Go), but `mutableSourceFilter` (JS/TS-only) bails a non-JS/TS diff before the engine; the next build is the pipeline front-end (item 3) | next run |
| Anthropic credits fluctuate | live at this run (HTTP 200); probe every run | maintainer |

(`GITHUB_TOKEN` was the item-4 blocker at the soundness run; it is valid again
here, so it is no longer the constraint. The corpus now grows on a maintainer fold of a
clean cheat, and non-Node reach on the pipeline-front-end build.)

## What content work is ready

Items 1, 2, 3, and 5 are checked: the gate-soundness story, the advisory-tier
numbers (now including the derived-witness advisory measurement), the executable
surface, and the documentation consistency can be written about as stated. The
machine-readable proof-coverage attestation (`docs/attestation.md`, emitted on
every `swarm audit` run and content-addressed into the evidence pack) is a
consumption surface that a downstream auto-merge policy can read; it makes each
engine's executed/verdict/abstain-reason claim byte-checkable rather than
asserted, so it is safe to write about as a mechanism.

Item 4 now carries a real, honest claim that can be written: the corpus grew to v2
(29) with two maintainer-confirmed wild cheats folded under the corrected bar, and the
intake is tightened so it no longer surfaces self-comments or bot reviews as maintainer
complaints (13% to 3.3% package noise). What still must not be written: a "the proof
tier caught a wild cheat" claim. Hunt 5 and Hunt 6 both proved 0 of the 2 folded
entries, honestly (Hunt 5 on language, Hunt 6 on the pipeline entry gate), and no
`v1` entry is proof-executable beyond the closed 7-of-27 census. The polyglot engine is
validated but not yet reachable through `swarm audit` for a non-JS/TS cheat; that
reach, and a proof on a wild cheat, remain unwritten until the pipeline front-end
generalizes and a matching entry is folded and hunted.
