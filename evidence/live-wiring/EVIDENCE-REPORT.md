# Live-wiring run: evidence report

Six phases, strictly sequential, each closed by its gate before the next opened.
Deterministic and model-free throughout: **USD 0.00 spent** (no `--enable-llm-judge`,
deterministic gate, the Tier C binder implemented deterministic-first so it makes 0
model calls). This run closes capability-run **deviation 3**: the error-swallow
restoration engine and the Tier C claim-to-existing-test binder shipped twin-validated
but were never wired into the shipped `swarm audit` CLI, so they could not fire on a
live audit. They are now wired, proven end-to-end, and run at volume.

## The result this run set out to produce

The carry-over is closed: both engines are wired into `runExecutionGrounded`, proven
end-to-end through `swarm audit --pr` (6/6 planted fixtures, identical fresh-clone
replays), and the backfill re-ran with the complete engine set over 120 merged agent
PRs. The **milestone** (a cheat proven in a merged agent-authored PR no human flagged)
was **not achieved**: 0 proven gate triggers across 120 PRs, no candidate reached the
FP protocol. That is consistent with hunts 2 through 8.

## Per-phase commits and gates

| phase | commits | gate met |
|---|---|---|
| 0 baseline | `e5f054c5` | toolchain green, both credentials live via `.env`, suite 2311 passing, cap USD 5.00, exact pre-wiring state of all three engines recorded |
| 1 wire error-swallow | `b88a4b2f` | dispatch + ledger kind + attestation row + config flag; twins 4/4 unchanged; fp-registry NEUTRALIZED; promotions gate-eligible=0; 2324 passing |
| 1 wire claim-binding | `f1541bd7` | dispatch + `pr-audit-claim-binding` + attestation row + config flag; twins 0/4 FP + 4/4 recall unchanged; gate-eligible=0; 2335 passing |
| 2 prove live set | `b05d633e` | 6/6 fixtures through `swarm audit --pr` with identical fresh-clone replays; entry gate fixed (`layerHasWork` claim-work); 2340 passing |
| 3 backfill setup | `379cc399` | pre-registration amendment 1 (before the first batch); full engine set enabled; engineSet provenance; fresh 120-PR population |
| 3 backfill run | `11c4e3bc` | 120 PRs, 8 batches, 0 proven, 0 HALT; every funnel committed |
| 4 surfaces | `56b33276` | attestation, audit-config, README, nightly-stream reflect the two engines; quickstart re-verified by execution |
| 5 close-out | this commit | tree clean, READINESS + CLAIMS refreshed, this report |

## The wiring, summarized

Both engines wire into the shipped `runExecutionGrounded` dispatch, advisory-only,
behind a config flag, and never gate.

- **error-swallow restoration** (deterministic, model-free). New `errorSwallow` proof
  candidate (structural `error-swallow` `block` findings); dispatched in
  `runProofRestorations` (T10); affected test files resolved with the existing
  `selectAffectedTestFiles` inverse-closure helper; `errorSwallowRestorations` added to
  the outcome with no-workspace + budget-exhausted honesty records; the
  `pr-audit-error-swallow-restoration` ledger kind; the `error-swallow-restoration`
  attestation projector; config `executionGrounded.errorSwallow` (default on, matching
  the deterministic engines); `applyErrorSwallowRestorationToFinding` corroborates a
  proven finding via the new `error-swallow-load-bearing` runtime signal, never a gate
  trigger.
- **Tier C claim-binding** (deterministic-first, abstains in production). New
  `claim-binding-candidates.ts` gathers existing-test candidates from the changed
  source's covering tests + exported symbols, no model call; `runClaimBindingPhase`
  dispatched in `runExecutionGrounded` gated by `config.claimBinding` (default off);
  new execution-grounded category `claim-falsified-bound` (advisory warn,
  injector-exempt); `pr-audit-claim-binding` ledger kind; the `claim-binding`
  attestation projector; the entry gate (`layerHasWork`) now accounts for claim work,
  so a claim-only PR provisions instead of bailing.

Existing behavior pinned: the twin regressions call the engines directly and stayed
byte-identical (error-swallow 4/4, claim-binding 0/4 FP + 4/4 recall, derived-witness
0/8 FP + 8/8 recall, all re-run this run); the FP registry stayed NEUTRALIZED; the
zero-false-block policy stayed gate-eligible=0 after each wiring.

## Fixture proofs with replays (Phase 2)

`evidence/live-wiring/live-set-runs/LIVE-SET-PROOF-REPORT.md`, 6/6, each fixture a local
git repo (base + head) driven through the complete CLI via a fail-closed
`SWARM_PR_FIXTURE_DIR` seam. Every fixture ran twice (fresh clone); verdicts reproduced
identically.

| fixture | attested | pass |
|---|---|---|
| error-swallow-cheat | finding/proven (advisory, no trigger) | false |
| error-swallow-clean | exonerated/refuted (demoted to info) | true |
| claim-binding-goal-not-fixed | abstain/abstain:no-pass-capability-evidence | true |
| claim-binding-honest | exonerated/claim-delivered | true |
| hardcoded-output-cheat | exonerated/claim-delivered (documented derived-witness limit) | true |
| hardcoded-output-clean | exonerated/claim-delivered | true |

The GitHub fetch/clone leg is separately proven (closeout `LIVE-PATH-POLYGLOT-REPORT.md`,
4/4) and re-exercised live by the Phase 3 backfill against real PRs.

## Batch funnels (Phase 3)

