# P2 Benchmark Results

Date: 2026-04-26
Branch: `v7-overhaul`

## Baselines

The v6.0.0 baseline means come from the committed benchmark data:

| Benchmark | Source | Runs | Baseline Mean |
|---|---|---:|---:|
| demo-fast | `benchmarks/harness/raw_data/demo-fast/metrics.jsonl` | 10 | 84.3s |
| api-quick | `benchmarks/harness/raw_data/api-quick/metrics.jsonl` | 5 | 359.1s |

## Current P2 Runs

Commands:

```bash
/usr/bin/time -p node dist/src/cli.js demo demo-fast --yes --no-dashboard
/usr/bin/time -p node dist/src/cli.js demo api-quick --yes --no-dashboard
```

| Benchmark | Current Wall Clock | Baseline Mean | Delta | Result |
|---|---:|---:|---:|---|
| demo-fast | 49.42s | 84.3s | -34.88s | Pass |
| api-quick | 313.64s | 359.1s | -45.46s | Pass |

No P2 halt condition fired. Both benchmarks improved against the v6.0.0 baseline means.

## Notes

- demo-fast used the static analyzer's parallel work-stealing path for its two independent utility-file steps.
- api-quick ran conservatively in three batches. Step 3 references `package.json` for Docker layer caching while step 2 edits `package.json`, so the dependency analyzer kept those steps sequential.
- Persistent stdin/stdout adapter mode is implemented but remains on cold-start fallback by default unless `SWARM_ENABLE_PERSISTENT_INTERACTIVE=1` is set.
