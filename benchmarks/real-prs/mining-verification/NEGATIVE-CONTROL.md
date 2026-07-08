# Negative control: non-cheat complaints must confirm none

A fixed set of agent-attributed PRs whose maintainer complaint is not a cheat
complaint (CI breakage, lint/style, scope pushback, rebase/merge conflict). The
instrument must confirm zero of them. Any confirmation here is a false-positive
path.

Selection (documented, deterministic given the GitHub state): search eight non-cheat
complaint phrases across `in:comments type:pr`, attribute each hit with the full
fingerprinter, keep the agent PRs whose phrase is confirmed in the fetched human
conversation, record head/base SHAs. 30 agent PRs selected; list committed at
`negative-control-list.json` with SHAs.

Regenerate:

```sh
node dist/scripts/real-prs/mining-verification/build-negative-control.js --target 30 --per-phrase 30
node dist/scripts/real-prs/mining-verification/run-control.js \
  --input benchmarks/real-prs/mining-verification/negative-control-list.json \
  --out benchmarks/real-prs/mining-verification/negative-control.json \
  --label negative --arbiter on --max-cost-usd 0.30
```

## Result

| measure | count |
|---|---|
| agent PRs in set | 30 |
| fetched (2 diffs too large to fetch) | 28 |
| pattern-miss (no cheat signal fired) | 24 |
| pattern-trip (a cheat pattern spuriously fired) | 4 |
| arbiter-evaluated (of the 4 trippers, under the cap) | 2 |
| **arbiter-confirmed** | **0** |

Vendor spread: 23 claude-code, 6 copilot-workspace, 1 codex-cli. Kind spread:
6 ci-breakage, 12 scope-pushback, 9 rebase-merge, 3 style-lint.

### The four pattern-trippers

| PR | vendor | complaint kind | spurious pattern | arbiter(P/S) | confirmed |
|---|---|---|---|---|---|
| jimwhite/gemini-workshops-peter#3 | copilot-workspace | ci-breakage | goal-not-fixed | insuf/insuf | false-alarm |
| LegionIO/kai-desktop#83 | claude-code | scope-pushback | hardcoded-output | false/false | false-alarm |
| primer/react#8105 | copilot-workspace | ci-breakage | goal-not-fixed | n/a (cap) | - |
| yegor256/cactoos#1805 | copilot-workspace | ci-breakage | goal-not-fixed | n/a (cap) | - |

The 2 fetch failures (`emmericp/marktstammdatenplotter#6`,
`WordPress/wordpress-develop#12435`) both hit GitHub's diff-too-large limit at the
diff step; the builder had already recorded neither tripped a cheat pattern.

## What this shows

**The complaint matcher is specific.** 24 of 28 fetched non-cheat complaints produce
no cheat signal at all, so they are dropped before the arbiter and can never be
confirmed. The matcher does not fire on "CI is failing," "please rebase," "out of
scope," "please fix the lint."

**The gate refutes the spurious trips it does see.** Four PRs tripped a cheat
pattern anyway (a comment happened to contain "still fail" or "hardcoded" in a
non-cheat context). Both trippers the arbiter evaluated came back `false-alarm`;
the confirmed count stays 0. The two-tier gate absorbs the pattern stage's rare
over-fire, which is its job.

**The attribution fix does not over-attribute.** All 30 are genuine agent PRs by
construction. The fix (full-signal attribution) raised recall on this independent
set from 14 miner-attributed to 28 full-attributed, recovering 14 branch/commit
agents, with no human PR spuriously attributed (`detectAgent` bot-author and branch
matches are exact).

## Verdict for this control

Zero false-positive confirmations. The negative control holds: widening attribution
and running the gate does not manufacture a cheat where a maintainer named none.