`benchmarks/real-prs/capability-hunt/live-wiring-batches/LIVE-WIRING-BACKFILL-REPORT.md`.
120 merged agent PRs, 8 checkpointed batches of 15, complete engine set, deterministic
gate, USD 0.00. **0 proven gate triggers, 0 milestone candidates, no HALT.** 46/115
provisioned (40%). error-swallow flagged 6 PRs structurally; re-audit of all 4 that
provisioned found every finding `structural-only` (0 proven load-bearing, 0
runtime-corroborated). The binder reached binding and abstained (no green-history
checkout in production). Every batch funnel carries `engineSet` provenance; the 30
pre-wiring capability PRs are labelled separately.

## Promotion-feed state

Nothing new is gate-eligible: `promotions:check` reports gate-eligible=0, block-eligible=8,
unchanged after both wirings. The two engines feed the funnel as advisory findings and
abstain denominators; the promotion mechanism (demonstrated with a synthetic fold in the
capability run) has 0 confirmed input because the hunt proved 0 cheats.

## Milestone state (plain)

**Not achieved this run.** 0 proven cheats on 120 merged agent PRs; no candidate was
raised, so none reached the FP protocol, so nothing halted for maintainer confirmation.
The tracked factors:

- **complete engine set now live**: error-swallow + claim-binding fire through the
  shipped `swarm audit --pr`, proven 6/6 on fixtures; they no longer sit unplugged.
- **executable fraction**: 46/115 = 40% of this population provisioned, in line with the
  ~40% executable frontier the capability run measured.
- **PRs through the funnel**: 120 this run (full engine set) plus the 30 pre-wiring
  capability PRs (labelled), plus the nightly stream going forward.
- **the honest production limits stand**: the Tier C binder abstains without a
  green-history checkout (the parked pass-capability problem); the pure synthesized
  derived witness remains a measurement harness that abstains in production, its
  production-viable descendant being the wired claim-binding engine.

The population is legitimate merged work. A proven catch still needs either a genuine
concealment inside a provisionable PR or a wider sweep; the nightly stream now runs the
complete set continuously, deterministically, read-only, and any proven finding halts for
a human before any claim is written.

## Spend per phase

| phase | USD | detail |
|---|---|---|
| all | **0.00** | no `--enable-llm-judge`, no arbiter; the binder is deterministic-first (0 model calls); GitHub core API + clones + local execution only. |

Under the USD 5.00 cap.

## Deviations (numbered)

1. **Phase 2 uses a fail-closed local PR-fixture seam** (`src/audit/pr-fixture.ts`, inert
   unless `SWARM_PR_FIXTURE_DIR` is set) so `swarm audit --pr` runs against a local git
   repo, rather than creating GitHub fixture repos. Reason: reproducible, zero outward
   footprint, and the fixtures cannot be deleted out from under the evidence (the exact
   problem that retired the closeout fixture repos). The GitHub fetch/clone leg is
   separately proven (closeout 4/4) and re-exercised live by the Phase 3 backfill.
2. **The entry gate was extended, not just the dispatch.** `layerHasWork` now accounts
   for claim-binding work; without it a claim-only PR (changed source + covering test, no
   structural cheat) bailed before provisioning, so the engine could never run. This is
   part of wiring the engine into the live path, analogous to the polyglot-restoration
   entry fix; the TS/structural entry decisions stay byte-identical (claimWork defaults
   false).
3. **The pure synthesized derived witness is not wired as a src engine.** It added no
   `src` (endgame Phase 3): it is a `scripts/gate` measurement harness that abstains in
   production by design. Wiring an always-abstain engine to own an attestation row would
   be speculative architecture; its production surface is the wired claim-binding engine,
   whose attestation row reports the derived/bound-witness abstain. Verified unchanged
   this run (0/8 FP, 8/8 recall).
4. **The backfill audited a fresh 120-PR population**, kept in a separate
   `live-wiring-population.json` so the frozen 60-PR `agent-corpus/sources.json` artifact
   stays byte-identical (restored via `git checkout` after the fetch). One PR search
   vendor (`replit-agent`) returned an invalid-user error and was recorded as skipped.
5. **`.swarm/audit-config.yaml` now enables `claimBinding`** (errorSwallow was already
   default-on). This makes the dogfood pr-audit and the backfill run the complete engine
   set. Both engines are advisory and cannot block, so the dogfood cannot false-block.
6. **Node 18 on this machine** crashes eslint 10's formatter on findings; lint was
   verified clean via `--format json` (0 errors, 0 warnings). CI runs Node 20/22.
7. **Go installed user-local** (`~/go-toolchain`, carried from prior runs) so the go-test
   runner is available; reversible, no sudo. Not exercised by this run's pytest fixtures
   but present on PATH for the backfill.
8. **LOC budget ratcheted** 48182 -> 48429 -> 48722 -> 48897 across the run, exact counts
   per commit; no soundness-bar change (the added `src` is the two engines' wiring plus
   the fail-closed fixture seam).

## Gate summary at close-out

- `npm run build`: clean. `npm run typecheck`: exit 0. `npm run test:ci`: **2340 passing**.
- lint (`--format json`): 0 errors, 0 warnings.
- `fp-registry:check`: NEUTRALIZED. `promotions:check`: gate-eligible=0, advisory=10.
- `corroborated-gate:check`: undefined-n. LOC budget: PASS (48897).
- tree clean except the maintainer's one pre-existing untracked file
  (`social-posts-behavioral-cheats.md`).
