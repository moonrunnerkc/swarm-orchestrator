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
