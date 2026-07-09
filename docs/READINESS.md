# Readiness: the checklist that gates content work

Before any of the product is written about, every claim about it must be sound.
This is the gating checklist. Each item is **checked** (ready to write about as
stated), **unchecked-with-path** (not ready; the path to ready is named), or
**blocked-with-owner** (an external dependency owns it). No aspirational entries:
every line carries a measured value and the script that regenerates it.

Measured at the soundness run (branch point `cc1d1c42`); items 2, 4, and 6
re-probed at the endgame run; items 3, 4, and 6 re-probed at the intake-rewire and
reach runs; items 3, 4, and 6 re-probed at the close-out run. **Items 1, 2, 3, and 6
re-probed at the capability run:** the jeduden coverage-moving false positive is
neutralized in-proof (the coverage-relocation refuter) and pinned in a CI-failing FP
registry; self-certifying triggers now auto-demote on accrued false positives (symmetric
with the promotion path); two new advisory proof tiers (error-swallow restoration, Tier C
claim-to-existing-test binding) are twin-validated; a pre-registered backfill hunt proved
0 cheats on 30 merged agent PRs and a nightly stream workflow is scheduled. Re-probe
before trusting any credit- or token-dependent line.

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

**Checked, and the pipeline reach now grew: proven end-to-end on Go and Python.**
The two front-end walls Hunts 5/6 died at are fixed and a Go and a Python test-tamper
prove through the **shipped `swarm audit --pr`**, not just the engine harness
(`benchmarks/oracle-corpus/LIVE-PATH-POLYGLOT-REPORT.md`, 4/4 verdicts + fresh-clone
replay; the attestation reports the non-Node engine-runner matrix; the clean controls
refute).

- **The two walls, both fixed.** (a) The JS/TS entry gate `mutableSourceFilter` no longer
  gates the whole layer: `layerHasWork` (`src/audit/execution-grounded/index.ts`) admits a
  `.go/.py` proof candidate to the polyglot engine, TS path byte-identical
  (`test/audit/execution-grounded/layer-has-work.test.ts`). (b) The Protocol-1 closure
  relevance refuter, which only activates on the live path (`repoRoot` threaded) and
  follows TS/JS/Python imports only, abstains on non-analyzable languages instead of
  mis-refuting a genuine Go proof (`isClosureAnalyzable`,
  `test/audit/cheat-detector/closure-analyzable.test.ts`). The full census of every
  language gate is `evidence/closeout/PIPELINE-LANGUAGE-CENSUS.md`.
- **Engine-runner matrix (unchanged in spirit):** test-tamper restoration executes on
  node/pytest/go; no-op-fix stays node-only (Istanbul coverage control, no Go import
  closure); the TS-married engines (mock-mutation, type-suppression, dead-branch,
  fake-refactor) keep their non-TS abstains; Elixir has no provisioner (recorded
  exclusion, confirmed by Hunt 7's elixir-nx abstain).
- **A wild Go PR proved through the live path (Hunt 7).** jeduden/mdsmith#232 proved
  `test-tamper` end-to-end, replayed. On human review that proof is a **false positive for
  "cheat"** (a legitimate refactor that moved coverage to a golden-file test the engine
  cannot see): the gate's one known false-positive class (assertion-weakening refactors
  that relocate coverage). No genuine wild cheat has been proven. See
  `benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`.

Regenerate: `npm run viability-census`; the polyglot engine via
`PATH="$HOME/go-toolchain/go/bin:$PATH" node dist/scripts/oracle/polyglot-restoration.js`;
the live path per `LIVE-PATH-POLYGLOT-REPORT.md`.

## 4. Corpus freshness

**The corpus grew v1 (27) to v2 (29), the intake is tightened, and it is now stratified
by complaint bar (v3).** Two maintainer-confirmed wild cheats were folded at the
intake-rewire run (vlebo/ctx#24 Go error-swallow, elixir-nx/nx#1685 Elixir
test-relaxation) after a per-entry human read;
they are `benchmarks/real-prs/wild-cheat-corpus/v2/dataset.json`. The truth condition
is a maintainer complaint plus a human fold; the arbiter annotates, never gates
(`evidence/intake-rewire/EVIDENCE-REPORT.md`).

- **The miner is tightened definitionally:** a complaint counts only from a human other
  than the PR author (self-comments and bots, including the Copilot review surface,
  excluded before matching). Package noise fell **13% to 3.3%** on the negative control;
  on the last 24-candidate package, 17 of 24 were self/bot noise
  (`benchmarks/real-prs/mining-verification/TIGHTENING-REPORT.md`).
