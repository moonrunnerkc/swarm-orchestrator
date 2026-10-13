# Launch records

One JSON file per launch (`<task>.<arm>.json`), schema `swarm-ordinary-comparison.record.v1`
(`scripts/comparison/schema.mjs`), copied from `~/.cache/swarm-comparison/runs/<manifest digest>/`
as the launches complete. A file is written once and never overwritten; a launch rerun for an
infrastructure failure keeps the failed record beside it under a suffix. Output blobs named by
digest stay in the local cache.
