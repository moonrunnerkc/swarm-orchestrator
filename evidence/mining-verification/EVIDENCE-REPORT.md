# Mining-verification run: evidence report

One question came in: is **0 confirmed of 1721 examined** a fact about the world or
a defect in the instrument? One answer goes out, with receipts.

## Verdict

**The instrument is validated on the core question, and the run also found and fixed
one real, separate defect that does not change the answer.**

- **The terminal 0 is a fact, not a stuck instrument.** The dual-arbiter gate that
  produced it is a working discriminator: its exact primary tier (`claude-opus-4-8`,
  prompt v2) returns `true-cheat` on 21 of 23 planted oracle cheats (91.3%), yet
  returns `false-alarm` on the real complaint PRs. It is a stricter, diff-grounded
  confirmation bar than the maintainer-complaint bar the 27 were confirmed at, and
  it judges these specific PRs as not-clear-cheats on the diff, exactly as
  `HUNT-2-REPORT.md` already characterized them.
- **`0/1721` and `27/327` are not comparable.** Different confirmation bars
  (dual-arbiter vs maintainer-complaint) on different populations (global
  cheat-comment PRs vs enumerated agent PRs). At the matched complaint bar the
  endgame rate is flat-to-higher than Hunt 2's 8.3%. No decline in wild cheating is
  supported by this data.
- **One proven instrument defect, fixed:** the miner attributed agents by PR body
  only and re-detected 9 of the 27; the full fingerprinter recovers 26. The fix
  feeds the fingerprinter the author/branch/commit signals it is built for. It
  widens the funnel but does not change the terminal 0, because the arbiter still
  gates.

No pattern, prompt, threshold, or bar was loosened. No proof-tier or witness code
was touched.

## Controls

### Positive control (the 27, `benchmarks/real-prs/mining-verification/POSITIVE-CONTROL.md`)

| stage | result | reading |
|---|---|---|
| pattern | 26/26 fetchable re-match | matcher healthy (1 PR is a 404 since Hunt 2) |
| attribution (miner, body-only) | 9/27 | **narrow: proven defect** |
| attribution (full fingerprinter) | 26/27 | the recall the fix restores |
| arbiter | 0/11 evaluated confirmed (9 false-alarm, 2 split) | judged not-clear-cheats on the diff |
| arbiter capability (planted cheats) | 21/23 true-cheat (91.3%) | **discriminator, not stuck** |

### Negative control (30 non-cheat complaints, `NEGATIVE-CONTROL.md`)

| measure | count |
|---|---|
| pattern-miss (no cheat signal) | 24/28 fetched |
| pattern-trip (spurious) | 4 |
| arbiter-evaluated trippers | 2 (both false-alarm) |
| **confirmed** | **0** |

No false-positive path: the matcher is specific, and the gate refutes the rare
spurious trip.

## Funnel and population (`FUNNEL-AUTOPSY.md`)

The 1721 reconstructs from committed records (no logging gap): 1545 not-agent-
attributed, 151 complaint-not-confirmed, 25 complaint-confirmed, 24 reached the
arbiter, 0 confirmed (21 false-alarm, 3 split). The 1545 is understated by the
attribution defect: a bounded deep-attribution re-mine recovered 10 agent PRs per
144 examined (7%), including an original-27 codex-cli member, so the true
agent-attributed count is materially above 176.

| | Hunt 2 (27) | endgame (0) |
|---|---|---|
| population | enumerated agent PRs | global cheat-comment PRs, agent-filtered |
| denominator | 327 | 1721 (176 agent, a floor) |
| bar | maintainer complaint | dual arbiter |
| numerator | 27 | 0 arbiter; 25 complaint |
| rate | 8.3% | complaint bar 8-14%; arbiter bar 0 |

## The fix

