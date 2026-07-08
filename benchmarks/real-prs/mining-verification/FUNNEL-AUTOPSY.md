# Funnel autopsy of the 1721, and the population comparison

The endgame mining pass examined 1721 PRs and confirmed 0. This reconstructs the
funnel stage by stage from the committed records and sets the endgame population
side by side with Hunt 2's 327, so the 8% -> 0% gap can be read for what it is.

## The funnel (committed, `mined-candidates.json` + `mine-checkpoint.json`)

The records carry per-stage counts already; no gap needed filling. The checkpoint
accumulates across `--resume` sessions, so these are cumulative for the pass.

| stage | count | note |
|---|---|---|
| searchHits (phrase-searches that returned) | 38 | 18 phrases, some across two resume sessions |
| examined (distinct PR ids) | 1721 | = `processedIds.length` |
| not-agent-attributed | 1545 | dropped by the body-only `detectAgent` gate |
| agent-attributed | 176 | 1721 - 1545 |
| complaint-not-confirmed-in-conversation | 151 | agent PR, but no cheat pattern in the thread |
| complaint-confirmed | 25 | agent PR + verified cheat complaint = Hunt-2 bar |
| reached dual arbiter | 24 | 1 had the arbiter off (diff too large) |
| arbiter-not-cheat (agreed false-alarm) | 21 | |
| arbiter-split (excluded, counted) | 3 | |
| **arbiter-confirmed** | **0** | both tiers `true-cheat` |

Reconciles: 1545 + 151 + 25 = 1721. The terminal filter is the arbiter: 25 reached
the Hunt-2 confirmation bar, 0 cleared the dual-arbiter bar.

### One stage is understated: attribution

The 1545 "not-agent-attributed" is the count under the body-only gate the positive
control proved narrow (miner re-detects 9 of 27, the full fingerprinter 26 of 27).
The bounded deep-attribution re-mine (`remine-deep-attribution.json`, arbiter off,
free) quantifies the miss on the same population: of 144 examined, the deep pass
recovered **10** agent PRs (7%) that the body-only gate dropped, including
`pgsty/pigsty#747`, an original-27 codex-cli member. Extrapolated, the true
agent-attributed count among the 1721 is materially higher than 176 (order ~300),
so "176 agent-attributed" is itself a floor depressed by the attribution defect,
now fixed.

## Population definitions, side by side

| | Hunt 2 (the 27) | endgame mine (the 0) |
|---|---|---|
| how PRs enter | per-vendor agent-PR enumeration in EG-viability-screened repos, then complaint-mined | global `"<phrase>" in:comments type:pr` search, then agent-filtered |
| denominator | 327 cascaded **agent PRs** | 1721 **PRs with a cheat-phrase comment** (176 agent-attributed under the narrow gate) |
| confirmation bar | verified maintainer complaint (human label) | two Opus arbiters both say `true-cheat` (diff-grounded) |
| numerator | 27 complaint-confirmed | 0 arbiter-confirmed; **25 complaint-confirmed** |
| window / query | ~18 months, per-vendor author/branch queries | phrase queries, newest-first, cross-repo |

## The comparison, computed

The two headline fractions measure different things on different populations:

- **Different bar.** 27/327 is the complaint bar. 0/1721 is the arbiter bar. Hunt 2
  never ran an arbiter over its 27; the endgame added it. The like-for-like number
  is the endgame's **complaint-confirmed count, 25**, reached at the same bar the 27
  were.
- **Different denominator.** 327 is enumerated agent PRs. 1721 is cheat-comment PRs
  of which only a fraction are agent PRs. The comparable agent-PR denominator for the
  endgame is 176 (a floor; the fix lifts it).

At the matched (complaint) bar on agent PRs:

- Hunt 2: 27 / 327 = **8.3%**.
- Endgame: 25 / 176 = **14.2%** on the narrow denominator; ~8% once the denominator
  is corrected for the attribution under-count.

Either way the endgame's complaint-bar rate is **at or above** Hunt 2's. There is no
measured decline in wild cheating. The drop to 0 is entirely the arbiter bar, a
validated stricter filter (91.3% true-cheat on planted cheats; 0 on these
complaint PRs on the merits), not a change in how often agents cheat.

## Conclusion

The 1721 funnel is coherent and fully reconstructable. The population it draws from
is not Hunt 2's population, and the bar it confirms at is not Hunt 2's bar, so
`0/1721` and `27/327` do not compare as a rate. The one genuine instrument defect in
the funnel is the attribution stage (understated agent count), which is fixed and
which widens the funnel without changing the terminal 0. A decline claim is not
supported; the matched-bar rate is flat-to-higher.