- **The corpus is now stratified by complaint bar (v3).** The fold-time capture never
  stored the complaint author, so a live re-fetch classifies each entry: **strict 9,
  legacy 19, uncertain 1** over the 29 (of the inherited 27: strict 7, legacy 19,
  uncertain 1; 6 of the legacy are solo-maintainer self-flags). The "27 maintainer-flagged"
  is the loose bar; strict independent-human is 7. Frozen v1/v2 byte-identical; the
  stratification is a new v3 label with full provenance. Every downstream report and hunt
  now keys results to strata. See
  `benchmarks/real-prs/wild-cheat-corpus/COMPLAINT-BAR-AUDIT.md` and
  `.../v3/dataset.json`. Regenerate: `node dist/scripts/real-prs/mining-verification/complaint-bar-audit.js ...`.
- **The current review package is 6 candidates** (down from 24 under the tightening),
  2 EG-viable, staged at `benchmarks/real-prs/wild-cheat-corpus/incoming/`. On prior
  human review these read as legitimate-on-the-merits or iteration feedback, so 0 are
  recommended to fold; the sitting is the maintainer's.
- **Three hunts ran on the folded entries, all honest zeros.** Hunt 5: 0 of 2, the
  restoration tier could not execute non-Node. Hunt 6: 0 of 2, the barrier moved upstream
  to `mutableSourceFilter`. Hunt 7 (after both walls were fixed and the live path proven):
  0 of 2 primary, both itemized out-of-reach as pre-registered (vlebo/ctx category, elixir
  language). Hunt 7 also ran the 4 newly-reachable non-Node entries: 1 reached the engine
  and proved (jeduden, a false-positive-for-cheat refactor, item 3), 3 abstained
  (detector-no-fire / TS-married). `benchmarks/real-prs/hunt7/HUNT-7-REPORT.md`.
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
| Fresh-corpus fold | corpus grew to v2 (29), stratified to v3; the current 6-candidate tightened package reads as legit-on-merits (0 recommended to fold); further growth awaits a maintainer sitting on a package with a clean cheat (item 4) | maintainer |
| Polyglot pipeline reach | **resolved.** Both front-end walls fixed (`layerHasWork`, `isClosureAnalyzable`); a Go and a Python test-tamper prove end-to-end through `swarm audit --pr` (item 3, `LIVE-PATH-POLYGLOT-REPORT.md`) | closed this run |
| Gate false-positive class | **neutralized this run.** The coverage-relocation refuter (`test-restoration.ts` Step 6d) downgrades a proven restoration to `not-proven:coverage-relocated` when the PR adds replacement coverage in a changed production directory; the attestation surfaces it as `disputed` (human-review), never clean. Pinned in the CI-failing FP registry (jeduden entry one); twins 6/6. | fixed (`benchmarks/results/FP-HARDENING-REPORT.md`) |
| pytest provisioning-install | the sandbox installs pytest into a `.venv` but the run uses ambient `python3 -m pytest`; works where a system pytest exists, not on a clean sandbox (Go has no such gap) | next run |
| Anthropic credits fluctuate | live at this run (HTTP 200 via `.env`); probe every run | maintainer |

(`GITHUB_TOKEN` and the Anthropic key are both live when loaded from the project `.env`;
the shell's own vars are stale. The corpus now grows on a maintainer fold of a clean cheat.
The polyglot pipeline-reach blocker is closed: the reach is proven end-to-end.)

## What content work is ready

Items 1, 2, 3, and 5 are checked: the gate-soundness story, the advisory-tier
numbers (now including the derived-witness advisory measurement), the executable
surface, and the documentation consistency can be written about as stated. The
machine-readable proof-coverage attestation (`docs/attestation.md`, emitted on
every `swarm audit` run and content-addressed into the evidence pack) is a
consumption surface that a downstream auto-merge policy can read; it makes each
engine's executed/verdict/abstain-reason claim byte-checkable rather than
asserted, so it is safe to write about as a mechanism.

Item 4 now carries real, honest claims that can be written: the corpus grew to v2 (29),
is stratified by complaint bar to v3 (strict 7 of the inherited 27, not the loose 27), and
the intake is tightened so it no longer surfaces self-comments or bot reviews as maintainer
complaints (13% to 3.3% package noise). The polyglot pipeline reach is now writable too: a
Go and a Python test-tamper prove end-to-end through the shipped `swarm audit --pr` (4/4,
replayed), and the two front-end walls are fixed.

What still must not be written: "the proof tier caught a wild cheat." Hunts 5, 6, and 7
proved 0 genuine wild cheats. Hunt 7 did prove a `test-tamper` on a wild Go PR end-to-end
(jeduden), but human review shows it is a **false positive for cheat** (a legitimate
coverage-moving refactor), so the honest claim is "the pipeline proves end-to-end on wild
Go, and here is its one false-positive class," not "caught a cheat." No `v1` entry is a
genuine proven cheat. The writable claim is capability and its measured limits, not a catch.