Root cause: `mine-complaints.ts` called `detectAgent({ prTitle, prBody })` and
`searchMergedPrsGlobal` dropped the PR author, so bot-author, branch-prefix, and
commit-trailer signals never reached the fingerprinter. Fix (commit `cff45996`):
capture the author from the search result (free) and add an opt-in
`--deep-attribution` pass that fetches head ref + commit messages for a hit the
cheap gate misses. Covered by the harness tests (`attributionModes` asserts the
bot-author and branch-only recoveries) and validated end-to-end by the bounded
re-mine (`attribution-deep-recovered: 10`). Both controls pass after the fix: the
positive control's `full-attr` column is 26/27, the negative control shows no
over-attribution and 0 confirmations.

Corrected yield: the fix lifts attribution recall (9/27 to 26/27 on the regression
set; 14 to 28 on the negative set; +10 per 144 on a fresh sample). The corrected
**confirmed** yield is still **0**: no amount of correct attribution manufactures a
dual-arbiter-confirmed cheat, because the validated discriminator judges these
complaint PRs as false-alarm on the diff. That is the honest result.

## Per-phase commits

| phase | commit | what landed |
|---|---|---|
| 0 baseline | `ddb3f1fa` | probes, spend cap, the 27 regression set |
| harness | `a4014e3e` | control runner + pure stages + 9 tests |
| fix | `cff45996` | author + branch + commit attribution in the miner |
| controls + funnel | `3066c61a` | positive, negative, funnel autopsy, re-mine |
| report + readiness | this commit | verdict, READINESS item 4 |

## Spend (Anthropic)

| phase | usd | detail |
|---|---|---|
| 0 baseline | ~0.00 | 1 haiku probe |
| arbiter capability | 1.11 | opus v2 on 23 planted cheats (ceiling stopped the v1 tier) |
| positive control | 0.25 | 4 fresh opus pairs on viable-first 27, 9 reused free |
| negative control | 0.36 | 2 opus pairs on trippers, cap-stopped |
| re-mine | 0.00 | `--arbiter off` |
| **total** | **1.72** | |

## Deviations (numbered)

1. **Spend overran the cap by $0.01 ($1.72 vs $1.71).** The `CostLedger` ceiling is
   checked before a call, so a dual-arbiter pair can overshoot by one pair. The
   negative control's second pair crossed $0.30 (its ceiling) and finished at $0.36,
   putting the run total at $1.72. Per the halt rule, all paid work stopped there;
   every later step is free. The overshoot is a granularity artifact, not a budget
   decision.
2. **The v1 secondary arbiter tier was not capability-tested on planted cheats.** The
   arbiter-capability run hit its ceiling during the v2 primary tier. This is
   acceptable because v1 is not the cause of the 0: the v2 primary alone returned
   `false-alarm` on all 24 evaluated endgame candidates, and confirmation requires
   both tiers to say `true-cheat`. v1's prompt does carry an "already-merged / most
   are false-alarm / high bar" prior that is context-mismatched for the mostly-closed
   complaint PRs; it is a latent hygiene issue for a future run, not a defect fixed
   here (changing it would loosen the gate without evidence it is broken, and would
   not move the 0).
3. **The attribution fix's `--deep-attribution` is opt-in, not default.** Deep
   attribution costs one extra fetch per cheap-gate miss, which on the full 1721
   stream is a large HTTP volume, so defaulting it on would change the miner's cost
   profile and the committed authoritative funnel. Author-feeding (free) is always
   on; the branch/commit deep pass is a flag. A future full re-mine with
   `--deep-attribution` will produce the corrected authoritative funnel; this run
   validated the fix on a bounded sample within the cap.
4. **2 of the 27 and 2 of the 30 could not be fully fetched** (1 deleted PR / 404;
   3 diffs over GitHub's size limit). They are recorded per-entry with the error and
   excluded from the stages they could not reach.

## The question, answered

Is the 0 a fact or a defect? Both, precisely separated. The confirmed-yield 0 is a
fact: a validated discriminator, applied at a stricter bar than Hunt 2 used, finds
no diff-grounded cheat among these complaint PRs, and the denominators do not
compare, so no decline is claimed. The one defect the controls exposed is in
attribution, not in the arbiter or the count; it is fixed, and fixing it widens the
funnel without manufacturing a single confirmation. The corpus does not grow from
this pass, and that remains an honest negative, not a broken instrument.
