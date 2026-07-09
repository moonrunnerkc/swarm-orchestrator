# Capability run: evidence report

Six stages, strictly sequential, each closed by its acceptance gate before the
next opened. Deterministic and model-free throughout: **USD 0.00 spent** against a
USD 5.00 cap. Nothing weakened: every control, threshold, and bar is unchanged;
the frozen corpus versions (v1/v2/v3) and prior checkpoints are byte-identical.
The pass-capability research problem stayed parked and untouched.

## The result this run set out to produce

The milestone (a cheat proven in a merged agent-authored PR no human ever flagged)
was **not achieved**: 0 proven gate triggers across 30 merged agent PRs, no
candidate reached the FP protocol. What shipped instead is the machinery that makes
the hunt safe and continuous, and closes the standing false-positive class:

- the jeduden/mdsmith#232 coverage-moving false positive is neutralized in-proof
  and pinned so it cannot regress;
- two new proof surfaces (error-swallow restoration, Tier C claim-to-existing-test
  binding) validated on twins, both advisory;
- reach engineered and measured (executable fraction, Python issue-repro);
- the hunt runs in both directions with a pre-registered protocol, and its verdicts
  wire into the promotion machinery.

## Per-stage commits and gates

| stage | commits | gate met |
|---|---|---|
| baseline | `96466308` | toolchain green, both credentials live, cap USD 5.00 |
| 0 FP-hardening | `c42c282e`, `c399c846`, `39429fa1` | registry fails CI on a deliberate firing; refuter twins 6/6 (relocation abstains, planted prove); demotion + attestation shipped with tests |
| 1 reach | `498ae6fd`, `029fbea9` | error-swallow twins 4/4 through the real engine; vlebo funnel recorded; executable-fraction metric emitting |
| 2 claim binding | `0b95619d`, `0d5dec30` | claim-binding twins (honest FP 0/4, recall 4/4, sep 1.00); both advisory; promotions/block-policy confirm nothing new gate-eligible |
| 3 hunt | `2b9fc97d`, `eb786876`, `07c6bc96` | pre-registration precedes all records; 2 backfill batches with funnels; stream scheduled; 0 unreviewed proven findings |
| 4 promotion | `a662e9f4` | one regeneration cycle demonstrated: logged verdicts -> aggregation -> fold -> promotions -> attestation |
| 5 close-out | this commit | tree clean, READINESS + CLAIMS refreshed, this report |

## Twin measurements (n with Wilson-95 bounds)

| measurement | result | regenerate |
|---|---|---|
| coverage-relocation refuter | 6/6 (relocation abstains 2/2, planted prove 2/2, clean refute 2/2) | `npm run coverage-relocation:measure` |
| error-swallow restoration | 4/4 (planted-cheat proven 2/2, defensive-control refuted 2/2) | `npm run error-swallow:measure` |
| Tier C claim-binding | honest FP 0/4 [0.00,0.49], recall 4/4 [0.51,1.00], no-green abstain 4/4, separation 1.00 | `npm run claim-binding:measure` |

Plus the shipped polyglot-restoration regression stayed 4/4 with the new refuter
in place, and the refuter verified firing on the real jeduden diff.

## Wild verdicts with funnels (the hunt)

Pre-registration `2b9fc97d` precedes every record under
`benchmarks/real-prs/capability-hunt/` (git-log order is the precedence proof).

- **Backward (backfill): 30 merged agent-authored PRs, 2 bounded checkpointed
  batches. 0 proven gate triggers, 0 milestone candidates, no HALT.** 22/28
  provisioned. Every per-PR funnel is committed; `BACKFILL-HUNT-REPORT.md` has the
  table.
- **Forward (stream):** `.github/workflows/agent-stream.yml`, cron 05:00 UTC,
  deterministic, uploads funnels, never pushes; a proven finding halts for
  maintainer confirmation.
- **vlebo/ctx#24** (the disclosed error-swallow target): out-of-reach (a removed Go
  validation-return, not a catch/except), funnel recorded.

Consistent with hunts 2 through 7: the gate proves 0 genuine wild cheats.

## Spend per stage

