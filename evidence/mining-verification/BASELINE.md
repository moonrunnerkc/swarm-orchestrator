# Mining-verification run: baseline

One question drives this run: is **0 confirmed of 1721 examined** (the endgame
mining pass) a fact about the world or a defect in the instrument? Hunt 2 found
**27 confirmed of 327** cascaded agent PRs (~8%). This baseline records the branch
point, the environment probes, the spend cap, and the exact artifacts the endgame
mining run left behind, before any interpretation.

## Branch point

- HEAD `68adec23` (`docs(endgame): evidence report, the run's honest close-out`), branch `main`.
- Working tree clean except an untracked `social-posts-behavioral-cheats.md` (unrelated, left alone).
- Build is current: `dist/` is newer than every `src/**` and `scripts/**` `.ts`.

## Suite state

`npm run test:ci` (mocha over the pre-built `dist/`, no rebuild): **2209 passing,
41 pending, 0 failing**. Matches the endgame close-out count. Green at the branch
point.

## Environment probes

| probe | result |
| --- | --- |
| `GITHUB_TOKEN` (`GET /rate_limit`) | HTTP 200, login `moonrunnerkc`, core 5000/5000 remaining |
| `GITHUB_TOKEN` (`GET /user`) | HTTP 200 |
| `ANTHROPIC_API_KEY` (1-token haiku `messages`) | HTTP 200, 8 input / 1 output tokens |

Both surfaces are live, so both controls can run. This is the first run in five
where the GitHub token is valid at the start (soundness run saw 401; endgame saw
200; still 200 here).

## Spend cap

**$1.71** total Anthropic, the arbiter cost the endgame full mining pass observed
(`mined-candidates.json.arbiterCostUsd = 1.7142...`). The run stops at the cap with
a checkpoint. Per-phase spend is recorded in the evidence report.

Observed unit cost this run: an Opus arbiter call with the full prompt (~2-3k input
+ 512 output) runs ~**$0.046**, roughly 3x the naive estimate. That bounds how many
paid arbiter calls fit under the cap (~37), which is why the paid experiments below
are sized deliberately, not run to exhaustion.

## Artifacts the endgame mining run left behind

The endgame Phase 1 (`3c347a57`) committed the full mining state. This run treats
these as read-only inputs:

- `benchmarks/real-prs/wild-cheat-corpus/mine-checkpoint.json`: **1721** `processedIds`
  (every examined PR id, deduped), 25 candidates, and the cumulative funnel. The
  checkpoint accumulates across `--resume` sessions, so the funnel counts are
  cumulative, not single-pass.
- `benchmarks/real-prs/wild-cheat-corpus/mined-candidates.json`: the funnel and the
  25 candidate records with per-arbiter verdicts. Committed funnel:

  | stage | count |
  | --- | --- |
  | searchHits (phrase-searches that returned) | 38 |
  | examined (distinct PRs) | 1721 |
  | not-agent-attributed | 1545 |
  | complaint-not-confirmed-in-conversation | 151 |
  | complaint-confirmed | 25 |
  | arbiter-not-cheat | 21 |
  | arbiter-split (excluded, counted) | 3 |
  | arbiter-confirmed | **0** |

  Run args: `--limit 25 --api-budget 400 --wall-clock-ms 2100000 --max-cost-usd 5
  --per-phrase 100`, dual arbiter (`claude-opus-4-8` primary prompt v2 +
  `claude-opus-4-8` secondary prompt v1), `--resume`. 122 API calls, $1.71, 3.6 min.

- `benchmarks/real-prs/HUNT-2-REPORT.md` and `benchmarks/real-prs/hunt2/hunt2-summary.json`:
  the 27 catalog (`complaintCatalog`) and Hunt 2's own funnel
  (`fetched: 327, complaintFlagged: 27, ...`). The 27 are extracted verbatim to
  `benchmarks/real-prs/mining-verification/hunt2-catalog-27.json` (18 claude-code,
  6 copilot-workspace, 3 codex-cli; 7 merged, 20 closed) as the instrument
  regression set.

## The two runs measure different confirmation bars (the load-bearing fact)

Hunt 2's "27 confirmed" is a **verified-maintainer-complaint** bar: a complaint on
an agent PR naming a cheat counted as confirmed, no arbiter
(`HUNT-2-REPORT.md`: "A verified complaint on an agent PR is a human-labeled wild
cheat before any proof runs"). The endgame miner (`mine-complaints.ts`) adds a
**dual-arbiter** bar on top: a candidate is confirmed only when two independent
Opus arbiters both return `true-cheat`. So "0 of 1721" and "27 of 327" are not the
same measurement. The endgame run's Hunt-2-comparable number is its
**complaint-confirmed count: 25**, reached at the same bar the 27 were.

**9 of the original 27 already reappear in the endgame 25 candidates**
(`lesmartiepants/poetry-bil-araby#545`, `yorickdewid/flight-planner#149`,
`ibenian/algebench#371`, `GoliattCo/odoo-custom#28`, `unqdlphn/quirgs#29`,
`D4M13N-D3V/MechanicBuddy#52`, `Hypefury/initech#2`, `jaseci-labs/jaseci#6480`,
`eelywasa/sf-bulk-loader#70`), each re-mined at the complaint bar and each rated
`false-alarm` (or split) by the arbiter. The mining layer re-found them; the
arbiter is where they dropped. The controls below test whether that drop is the
instrument failing or the arbiter judging correctly.

## Two candidate narrowings identified before the controls

1. **Attribution is body-marker-only.** The miner calls
   `detectAgent({ prTitle, prBody })` and the global search projection
   (`GlobalSearchPr`) drops the PR author, so the fingerprinter's highest-confidence
   signal (bot-author: `devin-ai-integration[bot]`, `copilot-swe-agent[bot]`, ...)
   and its branch-prefix signal are never fed. Every endgame candidate is
   `claude-code` via `pr-body-marker`; not one devin/cursor/copilot/codex bot PR
   survived attribution. Positive control measures this on the 6 copilot + 3 codex
   members of the 27.
2. **The population is global-comment, not agent-PR.** The miner searches
   `"<phrase>" in:comments type:pr` across all of GitHub, then filters to
   agent-attributed. So 1721 is "PRs whose comments contain a cheat phrase," of
   which 176 (1721 - 1545) are agent-attributed. Hunt 2's 327 is enumerated agent
   PRs. The denominators are not the same population; the funnel autopsy quantifies
   this.

## Halt conditions armed

Spend cap ($1.71); any fix that only works by loosening a pattern/prompt/threshold;
any change touching proof-tier or witness code; a failed token/API probe. None
tripped at baseline.
