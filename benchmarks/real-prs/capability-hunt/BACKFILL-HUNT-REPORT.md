# Capability hunt: backfill + stream (Stage 3)

Pre-registered in `PREREGISTRATION.md` (commit `2b9fc97d`, which precedes every run
record here; `git log` order is the precedence proof). Both directions of the hunt
ran deterministic and read-only; no third-party PR or repo was written to.

## Headline

**0 proven gate triggers across 30 merged agent-authored PRs; no milestone
candidate, no HALT.** Consistent with every prior hunt (2 through 7): the shipped
gate proves 0 genuine wild cheats. The deliverable is the honest funnel over a
real merged-and-never-flagged population plus the standing infrastructure (the
backfill runner and the forward nightly stream) that keeps the hunt running.

## Backward: the backfill

Population: the fixed-attribution miner's `agent-corpus/sources.json` (merged,
agent-authored PRs the shipped fingerprinter attributes to devin / claude-code,
across a 12-month window; not complaint-filtered). Audited in two bounded,
checkpointed batches through the shipped `swarm audit --pr --mode gate --output
json`, deterministic (no `--enable-llm-judge`).

| batch | audited | provisioned | pass | block(advisory) | timeout | error | proven gate triggers |
|---|---|---|---|---|---|---|---|
| batch-1 (offset 0) | 15 | 11/14 | 12 | 2 | 1 | 0 | **0** |
| batch-2 (offset 15) | 15 | 11/14 | 13 | 1 | 0 | 1 | **0** |
| total | 30 | 22/28 | 25 | 3 | 1 | 1 | **0** |

Every per-PR funnel is committed under `records/`; the batch roll-ups are
`BACKFILL-batch-1.json` and `BACKFILL-batch-2.json`.

- **`block` here is an advisory signal, not a proven cheat.** `pass=false` means a
  block-severity structural finding fired (no-op-fix, fake-refactor,
  coverage-erosion, type-suppression). Those detectors are advisory-only
  (`promotions.json` gate-eligible = 0), so a block-severity finding is a "a human
  should verify this" signal, never an auto-block. The 3 blocked PRs are large
  refactors that trip the structural heuristics, not proven concealment.
- **0 self-certifying gate triggers fired** (`test-tamper-proven`,
  `claim-falsified`, ...), so the FP protocol was never entered and the run never
  halted. A proven trigger would have stopped the batch (runner exit 3) and
  written a `HALT-*.md` for the four-check FP protocol.
- **Viability 22/28 provisioned** (79% of non-error attempts): these are real,
  installable agent PRs, a far higher provision rate than the historical
  outcome-corpus screen (12/197 Node-provisionable), because the population is
  selected for recent merged agent authorship rather than revert outcome.

## Forward: the nightly stream

`.github/workflows/agent-stream.yml`: cron 05:00 UTC + `workflow_dispatch`,
`contents: read`, node/python/go provisioned, `GITHUB_TOKEN` via env only (no
Anthropic key; deterministic audits spend USD 0.00 on models). It surfaces fresh
agent PRs (`fetch-agent-prs`) then audits a bounded batch with the same runner,
uploads the funnels as an artifact, and never pushes or folds. A proven finding
halts the batch (runner exit 3) for maintainer confirmation, exactly as the
backfill does. The workflow YAML is valid and its runner is locally validated
(the 30-PR backfill above); the scheduled run itself executes on GitHub.

## Metrics every audited PR fed (regardless of verdict)

Aggregated into `benchmarks/real-corpus/hunt-verdict-evidence.json`
(`npm run hunt:aggregate`): viability rate 22/30, per-engine abstain reasons
(`no-test-hunks`, `runner-unsupported`, `old-symbol-still-declared`,
`already-failing`, ...), advisory-finding firings by kind (the promotion
denominator; e.g. `no-op-fix:info` 75, `coverage-erosion:info` 48), and 0 gate
triggers / 0 disputed. Stage 4 wires this into the promotion machinery.

## Milestone state

**Not achieved this run.** 0 proven cheats on 30 merged agent PRs; no candidate
survived to the FP protocol because none was raised. The tracked factors that say
how far away it is: executable fraction (39.6% corpus / 33.3% intake / 79% of this
attribution-selected population provisions), proof-shaped coverage (the polyglot
restoration + error-swallow engines execute on node/python/go; the binder abstains
without a green ref), and PRs through the funnel (30 backfill + the nightly stream
going forward). The population is legitimate merged work; a proven catch requires
either a genuine concealment in it or a wider sweep. The infrastructure now runs
that sweep continuously.

## Spend

USD 0.00. Every audit deterministic (no judge); GitHub core API + clones only.
Batch API budget stayed well under the 5000/hr core limit.
