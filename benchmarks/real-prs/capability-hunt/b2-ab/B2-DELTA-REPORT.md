# B2 delta report: subdirectory-manifest provisioning, paired A/B

Paired re-run of the frozen 120-PR live-wiring population
(`live-wiring-population.json`) with the B2 provisioner (`b9874a7d`) as the
only intended variable: same runner
(`scripts/real-prs/capability-hunt-backfill.ts`), same 150s per-audit cap,
same engine set (`restoration+error-swallow+claim-binding (live)`), no LLM
judge, USD 0.00. Before arm: the committed live-wiring records
(`../live-wiring-batches/records/`). After arm: `records/` here, tallied in
`BACKFILL-b2-after.json`. Run on 2026-07-26.

## Provision rate

| | attempted | provisioned |
|---|---|---|
| before (live-wiring) | 115 of 120 | 46 |
| after (B2) | 110 of 120 | 48 |

Attempted dropped 115 to 110 by population drift, not by the provisioner: 8
PRs now fail at the PR-diff/context fetch (repo deleted or PR gone, all
GitHub 404s: 3 on thanhmam/financekids-v2, plus ASN-PP-PowerKeys#161,
XGBoost-GPU_Protein_Pocket_Predictor#10, aw-abm#7, Coarse-Grain#3,
viventium#58) and 2 timed out before provisioning.

## B2 recovery

4 PRs that failed install in the before arm now provision, every one via a
subdirectory manifest install:

| PR | manifestDir |
|---|---|
| ivanopaulon/EventForge#1395 | Prym.Web |
| shafiq0225/MutualFundAppV2#4 | MutualFundScheme-Web |
| shafiq0225/MutualFundAppV2#6 | MutualFundAuth-Web |
| shafiq0225/MutualFundAppV2#8 | MutualFundNav-Web |

The 5th newly provisioned record (PrefectHQ/prefect#22471) timed out in the
before arm and simply completed this time; timing variance, not B2.

As the plan warned, the 27/27 single-signature night came from a different
population mix: on this 120, the no-manifest-at-root family is 50 of the 62
classified install failures, but only these 4 carried a provisionable subdir
manifest that owns the PR's diff. 37 have no manifest anywhere the discovery
looks (C# solutions, script piles) and 9 have manifests that own none of the
changed files. The real recovery on this population is +4.

## Verdict diff on the original 46 (must be empty)

Empty where an audit could run. The only 3 differing records are the
thanhmam/financekids-v2 PRs (#15, #17, #19), which error at the PR-diff
fetch because the repo has been deleted since the before arm (`gh api
repos/thanhmam/financekids-v2` returns 404); no provisioner code runs on
them. No provisioned PR changed pass, block, or gate triggers. All 48
provisioned records carry the new `provisioning.manifestDir` provenance
('.' for a root install).

Procedural note: the first pass of the after arm showed 3 more diffs
(goscribe/fantastic-broccoli#41 as an error, legend-exp/pygama#654 and
iamvikasraj/vry#7 as timeouts). The error was self-inflicted (a `npm run
build` of this repo raced the running batch and briefly emptied `dist/`);
all 3 re-ran clean with verdicts identical to the before arm and the
committed records are the re-runs.

## Install-failure buckets after B2

| bucket | count |
|---|---|
| no-manifest-found | 37 |
| no-manifest-for-diff | 9 |
| other | 13 |
| engines-mismatch | 1 |
| lifecycle-script | 1 |
| peer-dep-conflict | 1 |

The before arm predates the B1 instrumentation, so it has no bucket table to
compare against; this is the first classified table for this population.
`other` is 13 of 62 (21%), above the B1 under-10% target, and its
composition names the next two fixable classes: 10 are pnpm/bun invocations
that died at spawn (exit code null, empty stderr and stdout; the capture
needs a spawn-error path), and 3 are pip failures whose output states a
Python version requirement the sandbox interpreter does not meet (a
Python engines-mismatch matcher would classify them). Neither is touched in
this session.

## Corpus viability screen (v3 29 + v4 additions, per stratum)

`corpus-viability-delta.json`, produced by
`scripts/real-prs/corpus-viability-delta.ts --refresh` with the screen now
mirroring the provisioner's discovery. Three columns because the frozen
flags predate the polyglot screen: "root-only now" isolates screen-version
drift (Python/Go support that landed in earlier phases) from the B2
discovery itself. A subdir-viable screen result is an upper bound; the
provisioner's diff-ownership rule decides per PR.

v3 29 (the amendment-2 recall population):

| stratum | entries | frozen | root-only now | with B2 discovery |
|---|---|---|---|---|
| strict | 9 | 3 | 4 | 5 |
| legacy | 19 | 4 | 11 | 14 |
| uncertain | 1 | 0 | 0 | 0 |
| total | 29 | 7 | 15 | 19 |

B2-attributable recoveries in v3: pwncollege-ctf-archive-pr133 (strict,
`m0leconteaserctf2025/ptmcasino/src`), eelywasa-sf-bulk-loader-pr70
(`backend`), GoliattCo-odoo-custom-pr28 (`agents`),
omniscient-markethawk-pr408 (`backend`), all legacy but pwncollege. The
plan's corpus target (EG-viable 7 to 12 or better) is met at 19, though 8 of
the 12 recovered entries come from screen-version drift, not this session's
change.

v4-additions slice (reported separately per amendment 4):

| entry | frozen | with B2 discovery |
|---|---|---|
| import-js-eslint-plugin-import-pr3230 | not viable (no lockfile) | not viable (no lockfile) |
| matrixorigin-matrixone-pr25683 | viable (Go module) | viable (Go module) |

Recall pass 3 is not run here; it is its own pre-registered measurement on
the post-B2 viable set, reporting the v3 29 headline and the v4-additions
slice separately.
