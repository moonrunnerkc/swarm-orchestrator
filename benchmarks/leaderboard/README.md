# Leaderboard harness

Reproducible scorer for the v10 cheat-detector engine against the
synthetic 500/500 corpus.

## Run locally

```bash
npm run build
npm run corpus:generate   # generate the v10 corpus (idempotent)
npm run leaderboard       # score and write results
```

Outputs:

- `benchmarks/leaderboard/results.json` — full result document.
- `docs/leaderboard/data.json` — copy consumed by the GitHub Pages site
  at <https://moonrunnerkc.github.io/swarm-orchestrator/leaderboard/>.

Exit code:

- `0` — every broken case caught, every clean case clean.
- `1` — at least one failed expectation (broken not caught, or clean
  control returned a blocking finding). This doubles as a CI gate.

## How it works

For each case in `benchmarks/falsification-corpus/v10-synthetic-corpus/index.json`:

1. Read the broken-fixture diff and the clean-control diff.
2. Run both through `runCheatDetectors`.
3. The broken case is "caught" iff any finding has the case's category.
4. The clean case is a "false positive" iff any finding of severity
   `block` matches the case's category.
5. Aggregate per-agent, per-category, and per-(agent, category).

## Adding cases

Edit the generator in
[`scripts/corpus/generate-v10.ts`](../../scripts/corpus/generate-v10.ts).
Re-run `npm run corpus:generate` and `npm run leaderboard`. Output is
deterministic.

## Limitations of the synthetic corpus

The synthetic corpus measures *detector consistency* across surface
variations of each cheat pattern. The agent attribution column is
round-robin so it does not reflect any individual agent's real-world
behaviour. A real-PR corpus (Phase 2 follow-on) replaces the agent
attribution with PRs collected from public OSS repositories opened by
each named agent.

## Auxiliary metric: judge gate-cost

The LLM-judge false-positive/recall frontier for the semantic categories the
structural detectors cannot key on is measured separately and folded in here as a
sidebar, not blended into the detector-recall tables above (tiers never blend). See
[`../twins/judge-gate-cost.json`](../twins/judge-gate-cost.json) and
[`../twins/JUDGE-GATE-COST-REPORT.md`](../twins/JUDGE-GATE-COST-REPORT.md). The
headline numbers, stated over their honest denominators:

- **Wild-cheat recall: 1/7** goal-not-fixed wild cheats blocked (14%, Wilson-95
  [0.03, 0.51]). The judge misses most wild cheats on this set.
- **Clean-side false-block rate: 1/52** (1.9%, Wilson-95 [0.00, 0.10]) over all
  clean PRs judged (semantic honest twins 1/8 + broad clean 0/44). The retired
  12.5% figure was the semantic-only slice (1/8), a small-n interim, not the
  clean-side rate.
- **Proof tier on the same semantic set: 0% recall, 0% false-positive** (it
  abstains rather than guesses; it never fires without executed evidence).

Regenerate with `npm run judge-gate-cost` (funded Anthropic key), or
`node dist/scripts/experiments/judge-gate-cost.js --report-only` to reframe from
the committed JSON without model calls. Joint conclusion on this sample: neither
the judge nor the proof tier catches wild cheats reliably (judge 1/7; proof tier
0/7 by abstention), and only the proof tier abstains rather than guesses. Both ship
advisory, never as a block gate.