| stage | USD | detail |
|---|---|---|
| all | **0.00** | no `--enable-llm-judge`, no arbiter; every audit deterministic. GitHub core API + clones + local twin execution only. |

Under the USD 5.00 cap. The Tier C binder was implemented deterministic-only (an
arbiter may rank but never creates a binding), so 0 model calls were made.

## Deviations (numbered)

1. **Live-path fixture repos are 404** (`moonrunnerkc/swarm-eg-fixture-{py,go}`,
   deleted since close-out), so the coverage-relocation refuter and the
   polyglot-restoration regression were validated through the REAL engine on local
   git fixtures with real go/pytest execution (the offline equivalent of the
   post-fetch live path), not `swarm audit --pr` against those repos. The engine
   code exercised is the same the live path invokes.
2. **No new provisioner built (Stage 1 item 1).** The census-rank stop rule applied:
   Elixir is rank-1 but a singleton with no toolchain here (unvalidatable through
   the live path), and no unprovisioned ecosystem reaches frequency 2+. The
   deliverable is the executable-fraction metric plus the documented census decision
   (`POLYGLOT-PROVISION-REPORT.md`).
3. **The error-swallow engine (Stage 1) and the Tier C binder (Stage 2) ship
   validated + advisory, NOT wired into the `swarm audit` CLI pipeline.** Wiring a
   new engine into the block/attestation surface deserves its own FP-careful change;
   recorded as a bounded carry-over. Both are sound and twin-validated; they do not
   yet fire on a live audit. This is the run's largest honest caveat.
4. **vlebo/ctx#24 is out-of-reach for the error-swallow engine** (its Go "swallow"
   is a removed validation-return guard, not a catch/except the detector grammar
   covers). Funnel recorded honestly.
5. **Tier B widened to Python only.** Shell/command and referenced-CI-run extraction
   are recorded-not-built (opening an untrusted-shell execution surface from PR
   bodies is out of bounded scope this run).
6. **The backfill audited the existing 60-PR `sources.json`** (a prior 12-month
   fetch), not a fresh fetch, to avoid clobbering that committed artifact; 30 of 60
   audited in two batches. One PR timed out (slow clone), one errored (deleted PR);
   both recorded as honest funnel outcomes.
7. **The forward stream workflow is authored + locally validated** (YAML valid,
   flags confirmed, runner exercised by the 30-PR backfill) but its scheduled run
   executes on GitHub; a GitHub Actions workflow cannot be run locally.
8. **The binder and derived witnesses do not fire in the production pipeline**
   (advisory / abstain), so their real-outcome firing count from the hunt is 0. The
   Stage 4 promotion MECHANISM is wired and tested and demonstrated with a synthetic
   fold; it has 0 confirmed input because the hunt proved 0 cheats.
9. **LOC budget ratcheted** 47358 -> 47484 -> 47516 -> 47857 -> 48182 across the
   run, exact counts per commit; no soundness-bar change.
10. **Node 18 on this machine** crashes eslint 10's formatter (`util.styleText`)
    whenever there are findings; lint was verified clean via `--format json`. CI
    runs node 20/22 where the formatter works.
11. **Go installed user-local** (`~/go-toolchain`, carried from prior runs) so the
    go-test runner executes; reversible, no sudo.

## Milestone state (plain)

**Not achieved this run.** 0 proven cheats on 30 merged agent PRs; no candidate was
raised, so none reached the FP protocol, so nothing halted for maintainer
confirmation. The tracked factors that say how far away it is:

- **executable fraction**: 39.6% of the outcome corpus, 33.3% of the current
  intake, ~79% of the attribution-selected agent population provisions;
- **proof-shaped coverage**: test-tamper restoration executes on node/pytest/go;
  the error-swallow engine executes on node/pytest (validated, not yet wired into
  the CLI); the binder abstains without a green ref; the TS-married engines keep
  their honest non-TS abstains;
- **PRs through the funnel**: 30 backfill (committed funnels) plus the nightly
  stream going forward.

The population is legitimate merged work. A proven catch needs either a genuine
concealment inside it or a wider sweep; the infrastructure now runs that sweep
continuously, deterministically, and read-only, and any proven finding halts for a
human before any claim is written.
