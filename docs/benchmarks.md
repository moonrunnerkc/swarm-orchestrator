# Benchmarks

The primary v7 metric is **falsification catch rate** — the percentage of agent-claimed-success patches that fail at least one battery layer. Measured against `princeton-nlp/SWE-bench_Verified`, 50-instance stratified subset, seed=42 (manifest: [`benchmarks/swe-bench/instances-50.json`](../benchmarks/swe-bench/instances-50.json)).

Numbers land with the 7.0.0 release notes after the P4 sweep completes. The sweep harness is at [`benchmarks/swe-bench/`](../benchmarks/swe-bench/); it runs in a Docker image with all instance dependencies pinned.

Secondary metrics from the same sweep:

- SWE-bench Verified pass@1
- Mean wall clock per instance
- Mean premium requests per instance

Per-layer eval harnesses for the falsification battery live under `scripts/eval/` and `benchmarks/swe-bench/`. Historical raw outputs are not kept in the repository; regenerate them locally or attach them as release artifacts when publishing benchmark evidence.

The earlier three-producer rubric harness under `benchmarks/harness/` predates v7 and is no longer the primary benchmark. The harness code is retained for archival reference; generated run data is excluded from Git.
