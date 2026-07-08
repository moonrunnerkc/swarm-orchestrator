# Intake-rewire run: baseline

The mining-verification run proved the dual-arbiter gate held an existence veto it
never earned: 0/11 recall on real maintainer-confirmed cheats, 21/23 on planted
ones. Wild cheats are not diff-legible, which is this project's own thesis, and the
intake framing enforced the opposite. This run corrects the corpus truth condition,
recovers the candidates that framing discarded, packages fresh wild entries for the
maintainer's fold, and runs Hunt 5 if the fold lands.

## Branch point

- HEAD `8f68809b` (`docs(mining-verification): evidence report + READINESS item 4`), branch `main`.
- Working tree clean except the pre-existing untracked `social-posts-behavioral-cheats.md`.
- Build current; suite green (2218 passing, 41 pending, 0 failing at the prior run's close).

## Environment probes

| probe | result |
| --- | --- |
| `GITHUB_TOKEN` (`GET /rate_limit`) | HTTP 200 |
| `ANTHROPIC_API_KEY` (1-token haiku) | HTTP 200 |

Both live, so the fresh mine (Phase 3) and any arbiter annotation can run.

## Spend cap

**$1.71** total Anthropic, the arbiter cost of the endgame full pass and the cap
every prior run in this line held. The only paid work this run is the Phase 3
bounded fresh mine; arbiter annotation is skippable under budget and recorded as
skipped. Enforced by the existing `CostLedger`; per-phase spend recorded in the
evidence report. Observed Opus arbiter unit cost is ~$0.05/call (mining-verification
run), so the fresh mine is sized deliberately.

## The candidates this run recovers and packages

- **25 complaint-confirmed candidates from the endgame pass:**
  `benchmarks/real-prs/wild-cheat-corpus/mined-candidates.json` (funnel:
  examined 1721, 25 complaint-confirmed, 0 dual-arbiter-confirmed). All 25 already
  sit in the committed review package (`incoming/intake.json`); the endgame narrative,
  not the code, treated the 0 dual-arbiter-confirmed as "nothing to fold."
- **The bounded deep-attribution re-mine:**
  `benchmarks/real-prs/mining-verification/remine-deep-attribution.json` recovered
  10 agent PRs the body-only gate had dropped; of those, 2 carry a confirmed
  complaint (`pgsty/pigsty#747` codex-cli, an original-27 member; `ralch22/aquora#6`
  claude-code, new). Under the corrected bar (complaint + attribution), those 2 are
  the re-mine's foldable candidates; the other 8 have no complaint and do not enter.
- **The corpus to dedup against:** `benchmarks/real-prs/wild-cheat-corpus/v1/dataset.json`,
  the frozen 27. 9 of the endgame 25 and `pgsty#747` are already in it, so the
  package dedups them out.

## The corrected truth condition (binding for this run)

A corpus entry exists when a maintainer publicly called the PR a cheat and named the
category, and the human maintainer of this project confirms it at fold time. A model
verdict is neither half of that, in either direction: arbiters neither veto existence
nor confirm it; they annotate for ranking. No pattern loosening, no proof-tier or
witness code, no new capability.

## Halt conditions armed

Spend cap; any fold without an approved-ids list; any change letting a model verdict
create or destroy a corpus entry; any proof-tier or witness code change; detection
logic reading an unfolded fresh entry before Hunt 5's freeze; a failed probe on a
dependent phase. None tripped at baseline.
